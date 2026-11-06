import { makeHandler, upstashFromEnv } from '../lib/core.mjs';
import { toWeb, send } from '../lib/node.mjs';

// Vercel: needs an Upstash Redis database (Vercel dashboard -> Storage -> Upstash Redis).
const handler = makeHandler(async () => {
  const s = upstashFromEnv();
  if (!s) throw new Error('Storage is not connected. In Vercel open Storage and add Upstash Redis, then redeploy.');
  return s;
});
export default async function (req, res) {
  await send(res, await handler(await toWeb(req)));
}
