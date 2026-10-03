// Shared bits for the tools: a static server for dist/, Playwright's Chromium, the GPU lock, and PLY -> SPZ.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Playwright (a dev dependency) drives the system Chrome; PLAYWRIGHT_FROM points at another install.
export function chromium() {
  const req = createRequire(join(process.env.PLAYWRIGHT_FROM ?? root, 'package.json'));
  return req('playwright').chromium;
}

// Headed Chrome on the real GPU (ANGLE D3D11), never throttled in the background.
export const GPU_ARGS = ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'];

// Minimal static server for dist/ (SPZ, GLB and OGG need HTTP, not file://). Resolves to its base URL.
// snapshot: serve a private copy of dist/, so a rebuild during a long capture cannot break it.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.ogg': 'audio/ogg', '.png': 'image/png', '.txt': 'text/plain' };
export async function serveDist({ snapshot = false } = {}) {
  let dist = join(root, 'dist');
  if (!existsSync(join(dist, 'index.html'))) throw new Error('dist/ is missing: run `npm run build` first');
  if (snapshot) {
    const copy = join(root, '.capture', String(process.pid));
    for (let i = 0; ; i++) { // retry while a build is half-written
      rmSync(copy, { recursive: true, force: true });
      cpSync(dist, copy, { recursive: true });
      const js = readFileSync(join(copy, 'index.html'), 'utf8').match(/src="\.\/(assets\/[^"]+\.js)"/)?.[1];
      if (js && existsSync(join(copy, js))) break;
      if (i === 10) throw new Error('dist/ is incomplete');
      await new Promise((r) => setTimeout(r, 2000));
    }
    process.on('exit', () => rmSync(copy, { recursive: true, force: true }));
    dist = copy;
  }
  return new Promise((resolve) => {
    const server = createServer((rq, rs) => {
      let f = join(dist, normalize(decodeURIComponent(new URL(rq.url, 'http://x').pathname)).replace(/^([/\\])+/, ''));
      if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
      if (!f.startsWith(dist) || !existsSync(f)) { rs.writeHead(404); rs.end(); return; }
      rs.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' });
      createReadStream(f).pipe(rs);
    }).listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

// The shared GPU lock (../.gpu-lock next to the repo, a directory with an `owner` file): one GPU-heavy job at a time.
const LOCK = process.env.GPU_LOCK ?? join(root, '..', '.gpu-lock');
export async function withGpuLock(owner, fn) {
  for (;;) {
    try { mkdirSync(LOCK); break; } catch { await new Promise((r) => setTimeout(r, 3000)); }
  }
  writeFileSync(join(LOCK, 'owner'), owner);
  const release = () => rmSync(LOCK, { recursive: true, force: true });
  process.once('SIGINT', () => { release(); process.exit(130); });
  try { return await fn(); } finally { release(); }
}

// 3DGS PLY bytes -> SPZ bytes with Spark's own transcoder (SPZ v3, colour only: SH degree 0).
export async function plyToSpz(plyBytes) {
  const { transcodeSpz } = await import('@sparkjsdev/spark');
  const { fileBytes } = await transcodeSpz({ inputs: [{ fileBytes: new Uint8Array(plyBytes), fileType: 'ply', pathOrUrl: 'in.ply' }], maxSh: 0 });
  return fileBytes;
}

export const readJson = (f, fallback = null) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return fallback; } };
