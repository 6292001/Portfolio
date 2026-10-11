// Platform-neutral backend: login, image upload, save/load site data.
import crypto from 'node:crypto';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = { 'x-content-type-options': 'nosniff' };
const json = (o, status = 200, extra = {}) =>
  new Response(JSON.stringify(o), { status, headers: { ...BASE, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

/* ---------------- storage adapters ---------------- */
export function upstashFromEnv(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const cmd = async (c) => {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(c) });
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    return j.result;
  };
  return {
    name: 'upstash',
    get: (k) => cmd(['GET', k]),
    set: (k, v) => cmd(['SET', k, v]),
    del: (k) => cmd(['DEL', k]),
    getBin: async (k) => { const v = await cmd(['GET', k]); return v ? new Uint8Array(Buffer.from(v, 'base64')) : null; },
    setBin: (k, b) => cmd(['SET', k, Buffer.from(b).toString('base64')]),
  };
}

export async function netlifyStore() {
  const { getStore } = await import('@netlify/blobs');
  const s = getStore({ name: 'portfolio', consistency: 'strong' });
  return {
    name: 'netlify-blobs',
    get: async (k) => (await s.get(k, { type: 'text' })) ?? null,
    set: (k, v) => s.set(k, v),
    del: (k) => s.delete(k),
    getBin: async (k) => { const b = await s.get(k, { type: 'arrayBuffer' }); return b ? new Uint8Array(b) : null; },
    setBin: (k, b) => s.set(k, b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)),
  };
}

export async function fsStore(dir) {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  await fs.mkdir(dir, { recursive: true });
  const f = (k) => path.join(dir, k.replace(/[^a-z0-9_.-]/gi, '_'));
  const rd = async (k, enc) => { try { return await fs.readFile(f(k), enc); } catch { return null; } };
  return {
    name: 'files',
    get: (k) => rd(k, 'utf8'),
    set: (k, v) => fs.writeFile(f(k), v),
    del: (k) => fs.rm(f(k), { force: true }),
    getBin: async (k) => { const b = await rd(k); return b ? new Uint8Array(b) : null; },
    setBin: (k, b) => fs.writeFile(f(k), b),
  };
}

/* ---------------- sessions ---------------- */
const secret = () => process.env.SESSION_SECRET || sha('pf-session|' + (process.env.ADMIN_PASSWORD || '')).toString('hex');
const sign = (v) => crypto.createHmac('sha256', secret()).update(v).digest('base64url');
const mkToken = () => { const v = String(Date.now() + 7 * 864e5); return v + '.' + sign(v); };
function okToken(t) {
  if (!t || !process.env.ADMIN_PASSWORD) return false;
  const [v, s] = t.split('.');
  if (!v || !s) return false;
  const a = Buffer.from(sign(v)), b = Buffer.from(s);
  return a.length === b.length && crypto.timingSafeEqual(a, b) && Date.now() < Number(v);
}
const tokenOf = (req) => { const m = /(?:^|;\s*)adm=([^;]+)/.exec(req.headers.get('cookie') || ''); return m && m[1]; };
const cookie = (t, secure, age) => `adm=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}` + (secure ? '; Secure' : '');

/* ---------------- validation ---------------- */
const HEX = /^#[0-9a-f]{6}$/i, ID = /^[a-f0-9]{20}$/;
const FONTS = ['Inter', 'Poppins', 'Montserrat', 'Space Grotesk', 'Outfit', 'Manrope', 'DM Sans', 'Sora', 'Syne', 'Bebas Neue', 'Anton', 'Oswald', 'Archivo Black', 'Bangers', 'Righteous', 'Playfair Display', 'Caveat Brush', 'Caveat', 'Permanent Marker', 'Kalam', 'Shadows Into Light', 'Gochi Hand', 'Rock Salt', 'Patrick Hand', 'Gloria Hallelujah', 'Nanum Pen Script', 'Covered By Your Grace'];
const font = (v, d) => (FONTS.includes(v) ? v : d);
const URLOK = /^(https?:\/\/|mailto:|tel:)/i;
const DIRS = ['', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
const num = (v, lo, hi, d) => { v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v * 10) / 10)) : d; };
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
export function clean(b) {
  b = b && typeof b === 'object' ? b : {};
  const thumbs = (Array.isArray(b.thumbs) ? b.thumbs : []).slice(0, 200).filter((t) => t && ID.test(t.id))
    .map((t) => ({ id: t.id, title: str(t.title, 120), stat: str(t.stat, 80), feat: !!t.feat }));
  let k = 0; thumbs.forEach((t) => { if (t.feat && ++k > 21) t.feat = false; });
  const s = b.site && typeof b.site === 'object' ? b.site : {};
  const stats = (Array.isArray(s.stats) ? s.stats : []).slice(0, 3).map((x) => ({ v: str(x && x.v, 20), l: str(x && x.l, 80), n: str(x && x.n, 80) }));
  const th = s.theme && typeof s.theme === 'object' ? s.theme : {};
  const cm = s.compare && typeof s.compare === 'object' ? s.compare : {};
  const notes = Array.isArray(cm.notes)
    ? cm.notes.slice(0, 8).map((n) => ({ t: str(n && n.t, 40), x: num(n && n.x, 0, 100, 50), y: num(n && n.y, 0, 100, 50), a: DIRS.includes(n && n.a) ? n.a : '' })).filter((n) => n.t)
    : undefined;
  const items = (a) => (Array.isArray(a) ? a : []).slice(0, 6).map((x) => ({ v: str(x && x.v, 20), t: str(x && x.t, 40), d: str(x && x.d, 100), s: ['a', 'w', 'na', 'sa'].includes(x && x.s) ? x.s : 'w' }));
  let strips;
  if (Array.isArray(s.strips)) strips = s.strips.slice(0, 5).map((z) => ({ t: str(z && z.t, 80), s: str(z && z.s, 160), items: items(z && z.items) }));
  else if (Array.isArray(s.strip)) strips = [{ t: '', s: '', items: items(s.strip) }];
  const sec = (x) => ({ t: str(x && x.t, 80), s: str(x && x.s, 160) });
  const sections = s.sections && typeof s.sections === 'object' ? { slides: sec(s.sections.slides), compare: sec(s.sections.compare), work: sec(s.sections.work) } : undefined;
  const f = s.footer && typeof s.footer === 'object' ? s.footer : null;
  const footer = f ? { on: !!f.on, t: str(f.t, 80), s: str(f.s, 160), c: str(f.c, 160), links: (Array.isArray(f.links) ? f.links : []).slice(0, 8).map((l) => ({ l: str(l && l.l, 40), u: URLOK.test(str(l && l.u, 300)) ? str(l.u, 300) : '' })).filter((l) => l.l && l.u) } : undefined;
  const fo = th.fonts && typeof th.fonts === 'object' ? th.fonts : {};
  return {
    thumbs,
    site: {
      name: str(s.name, 80), role: str(s.role, 80), stats,
      avatarId: ID.test(s.avatarId) ? s.avatarId : '', strips, sections, footer, tabTitle: str(s.tabTitle, 80),
      compare: { beforeId: ID.test(cm.beforeId) ? cm.beforeId : '', afterId: ID.test(cm.afterId) ? cm.afterId : '', color: HEX.test(cm.color) ? cm.color.toLowerCase() : '#ffe14d', size: num(cm.size, 1.5, 6, 3), notes },
      theme: { accent: HEX.test(th.accent) ? th.accent.toLowerCase() : '#fb2f01', bg: HEX.test(th.bg) ? th.bg.toLowerCase() : '#02070d', grid: th.grid === 'off' ? 'off' : 'on', fonts: { body: font(fo.body, 'Inter'), head: font(fo.head, 'Caveat Brush'), hand: font(fo.hand, 'Caveat Brush') } },
    },
  };
}

/* ---------------- the API ---------------- */
export function makeHandler(getStore) {
  let store;
  const st = async () => (store ||= await getStore());
  return async function handle(req) {
    try {
      const url = new URL(req.url), m = req.method;
      const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '') || '/';
      const secure = (req.headers.get('x-forwarded-proto') || url.protocol.replace(':', '')) === 'https';
      const admin = okToken(tokenOf(req));

      if (m !== 'GET' && m !== 'HEAD') {
        const o = req.headers.get('origin');
        const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host;
        if (o) { let oh = ''; try { oh = new URL(o).host; } catch {} if (oh !== host) return json({ error: 'Blocked (bad origin).' }, 403); }
      }

      if (m === 'GET' && path === '/me') {
        let storage = null, storageError = '';
        try { storage = (await st()).name; } catch (e) { storageError = String((e && e.message) || e); }
        return json({ admin, configured: !!process.env.ADMIN_PASSWORD, storage, storageError });
      }

      if (m === 'GET' && path === '/data') {
        const s = await st();
        return new Response((await s.get('data')) || '{"thumbs":[],"site":{}}', { headers: { ...BASE, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=0, must-revalidate' } });
      }

      if (m === 'GET' && path.startsWith('/img/')) {
        const id = path.slice(5);
        if (!ID.test(id)) return json({ error: 'Not found' }, 404);
        // Images are only handed out to your own pages: refuse other websites (hotlinking) and people opening the image link in a tab.
        const dest = req.headers.get('sec-fetch-dest') || '', fsite = req.headers.get('sec-fetch-site') || '';
        if (fsite === 'cross-site' || ['document', 'iframe', 'frame', 'embed', 'object'].includes(dest)) return new Response('Not found', { status: 404, headers: { ...BASE, vary: 'Sec-Fetch-Dest, Sec-Fetch-Site', 'cache-control': 'no-store' } });
        const b = await (await st()).getBin('img-' + id);
        if (!b) return json({ error: 'Not found' }, 404);
        return new Response(b, { headers: { ...BASE, vary: 'Sec-Fetch-Dest, Sec-Fetch-Site', 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
      }

      if (m === 'POST' && path === '/login') {
        const pw = process.env.ADMIN_PASSWORD;
        if (!pw) return json({ error: 'ADMIN_PASSWORD is not set on your hosting yet.' }, 503);
        const s = await st();
        const ip = (req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || req.headers.get('x-real-ip') || 'unknown').trim();
        const key = 'rl-' + sha(ip).toString('hex').slice(0, 16);
        let rl = {}; try { rl = JSON.parse((await s.get(key)) || '{}'); } catch {}
        if (rl.until && rl.until > Date.now()) return json({ error: 'Too many tries. Try again in ' + Math.ceil((rl.until - Date.now()) / 60000) + ' min.' }, 429);
        let b = {}; try { b = await req.json(); } catch {}
        if (typeof b.password === 'string' && same(b.password, pw)) {
          if (rl.n) await s.del(key);
          return json({ ok: true }, 200, { 'set-cookie': cookie(mkToken(), secure, 604800) });
        }
        const n = (rl.t && Date.now() - rl.t < 9e5 ? rl.n || 0 : 0) + 1;
        await s.set(key, JSON.stringify({ n, t: n === 1 ? Date.now() : rl.t, until: n >= 5 ? Date.now() + 9e5 : 0 }));
        await sleep(700);
        return json({ error: 'Wrong password.' }, 401);
      }

      if (m === 'POST' && path === '/logout') return json({ ok: true }, 200, { 'set-cookie': cookie('', secure, 0) });

      if (m === 'POST' && path === '/upload') {
        if (!admin) return json({ error: 'Not signed in.' }, 401);
        const buf = new Uint8Array(await req.arrayBuffer());
        if (buf.length < 100 || buf.length > 750000) return json({ error: 'Image must be under 750 KB.' }, 413);
        if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return json({ error: 'JPEG images only.' }, 415);
        const id = crypto.randomBytes(10).toString('hex');
        await (await st()).setBin('img-' + id, buf);
        return json({ id });
      }

      if (m === 'PUT' && path === '/data') {
        if (!admin) return json({ error: 'Not signed in.' }, 401);
        let b; try { b = await req.json(); } catch { return json({ error: 'Bad data.' }, 400); }
        const s = await st(), d = clean(b);
        let prev = {}; try { prev = JSON.parse((await s.get('data')) || '{}'); } catch {}
        const keep = new Set([...d.thumbs.map((t) => t.id), d.site.avatarId, d.site.compare.beforeId, d.site.compare.afterId]);
        const pc = ((prev.site || {}).compare) || {};
        const old = [...(prev.thumbs || []).map((t) => t.id), (prev.site || {}).avatarId, pc.beforeId, pc.afterId].filter(Boolean);
        await s.set('data', JSON.stringify(d));
        await Promise.all(old.filter((i) => !keep.has(i)).map((i) => s.del('img-' + i)));
        return json({ ok: true });
      }

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: 'Server error. Check your hosting logs.' }, 500);
    }
  };
}
