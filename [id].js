
import { makeHandler, upstashFromEnv } from '../../lib/core.mjs';
import { toWeb, send } from '../../lib/node.mjs';

const handler = makeHandler(async () => {
  const storage = upstashFromEnv();

  if (!storage) {
    throw new Error('Redis storage is not connected.');
  }

  return storage;
});

export default async function (req, res) {
  await send(res, await handler(await toWeb(req)));
}
