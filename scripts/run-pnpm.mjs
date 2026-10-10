import { spawn } from 'node:child_process';
const cli = process.env.npm_execpath;
if (!cli) throw new Error('Launch this helper through pnpm dev.');
const native = cli.endsWith('.exe');
const child = spawn(
  native ? cli : process.execPath,
  [...(native ? [] : [cli]), ...process.argv.slice(2)],
  { stdio: 'inherit', windowsHide: true },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
