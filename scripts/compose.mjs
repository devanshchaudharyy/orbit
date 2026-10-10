import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const operation = process.argv[2];
if (!['up', 'down'].includes(operation)) throw new Error('Expected up or down');
if (!existsSync(`${root}/.env.local`)) throw new Error('Run pnpm setup first.');
const args = [
  'compose',
  '--env-file',
  '.env.local',
  '-f',
  'infra/compose.yaml',
  ...(operation === 'up' ? ['up', '-d', '--wait', '--wait-timeout', '90'] : ['down']),
];
const child = spawn('docker', args, { cwd: root, stdio: 'inherit', windowsHide: true });
child.on('error', () => {
  console.error(
    'Docker is unavailable. Install/start Docker Desktop with WSL 2, then rerun this command. See docs/TESTING.md.',
  );
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
