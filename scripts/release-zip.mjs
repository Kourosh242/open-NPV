// Open NPV — AGPL-3.0-only
// Builds the archive you extract into the root of your GitHub repository.
// Only an explicit allow-list of source paths is included, so private samples,
// node_modules and build output can never leak into a published archive.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { zipSync } from 'fflate';

const ROOTS = ['src', 'public', 'scripts', 'tests', 'vendor', 'docs', '.github'];
const FILES = [
  'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.test.json',
  'README.md', 'LICENSE', 'NOTICE', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md',
  '.gitignore', '.gitattributes',
];
const FORBIDDEN = /(^|\/)(node_modules|site|release|\.test-build|\.cache|private[_-]samples?)(\/|$)|\.private\./i;

const archive = {};
async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile()) archive[path.replaceAll('\\', '/')] = new Uint8Array(await readFile(path));
  }
}
for (const root of ROOTS) await collect(root);
for (const file of FILES) archive[file] = new Uint8Array(await readFile(file));

for (const name of Object.keys(archive)) {
  if (FORBIDDEN.test(name)) throw new Error(`refusing to package forbidden path: ${name}`);
}

await mkdir('release', { recursive: true });
const out = 'release/open-npv-main.zip';
await writeFile(out, zipSync(archive, { level: 9 }));
console.log(`Wrote ${out} with ${Object.keys(archive).length} files (extract into the repository root).`);
