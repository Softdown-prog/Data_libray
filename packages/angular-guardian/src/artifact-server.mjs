import { createServer } from 'node:http';
import { realpath, readdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function serveArtifact({ dist, digest, mount, routes }) {
  const root = await realpath(dist), files = new Map(), records = [];
  let bytes = 0, count = 0;
  async function walk(dir, depth) {
    if (++count > 4096 || depth > 24) throw new Error('budget');
    const entries = await readdir(dir, { withFileTypes: true });
    if (entries.length + count > 4096) throw new Error('budget');
    for (const e of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const file = path.join(dir, e.name);
      if (e.isSymbolicLink()) throw new Error('symlink');
      if (e.isDirectory()) { await walk(file, depth + 1); continue; }
      if (++count > 4096) throw new Error('budget');
      const resolved = await realpath(file);
      if (!resolved.startsWith(root + path.sep)) throw new Error('escape');
      const fd = await open(resolved, constants.O_RDONLY | constants.O_NONBLOCK);
      let data;
      try {
        const stat = await fd.stat();
        if (!stat.isFile() || stat.size > 16 * 1024 * 1024 || (bytes += stat.size) > 64 * 1024 * 1024) throw new Error('budget');
        const buffer = Buffer.alloc(stat.size + 1); let offset = 0;
        while (offset < buffer.length) { const chunk = await fd.read(buffer, offset, buffer.length - offset, null); if (!chunk.bytesRead) break; offset += chunk.bytesRead; }
        if (offset !== stat.size) throw new Error('mutation');
        data = buffer.subarray(0, offset);
      } finally { await fd.close(); }
      const name = path.relative(root, file).split(path.sep).join('/');
      files.set(name, data); records.push([name, hash(data)]);
    }
  }
  await walk(root, 0);
  if (hash(JSON.stringify(records)) !== digest) throw new Error('artifact-mismatch');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
  const server = createServer((req, res) => {
    const deny = () => { res.writeHead(404); res.end(); };
    if (!['GET', 'HEAD'].includes(req.method) || req.headers.host !== `127.0.0.1:${server.address().port}`) return deny();
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch { return deny(); }
    if (!url.pathname.startsWith(mount) || /[%\\]/.test(req.url) || url.pathname.split('/').includes('..')) return deny();
    const route = '/' + url.pathname.slice(mount.length);
    const name = routes.includes(route) ? 'index.html' : url.pathname.slice(mount.length);
    const data = files.get(name);
    if (!data) return deny();
    res.writeHead(200, { 'Content-Type': types[path.extname(name)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
