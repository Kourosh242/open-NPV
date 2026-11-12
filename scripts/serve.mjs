import { createServer } from 'node:http';
import { readFile, stat, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';

const root = resolve('site');
const rootReal = await realpath(root).catch(() => root);
const port = Number(process.env.PORT || 3000);
let base = process.env.BASE_PATH || '/';
if (!base.startsWith('/')) base = '/' + base;
if (!base.endsWith('/')) base += '/';
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.zip': 'application/zip', '.npvt': 'application/octet-stream' };

const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method not allowed');
      return;
    }
    const url = new URL(req.url || '/', 'http://preview.local');
    let pathname = decodeURIComponent(url.pathname);
    if (base !== '/') {
      if (pathname === base.slice(0, -1)) { res.writeHead(301, { Location: base }); res.end(); return; }
      if (!pathname.startsWith(base)) { res.writeHead(404); res.end('Not found'); return; }
      pathname = '/' + pathname.slice(base.length);
    }
    let path = resolve(root, '.' + pathname);
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    // Resolve symlinks: an asset must never escape the site directory.
    const real = await realpath(path);
    if (real !== rootReal && !real.startsWith(rootReal + sep)) { res.writeHead(403); res.end('Forbidden'); return; }
    path = real;
    const info = await stat(path);
    if (info.isDirectory()) path = resolve(path, 'index.html');
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); }
});
server.listen(port, '0.0.0.0', () => {
  const address = server.address();
  const actual = typeof address === 'object' && address ? address.port : port;
  console.log(`Open NPV preview listening on 0.0.0.0:${actual}${base}`);
});
