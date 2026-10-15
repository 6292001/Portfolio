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
const COLOR_KEYS = ['heroTag', 'heroT', 'heroS', 'statN', 'statL', 'workT', 'workS', 'aboutT', 'aboutB', 'aboutBtn', 'howTag', 'howT', 'stepIcon', 'stepT', 'stepD', 'secT', 'secS', 'faqTag', 'faqT', 'faqQ', 'faqA', 'footT', 'footS'];
const ICONS = ['list', 'chat', 'check-circle', 'check', 'star', 'bolt', 'heart', 'play'];
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
  const tids = new Set(thumbs.map((t) => t.id));
  const work = Array.isArray(s.work) ? s.work.filter((w) => w && ID.test(w.id)).slice(0, 60).map((w) => ({ id: w.id, title: str(w.title, 120), stat: str(w.stat, 80) })) : undefined;
  let rows; if (Array.isArray(s.rows)) { const seen = new Set(); rows = [0, 1, 2].map((r) => (Array.isArray(s.rows[r]) ? s.rows[r] : []).filter((id) => typeof id === 'string' && tids.has(id) && !seen.has(id) && seen.add(id))); }
  const f = s.footer && typeof s.footer === 'object' ? s.footer : null;
  const footer = f ? { on: !!f.on, t: str(f.t, 80), s: str(f.s, 160), c: str(f.c, 160), links: (Array.isArray(f.links) ? f.links : []).slice(0, 8).map((l) => ({ l: str(l && l.l, 40), u: URLOK.test(str(l && l.u, 300)) ? str(l.u, 300) : '' })).filter((l) => l.l && l.u) } : undefined;
  const fo = th.fonts && typeof th.fonts === 'object' ? th.fonts : {};
  const co = {}; if (th.colors && typeof th.colors === 'object') COLOR_KEYS.forEach((k) => { if (HEX.test(th.colors[k])) co[k] = th.colors[k].toLowerCase(); });
  const he = s.hero && typeof s.hero === 'object' ? { tag: str(s.hero.tag, 80), t: str(s.hero.t, 120), s: str(s.hero.s, 300) } : undefined;
  const ab = s.about && typeof s.about === 'object' ? { on: !!s.about.on, t: str(s.about.t, 80), body: str(s.about.body, 2000), btn: str(s.about.btn, 40), url: URLOK.test(str(s.about.url, 300)) ? str(s.about.url, 300) : '', photoId: ID.test(s.about.photoId) ? s.about.photoId : '' } : undefined;
  const hw = s.how && typeof s.how === 'object' ? { on: !!s.how.on, tag: str(s.how.tag, 80), t: str(s.how.t, 80), items: (Array.isArray(s.how.items) ? s.how.items : []).slice(0, 6).map((x) => ({ icon: ICONS.includes(x && x.icon) ? x.icon : 'check', t: str(x && x.t, 60), d: str(x && x.d, 200) })).filter((x) => x.t || x.d) } : undefined;
  const fq = s.faq && typeof s.faq === 'object' ? { on: !!s.faq.on, tag: str(s.faq.tag, 80), t: str(s.faq.t, 80), items: (Array.isArray(s.faq.items) ? s.faq.items : []).slice(0, 20).map((x) => ({ q: str(x && x.q, 200), a: str(x && x.a, 1500) })).filter((x) => x.q) } : undefined;
  return {
    thumbs,
    site: {
      name: str(s.name, 80), role: str(s.role, 80), stats,
      avatarId: ID.test(s.avatarId) ? s.avatarId : '', iconId: ID.test(s.iconId) ? s.iconId : '', adminIconId: ID.test(s.adminIconId) ? s.adminIconId : '', work, rows, strips, sections, footer, tabTitle: str(s.tabTitle, 80), logoId: ID.test(s.logoId) ? s.logoId : '', logoOn: s.logoOn !== false, loaderId: ID.test(s.loaderId) ? s.loaderId : '', loaderOn: s.loaderOn !== false, loaderBg: HEX.test(s.loaderBg) ? s.loaderBg.toLowerCase() : '', loaderPanel: HEX.test(s.loaderPanel) ? s.loaderPanel.toLowerCase() : '', hero: he, about: ab, how: hw, faq: fq, fv: 2,
      compare: { beforeId: ID.test(cm.beforeId) ? cm.beforeId : '', afterId: ID.test(cm.afterId) ? cm.afterId : '', color: HEX.test(cm.color) ? cm.color.toLowerCase() : '#ffe14d', size: num(cm.size, 1.5, 6, 3), notes },
      theme: { accent: HEX.test(th.accent) ? th.accent.toLowerCase() : '#fb2f01', bg: HEX.test(th.bg) ? th.bg.toLowerCase() : '#02070d', grid: th.grid === 'off' ? 'off' : 'on', colors: co, fonts: { body: font(fo.body, 'Inter'), head: font(fo.head, 'Poppins'), hand: font(fo.hand, 'Caveat Brush') } },
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

      if (m === 'GET' && path === '/favicon') {
        const sto = await st(); let dd = {}; try { dd = JSON.parse((await sto.get('data')) || '{}'); } catch {}
        const site = dd.site || {}, adminIcon = url.searchParams.get('admin') === '1', apple = url.searchParams.get('apple') === '1';
        const hdr = { ...BASE, 'cache-control': url.searchParams.get('v') ? 'public, max-age=31536000, immutable' : 'no-cache' };
        const iid = adminIcon ? site.adminIconId : site.iconId;
        if (iid && ID.test(iid)) {
          const b = (await sto.getBin('png-' + iid)) || (await sto.getBin('img-' + iid));
          if (b) return new Response(b, { headers: { ...hdr, 'content-type': b[0] === 0x89 ? 'image/png' : 'image/jpeg' } });
        }
        if (apple) return new Response('Not found', { status: 404, headers: hdr });
        const accent = HEX.test((site.theme || {}).accent) ? site.theme.accent : '#fb2f01';
        const raw = adminIcon ? 'A' : ((typeof site.name === 'string' ? site.name.trim() : '').charAt(0).toUpperCase() || 'S');
        const letter = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${adminIcon ? '#14181f' : accent}"/><text x="32" y="46" font-size="40" font-weight="800" text-anchor="middle" fill="${adminIcon ? accent : '#fff'}" font-family="Arial,Helvetica,sans-serif">${letter}</text></svg>`;
        return new Response(svg, { headers: { ...hdr, 'content-type': 'image/svg+xml' } });
      }

      if (m === 'GET' && path === '/loader') {
        const sto = await st(); let dd = {}; try { dd = JSON.parse((await sto.get('data')) || '{}'); } catch {}
        const site = dd.site || {}, id = site.loaderId || site.logoId;
        const hdr = { ...BASE, 'cache-control': url.searchParams.get('v') ? 'public, max-age=31536000, immutable' : 'no-cache' };
        if (id && ID.test(id)) {
          const b = (await sto.getBin('png-' + id)) || (await sto.getBin('img-' + id));
          if (b) return new Response(b, { headers: { ...hdr, 'content-type': b[0] === 0x89 ? 'image/png' : 'image/jpeg' } });
        }
        return new Response(null, { status: 302, headers: { ...BASE, location: '/logo.png', 'cache-control': 'no-cache' } });
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
        const sto = await st();
        let b = await sto.getBin('img-' + id), type = 'image/jpeg';
        if (!b) { b = await sto.getBin('png-' + id); type = 'image/png'; }
        if (!b) return json({ error: 'Not found' }, 404);
        return new Response(b, { headers: { ...BASE, vary: 'Sec-Fetch-Dest, Sec-Fetch-Site', 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable' } });
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
        const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
        const isJpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
        const icon = url.searchParams.get('icon') === '1';
        if (buf.length < 100 || buf.length > (icon ? 300000 : 750000)) return json({ error: icon ? 'Icon must be under 300 KB.' : 'Image must be under 750 KB.' }, 413);
        if (!(isJpg || (icon && isPng))) return json({ error: icon ? 'Icons must be PNG or JPEG images.' : 'JPEG images only.' }, 415);
        const id = crypto.randomBytes(10).toString('hex');
        await (await st()).setBin((isPng ? 'png-' : 'img-') + id, buf);
        return json({ id });
      }

      if (m === 'PUT' && path === '/data') {
        if (!admin) return json({ error: 'Not signed in.' }, 401);
        let b; try { b = await req.json(); } catch { return json({ error: 'Bad data.' }, 400); }
        const s = await st(), d = clean(b);
        let prev = {}; try { prev = JSON.parse((await s.get('data')) || '{}'); } catch {}
        const keep = new Set([...d.thumbs.map((t) => t.id), d.site.avatarId, d.site.iconId, d.site.adminIconId, ...(d.site.work || []).map((w) => w.id), d.site.compare.beforeId, d.site.compare.afterId, (d.site.about || {}).photoId, d.site.logoId, d.site.loaderId]);
        const pc = ((prev.site || {}).compare) || {};
        const old = [...(prev.thumbs || []).map((t) => t.id), (prev.site || {}).avatarId, (prev.site || {}).iconId, (prev.site || {}).adminIconId, ...(((prev.site || {}).work) || []).map((w) => w.id), pc.beforeId, pc.afterId, ((prev.site || {}).about || {}).photoId, (prev.site || {}).logoId, (prev.site || {}).loaderId].filter(Boolean);
        await s.set('data', JSON.stringify(d));
        await Promise.all(old.filter((i) => !keep.has(i)).flatMap((i) => [s.del('img-' + i), s.del('png-' + i)]));
        return json({ ok: true });
      }

      return json({ error: 'Not found' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: 'Server error. Check your hosting logs.' }, 500);
    }
  };
}
