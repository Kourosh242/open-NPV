import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';

await rm('site', { recursive: true, force: true });
await mkdir('site', { recursive: true });
await cp('public', 'site', { recursive: true });
const common = { bundle: true, minify: true, target: 'es2022', platform: 'browser', legalComments: 'eof', sourcemap: false, logLevel: 'info' };
await build({ ...common, entryPoints: ['src/app.ts'], outfile: 'site/app.js', format: 'iife' });
await build({ ...common, entryPoints: ['src/worker.ts'], outfile: 'site/worker.js', format: 'iife' });
await cp('LICENSE', 'site/LICENSE.txt');
await cp('NOTICE', 'site/NOTICE.txt');
await cp('tests/fixtures/synthetic.npvt', 'site/demo.npvt');

const manifest = JSON.parse(await readFile('site/manifest.webmanifest', 'utf8'));
for (const icon of manifest.icons || []) {
  const path = join('site', icon.src.replace(/^\.\//, ''));
  await readFile(path); // Fail the build if a declared PWA icon is missing.
}

const sourceRoots = ['src', 'public', 'scripts', 'tests', 'vendor', 'docs', '.github'];
const sourceFiles = ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.test.json', 'README.md', 'LICENSE', 'NOTICE', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md', '.gitignore', '.gitattributes', '.editorconfig'];
const archive = {};
async function collect(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await collect(child);
    else if (entry.isFile()) archive[child.replaceAll('\\', '/')] = new Uint8Array(await readFile(child));
  }
}
for (const root of sourceRoots) await collect(root);
for (const file of sourceFiles) archive[file] = new Uint8Array(await readFile(file));
await writeFile('site/source.zip', zipSync(archive, { level: 9 }));

async function siteFiles(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await siteFiles(path));
    else if (entry.name !== 'sw.js') result.push(path);
  }
  return result.sort();
}
const files = await siteFiles('site');
const hash = createHash('sha256');
for (const file of files) { hash.update(relative('site', file).replaceAll(sep, '/')); hash.update(await readFile(file)); }
const version = hash.digest('hex').slice(0, 12);
const core = ['./', ...files.map(file => './' + relative('site', file).replaceAll(sep, '/')).filter(file => file !== './index.html')];
// './' already supplies index.html; include the explicit URL for hosts that redirect directory requests.
core.splice(1, 0, './index.html');
const sw = `/* Open NPV — AGPL-3.0-only. Only application assets are cached. */
const SCOPE = new URL('./', self.location.href).pathname;
const PREFIX = 'open-npv-' + encodeURIComponent(SCOPE) + '-';
const CACHE = PREFIX + '${version}';
const CORE = ${JSON.stringify(core, null, 2)};
self.addEventListener('install', event => {
  // Atomic: never report offline readiness with a missing decoder or table.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE.map(url => new Request(url, { cache: 'reload' })))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Only delete older versions of this exact deployment path, never sibling projects.
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  // Serve the cached shell as one atomic version. Updates are explicit via the UI,
  // so a new index.html can never be paired with an old cached decoder.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request.mode === 'navigate' ? './index.html' : request);
    if (hit) return hit;
    try { return await fetch(request); }
    catch { return request.mode === 'navigate' ? Response.error() : Response.error(); }
  })());
});
`;
await writeFile('site/sw.js', sw);
console.log(`Built site/ with atomic offline cache ${version}; source archive included.`);
