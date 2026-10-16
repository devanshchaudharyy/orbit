import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { createWriteStream, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = resolve(root, '.local/testing');
const apiRequire = createRequire(resolve(root, 'apps/api/package.json'));
const rootRequire = createRequire(resolve(root, 'package.json'));
const { MongoClient } = apiRequire('mongoose').mongo;
const mode = process.argv[2] ?? 'start';
const version = '1.27.10';
const executable = process.platform === 'win32' ? 'mailpit.exe' : 'mailpit';
const mailpit = resolve(local, `bin/mailpit-${version}`, executable);
const mongo =
  process.env.ORBIT_TEST_MONGOD ??
  (process.platform === 'win32' ? 'C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe' : 'mongod');
const mongoUri =
  'mongodb://127.0.0.1:27018/orbit_test_phase2?replicaSet=orbit-test&directConnection=true';
const children = [];
let stopping = false;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

async function prepare() {
  const platform = { win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform];
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch];
  if (!platform || !arch) throw new Error('This platform has no supported Mailpit fixture asset.');
  const extension = platform === 'windows' ? 'zip' : 'tar.gz';
  const name = `mailpit-${platform}-${arch}.${extension}`;
  const releaseResponse = await fetch(
    `https://api.github.com/repos/axllent/mailpit/releases/tags/v${version}`,
  );
  if (!releaseResponse.ok) throw new Error('Cannot inspect the pinned official Mailpit release.');
  const release = await releaseResponse.json();
  const asset = release.assets.find((item) => item.name === name);
  if (!asset?.digest?.startsWith('sha256:'))
    throw new Error('Official asset SHA-256 is unavailable; download aborted.');
  const archive = resolve(local, 'bin', name);
  await mkdir(dirname(archive), { recursive: true });
  const downloaded = await fetch(asset.browser_download_url);
  if (!downloaded.ok) throw new Error('Cannot download the official Mailpit asset.');
  const bytes = Buffer.from(await downloaded.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (`sha256:${digest}` !== asset.digest)
    throw new Error('Mailpit asset checksum does not match the official release.');
  await writeFile(archive, bytes);
  await mkdir(dirname(mailpit), { recursive: true });
  if (platform === 'windows') {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Expand-Archive -LiteralPath $env:ORBIT_ARCHIVE -DestinationPath $env:ORBIT_DESTINATION -Force',
      ],
      {
        env: { ...process.env, ORBIT_ARCHIVE: archive, ORBIT_DESTINATION: dirname(mailpit) },
        windowsHide: true,
      },
    );
  } else {
    execFileSync('tar', ['-xzf', archive, '-C', dirname(mailpit)]);
  }
  await writeFile(
    resolve(local, 'bin/mailpit-release.json'),
    JSON.stringify(
      { version, asset: name, sha256: digest, source: asset.browser_download_url },
      null,
      2,
    ),
  );
  console.log(`Prepared Mailpit ${version}; official SHA-256 verified. Workspace files only.`);
}

async function unusedPort(port) {
  await new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', () =>
      fail(new Error(`Fixture port ${port} is occupied; existing processes were left untouched.`)),
    );
    probe.listen(port, '127.0.0.1', () => probe.close(done));
  });
}

function launch(name, command, args, options = {}) {
  const log = createWriteStream(resolve(local, `${name}.log`), { flags: 'a' });
  const child = spawn(command, args, {
    cwd: root,
    windowsHide: true,
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.once('error', (error) => {
    console.error(`${name} failed to start (${error.code ?? 'process error'}).`);
    void shutdown(1);
  });
  child.once('exit', (code) => {
    if (!stopping) {
      console.error(`${name} exited (${code ?? 'signal'}); see ignored fixture logs.`);
      void shutdown(1);
    }
  });
  return child;
}

async function waitHttp(url, label, milliseconds = 60000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) {
    if (stopping) throw new Error('Fixture stopped during startup.');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {
      /* bounded retry */
    }
    await delay(300);
  }
  throw new Error(`${label} did not become available; see ignored fixture logs.`);
}

async function initializeMongo() {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    const client = new MongoClient('mongodb://127.0.0.1:27018/?directConnection=true', {
      serverSelectionTimeoutMS: 1000,
    });
    try {
      await client.connect();
      const admin = client.db('admin');
      try {
        await admin.command({ replSetGetStatus: 1 });
      } catch (error) {
        if (error.code !== 94) throw error;
        await admin.command({
          replSetInitiate: { _id: 'orbit-test', members: [{ _id: 0, host: 'localhost:27018' }] },
        });
      }
      const hello = await admin.command({ hello: 1 });
      if (hello.isWritablePrimary) {
        const build = await admin.command({ buildInfo: 1 });
        return build.version;
      }
    } catch {
      /* only this task-owned loopback instance */
    } finally {
      await client.close();
    }
    await delay(300);
  }
  throw new Error('Isolated MongoDB replica set did not become primary.');
}

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of [...children].reverse()) {
    if (child.exitCode !== null) continue;
    if (process.platform === 'win32') {
      try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } catch {
        /* already exited */
      }
    } else child.kill('SIGTERM');
  }
  process.exitCode = code;
  console.log('Stopped task-owned fixture children. Local test data is retained.');
}

async function start() {
  await import('./pdf-assets.mjs');
  if (!existsSync(mailpit))
    throw new Error('Mailpit fixture is missing. Run pnpm auth:fixture prepare first.');
  if (process.platform === 'win32' && !existsSync(mongo))
    throw new Error(
      'Installed mongod was not found. Set ORBIT_TEST_MONGOD to an existing binary; this helper does not install MongoDB.',
    );
  const information = await stat(mailpit);
  if (!information.isFile()) throw new Error('Mailpit executable is not a file.');
  for (const port of [27018, 11025, 18025, 4001, 5174]) await unusedPort(port);
  await mkdir(resolve(local, 'mongo'), { recursive: true });
  const mongoChild = launch('mongo', mongo, [
    '--dbpath',
    resolve(local, 'mongo'),
    '--port',
    '27018',
    '--bind_ip',
    '127.0.0.1',
    '--replSet',
    'orbit-test',
    '--oplogSize',
    '128',
  ]);
  const actualMongoVersion = await initializeMongo();
  launch('mailpit', mailpit, [
    '--database',
    resolve(local, 'mailpit.db'),
    '--listen',
    '127.0.0.1:18025',
    '--smtp',
    '127.0.0.1:11025',
    '--disable-version-check',
    '--smtp-disable-rdns',
    '--quiet',
  ]);
  await waitHttp('http://127.0.0.1:18025/readyz', 'Mailpit');
  const fixtureEnv = {
    ...process.env,
    ...(process.argv.includes('--ai') ? { AI_PROVIDER: 'ollama', AI_MODEL: 'llama3.2:3b' } : {}),
    NODE_ENV: 'test',
    PORT: '4001',
    HOST: '127.0.0.1',
    LOG_LEVEL: 'info',
    MONGO_URI: mongoUri,
    REDIS_URL: 'redis://127.0.0.1:16379',
    DEPENDENCY_TIMEOUT_MS: '1000',
    APP_ORIGIN: 'http://127.0.0.1:5174',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: '11025',
    SMTP_FROM: 'ORBIT <hello@orbit.local>',
    SMTP_SECURE: 'false',
    SMTP_USER: '',
    SMTP_PASSWORD: '',
  };
  const apiChild = launch(
    'api',
    process.execPath,
    [apiRequire.resolve('tsx/cli'), 'watch', 'src/server.ts'],
    { cwd: resolve(root, 'apps/api'), env: fixtureEnv },
  );
  await waitHttp('http://127.0.0.1:4001/api/v1/health/live', 'API');
  const viteCli = join(dirname(rootRequire.resolve('vite/package.json')), 'bin/vite.js');
  const webChild = launch(
    'web',
    process.execPath,
    [viteCli, '--host', '127.0.0.1', '--port', '5174', '--strictPort'],
    {
      cwd: resolve(root, 'apps/web'),
      env: { ...process.env, VITE_API_TARGET: 'http://127.0.0.1:4001' },
    },
  );
  await waitHttp('http://127.0.0.1:5174/', 'Frontend');
  await writeFile(
    resolve(local, 'fixture.json'),
    JSON.stringify(
      {
        mongoVersion: actualMongoVersion,
        mailpitVersion: version,
        origin: 'http://127.0.0.1:5174',
        api: 'http://127.0.0.1:4001',
        mailbox: 'http://127.0.0.1:18025',
        database: 'orbit_test_phase2',
        ownerPid: process.pid,
        mongoPid: mongoChild.pid,
        apiPid: apiChild.pid,
        webPid: webChild.pid,
      },
      null,
      2,
    ),
  );
  console.log(`Authentication fixture ready: MongoDB ${actualMongoVersion}, Mailpit ${version}.`);
  console.log('Preview http://127.0.0.1:5174/ · local email http://127.0.0.1:18025/');
  console.log('Redis/S3/Docker verification is not included. Ctrl+C stops only fixture children.');
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
try {
  if (mode === 'prepare') await prepare();
  else if (mode === 'start') await start();
  else if (mode === 'status') {
    const info = JSON.parse(await readFile(resolve(local, 'fixture.json'), 'utf8'));
    await waitHttp(`${info.api}/api/v1/health/live`, 'API', 5000);
    await waitHttp(`${info.mailbox}/readyz`, 'Mailpit', 5000);
    await waitHttp(info.origin, 'Frontend', 5000);
    const database = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 2000 });
    try {
      await database.connect();
      await database.db().command({ ping: 1 });
    } finally {
      await database.close();
    }
    console.log(
      `Fixture responds: MongoDB ${info.mongoVersion}; API, frontend and Mailpit reachable.`,
    );
  } else throw new Error('Use prepare, start, or status.');
} catch (error) {
  console.error(error.message);
  await shutdown(1);
}
