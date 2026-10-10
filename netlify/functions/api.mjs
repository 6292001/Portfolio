import { makeHandler, upstashFromEnv, netlifyStore } from '../../lib/core.mjs';

// Netlify: uses built-in Netlify Blobs (no extra setup). If you set Upstash variables it uses those instead.
const handler = makeHandler(async () => upstashFromEnv() || (await netlifyStore()));
export default async (req) => handler(req);
export const config = { path: '/api/*' };
