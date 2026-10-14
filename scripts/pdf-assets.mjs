import { cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(resolve(root, 'apps/web/package.json'));
const source = dirname(require.resolve('pdfjs-dist/package.json'));
const target = resolve(root, 'apps/web/public/pdfjs');
await mkdir(target, { recursive: true });
for (const directory of ['cmaps', 'standard_fonts', 'wasm'])
  await cp(resolve(source, directory), resolve(target, directory), { recursive: true });
