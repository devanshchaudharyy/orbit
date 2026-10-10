import { spawn } from 'node:child_process';

const children = ['api', 'web'].map((name) =>
  spawn(process.execPath, ['scripts/run-pnpm.mjs', '--filter', `@orbit/${name}`, 'dev'], {
    stdio: 'inherit',
  }),
);
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (process.platform === 'win32')
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    else child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 500).unref();
}
for (const child of children)
  child.on('exit', (code) => {
    if (!stopping) stop(code ?? 1);
  });
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
