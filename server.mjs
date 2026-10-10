// Local test server:  ADMIN_PASSWORD=yourpassword npm run dev   ->  http://localhost:8787
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeHandler, fsStore } from './lib/core.mjs';
import { toWeb, send } from './lib/node.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const handler = makeHandler(() => fsStore(process.env.DATA_DIR || '.data'));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

export const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) return await send(res, await handler(await toWeb(req)));
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html'; else if (p === '/admin') p = '/admin.html';
    const file = path.join(root, path.normalize(p));
    if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
    const data = await fs.readFile(file);
    res.setHeader('content-type', types[path.extname(file)] || 'application/octet-stream');
    res.end(data);
  } catch { res.statusCode = 404; res.end('Not found'); }
});
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = process.env.PORT || 8787;
  server.listen(port, () => console.log('Site: http://localhost:' + port + '   Admin: http://localhost:' + port + '/admin'));
}
