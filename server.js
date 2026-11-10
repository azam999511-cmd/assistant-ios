'use strict';
/* خادم الجوال: يشتغل داخل تطبيق البيسي، ويخدم نفس الواجهة + واجهة API محمية برمز.
   الجوال ما يخزّن مفاتيح الذكاء؛ كل الطلبات تمر على البيسي. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.ico': 'image/x-icon' };
const STATIC = {
  '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/renderer.js': 'renderer.js', '/calc.js': 'calc.js',
  '/sync.js': 'sync.js', '/web-api.js': 'web-api.js', '/sw.js': 'sw.js', '/manifest.webmanifest': 'manifest.webmanifest',
  '/icon-192.png': 'icon-192.png', '/icon-512.png': 'icon-512.png', '/splash-1206x2622.png': 'splash-1206x2622.png', '/splash-1320x2868.png': 'splash-1320x2868.png', '/splash-1179x2556.png': 'splash-1179x2556.png', '/splash-1290x2796.png': 'splash-1290x2796.png', '/splash-1170x2532.png': 'splash-1170x2532.png', '/splash-1284x2778.png': 'splash-1284x2778.png', '/splash-1125x2436.png': 'splash-1125x2436.png', '/splash-1242x2688.png': 'splash-1242x2688.png', '/splash-828x1792.png': 'splash-828x1792.png'
};

function create({ dir, getToken, api }) {
  const clients = new Set(); let server = null, ka = null, curPort = 0;
  const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const send = (res, code, obj) => {
    const b = Buffer.from(JSON.stringify(obj));
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': b.length, 'cache-control': 'no-store' }); res.end(b);
  };
  const readBody = (req, max = 90e6) => new Promise((res, rej) => {
    const ch = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > max) { rej(new Error('too big')); req.destroy(); return; } ch.push(c); });
    req.on('end', () => res(Buffer.concat(ch))); req.on('error', rej);
  });
  const json = async (req) => { try { return JSON.parse((await readBody(req)).toString('utf8') || '{}'); } catch { return {}; } };

  async function handle(req, res) {
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    if (req.method === 'GET' && STATIC[p]) {
      try {
        const f = STATIC[p]; let data = fs.readFileSync(path.join(dir, f));
        if (p === '/manifest.webmanifest') {   // التطبيق المثبّت يفتح مربوط: نحط المفتاح في رابط البداية إذا كان صحيح
          const t = u.searchParams.get('t') || '', real = getToken();
          if (t && real && same(t, real)) { const m = JSON.parse(data.toString('utf8')); m.start_url = '/?t=' + encodeURIComponent(t); data = Buffer.from(JSON.stringify(m)); }
        }
        res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }); return res.end(data);
      } catch { res.writeHead(404); return res.end(); }
    }
    /* ربط تلقائي بدون صفحة الربط: بس لو الطلب جاي من شبكة Tailscale (شبكتك الخاصة، أجهزتك أنت بس).
       أي شبكة ثانية (واي فاي البيت، إنترنت) تبقى تحتاج المفتاح. */
    if (req.method === 'GET' && p === '/api/pair') {
      const ra = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      const m = ra.match(/^100\.(\d+)\./);
      const tsDirect = !!(m && +m[1] >= 64 && +m[1] <= 127) || /^fd7a:115c:a1e0:/i.test(ra);
      const tsServe = (ra === '127.0.0.1' || ra === '::1') && !!req.headers['tailscale-user-login'];
      const proxied = ['x-forwarded-for', 'forwarded', 'x-real-ip', 'cf-connecting-ip'].some((h) => req.headers[h]) && !tsServe;
      const real = getToken();
      if (real && (tsDirect || tsServe) && !proxied) return send(res, 200, { token: real });
      return send(res, 403, { error: 'forbidden' });
    }
    if (!p.startsWith('/api/')) { res.writeHead(404); return res.end(); }
    const tok = (req.headers.authorization || '').replace(/^Bearer /, '') || u.searchParams.get('t') || '';
    const real = getToken();
    if (!real || !same(tok, real)) return send(res, 401, { error: 'unauthorized' });
    try {
      const k = req.method + ' ' + p;
      switch (k) {
        case 'GET /api/ping': return send(res, 200, { ok: true });
        case 'GET /api/settings': return send(res, 200, api.getSettings());
        case 'POST /api/settings': return send(res, 200, { ok: api.saveSettings(await json(req)) });
        case 'GET /api/chats': return send(res, 200, api.getChats());
        case 'PUT /api/chats': return send(res, 200, api.mergeChats(await json(req)));
        case 'GET /api/events': {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
          res.write('retry: 3000\n\n'); clients.add(res); req.on('close', () => clients.delete(res)); return;
        }
        case 'POST /api/chat': {
          const b = await json(req), id = String(b.id || ''); const ac = new AbortController();
          res.on('close', () => { if (!res.writableEnded) ac.abort(); });
          return send(res, 200, await api.chat(b, id, ac));
        }
        case 'POST /api/chat/cancel': api.cancel(String((await json(req)).id || '')); return send(res, 200, { ok: true });
        case 'POST /api/tts': {
          const r = await api.tts(String((await json(req)).text || ''));
          return send(res, 200, r.audio ? { audio: Buffer.from(r.audio).toString('base64'), mime: r.mime } : r);
        }
        case 'POST /api/stt': return send(res, 200, await api.stt(await readBody(req), { lang: u.searchParams.get('lang') || 'ar' }));
        case 'POST /api/title': return send(res, 200, { title: await api.title(String((await json(req)).text || '')) });
        case 'POST /api/extract': return send(res, 200, api.extract(await readBody(req), u.searchParams.get('name') || ''));
        case 'POST /api/archive': return send(res, 200, api.archive(await readBody(req), u.searchParams.get('kind') || 'zip'));
        default: return send(res, 404, { error: 'not found' });
      }
    } catch (e) { if (!res.headersSent) send(res, e.message === 'too big' ? 413 : 500, { error: e.message }); }
  }

  return {
    get running() { return !!server; },
    get port() { return curPort; },
    start(port) {
      return new Promise((resolve, reject) => {
        if (server) return resolve();
        const s = http.createServer((req, res) => { handle(req, res); });
        s.requestTimeout = 0; s.on('error', (e) => { server = null; reject(e); });
        s.listen(port, '0.0.0.0', () => { server = s; curPort = port; ka = setInterval(() => { for (const c of clients) c.write(':ka\n\n'); }, 25000); resolve(); });
      });
    },
    stop() {
      clearInterval(ka); for (const c of clients) { try { c.end(); } catch {} } clients.clear();
      if (server) { try { server.closeAllConnections(); server.close(); } catch {} server = null; }
    },
    broadcast(evt) { for (const c of clients) { try { c.write(`event: ${evt}\ndata: {}\n\n`); } catch {} } }
  };
}
module.exports = { create };
