import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const root = resolve('apps/web/dist');
const html = await readFile(resolve(root, 'index.html'), 'utf8');
assert(
  !/<script(?![^>]*\bsrc=)[^>]*>\s*\S/i.test(html),
  'Production must contain no inline scripts',
);
assert(!html.includes('DesignLab'), 'Design lab is disabled in the default release');
const files = await readdir(resolve(root, 'assets'));
const sizes = await Promise.all(
  files
    .filter((name) => name.endsWith('.js'))
    .map(async (name) => {
      const bytes = await readFile(resolve(root, 'assets', name));
      return { name, bytes: bytes.length, gzip: gzipSync(bytes).length };
    }),
);
for (const entry of sizes)
  assert(entry.gzip <= 170 * 1024, `${entry.name} exceeds 170 KiB gzip per-chunk budget`);
const initial = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+\.js)"/g)].map((m) => m[1]);
assert(initial.length > 0, 'Built entry scripts must exist');
let startupGzip = 0;
for (const path of new Set(initial))
  startupGzip += gzipSync(await readFile(resolve(root, '.' + path))).length;
assert(startupGzip <= 200 * 1024, 'Entry and preload JavaScript exceeds 200 KiB gzip');
const maps = files.filter((name) => name.endsWith('.map'));
assert.equal(maps.length, 0, 'Frontend source maps must stay private');
assert(
  (await stat(resolve(root, 'theme.js'))).size < 2048,
  'Synchronous theme bootstrap must remain small',
);
console.log(
  JSON.stringify({
    initialGzipBytes: startupGzip,
    initialBudgetBytes: 200 * 1024,
    chunkBudgetBytes: 170 * 1024,
    largestChunks: sizes.sort((a, b) => b.gzip - a.gzip).slice(0, 6),
    inlineScripts: 0,
    publicSourceMaps: maps.length,
  }),
);
