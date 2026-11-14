import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ktx2': 'image/ktx2', '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };
export function serveDir(root) {
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    p = normalize(p).replace(/^(\.\.[/\\])+/, '');
    let f = join(root, p);
    try { if (statSync(f).isDirectory()) f = join(f, 'index.html'); statSync(f); } catch { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    createReadStream(f).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: server.address().port, close: () => new Promise((c) => server.close(c)) })));
}
