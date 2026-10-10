// Converts Node's req/res to Web Request/Response (used by Vercel and the local dev server).
export async function toWeb(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (req.body !== undefined && req.body !== null) {
      body = Buffer.isBuffer(req.body) ? req.body : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    } else {
      const chunks = []; for await (const c of req) chunks.push(c);
      body = Buffer.concat(chunks);
    }
  }
  return new Request(`${proto}://${host}${req.url}`, { method: req.method, headers: req.headers, body });
}
export async function send(res, out) {
  res.statusCode = out.status;
  const sc = out.headers.getSetCookie ? out.headers.getSetCookie() : [];
  out.headers.forEach((v, k) => { if (k !== 'set-cookie') res.setHeader(k, v); });
  if (sc.length) res.setHeader('set-cookie', sc);
  res.end(Buffer.from(await out.arrayBuffer()));
}
