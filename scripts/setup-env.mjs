import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const envPath = resolve(root, '.env.local');
await mkdir(resolve(root, 'infra/.local'), { recursive: true });
let text;
try {
  text = await readFile(envPath, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const hex = () => randomBytes(32).toString('hex');
  const mongo = hex();
  const redis = hex();
  text = `NODE_ENV=development\nHOST=127.0.0.1\nPORT=4000\nLOG_LEVEL=info\nDEPENDENCY_TIMEOUT_MS=1500\nMONGO_USER=orbit\nMONGO_PASSWORD=${mongo}\nMONGO_REPLICA_KEY=${randomBytes(64).toString('base64')}\nMONGO_URI=mongodb://orbit:${mongo}@127.0.0.1:27017/orbit?authSource=admin&replicaSet=rs0&directConnection=true\nMONGO_TEST_DATABASE=orbit_test\nREDIS_PASSWORD=${redis}\nREDIS_URL=redis://:${redis}@127.0.0.1:6379\nS3_ENDPOINT=http://127.0.0.1:3900\nS3_REGION=garage\nS3_ACCESS_KEY=GK${randomBytes(16).toString('hex')}\nS3_SECRET_KEY=${hex()}\nS3_BUCKET=orbit-local\nSMTP_HOST=127.0.0.1\nSMTP_PORT=1025\nMAILPIT_URL=http://127.0.0.1:8025\n`;
  await writeFile(envPath, text, { flag: 'wx', mode: 0o600 });
}
const authDefaults = {
  APP_ORIGIN: 'http://127.0.0.1:5173',
  SMTP_FROM: 'ORBIT <noreply@orbit.local>',
  SESSION_IDLE_MINUTES: '1440',
  SESSION_ABSOLUTE_HOURS: '168',
  SMTP_SECURE: 'false',
};
const additions = Object.entries(authDefaults).filter(
  ([name]) => !new RegExp(`^${name}=`, 'm').test(text),
);
if (additions.length) {
  text = `${text.trimEnd()}\n${additions.map(([name, value]) => `${name}=${value}`).join('\n')}\n`;
  await writeFile(envPath, text, { mode: 0o600 });
}
const settings = Object.fromEntries(
  text
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const split = line.indexOf('=');
      return [line.slice(0, split), line.slice(split + 1)];
    }),
);
for (const name of ['MONGO_PASSWORD', 'REDIS_PASSWORD', 'S3_ACCESS_KEY', 'S3_SECRET_KEY']) {
  if (!settings[name] || settings[name].startsWith('<'))
    throw new Error(`Missing ${name}; use generated .env.local values.`);
}
const garagePath = resolve(root, 'infra/.local/garage.toml');
try {
  await readFile(garagePath);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  await writeFile(
    garagePath,
    `metadata_dir = "/var/lib/garage/meta"\ndata_dir = "/var/lib/garage/data"\ndb_engine = "sqlite"\nreplication_factor = 1\nrpc_bind_addr = "[::]:3901"\nrpc_public_addr = "127.0.0.1:3901"\nrpc_secret = "${randomBytes(32).toString('hex')}"\n[s3_api]\ns3_region = "${settings.S3_REGION}"\napi_bind_addr = "[::]:3900"\n[admin]\napi_bind_addr = "[::]:3903"\nadmin_token = "${randomBytes(32).toString('hex')}"\n`,
    { flag: 'wx', mode: 0o600 },
  );
}
console.log('Local configuration is ready. Secrets were generated or retained; none were printed.');
