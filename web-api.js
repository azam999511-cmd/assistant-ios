/* واجهة الجوال: نفس window.api الموجودة في تطبيق البيسي، لكن تتكلم مع خادم البيسي بدل Electron. */
(function () {
  if (window.api) return;
  const q = new URLSearchParams(location.search);
  let tok = q.get('t') || '';
  try { if (tok) localStorage.setItem('mu.tok', tok); else tok = localStorage.getItem('mu.tok') || ''; } catch {}

  const handlers = [];
  let curChat = null, es = null;

  /* ربط تلقائي لو الجوال داخل شبكة Tailscale، فما تطلع صفحة الربط */
  async function pair() {
    try {
      const r = await fetch('/api/pair', { cache: 'no-store' }); if (!r.ok) return false;
      const j = await r.json(); if (!j.token) return false;
      tok = j.token; try { localStorage.setItem('mu.tok', tok); } catch {} return true;
    } catch { return false; }
  }
  function authBox(msg) {
    if (document.getElementById('authBox')) return;
    const d = document.createElement('div'); d.id = 'authBox';
    d.style.cssText = 'position:fixed;inset:0;z-index:2000;display:grid;place-items:center;padding:24px;background:rgba(10,20,40,.72);font-family:inherit';
    d.innerHTML = '<form style="background:#fff;color:#123;border-radius:22px;padding:22px;max-width:420px;width:100%;display:flex;flex-direction:column;gap:12px;direction:rtl">' +
      '<h3 style="margin:0">ربط مع البيسي</h3><p style="margin:0;font-size:.9rem;line-height:1.7">' + (msg || 'افتح تطبيق مساعدي على البيسي ← الإعدادات ← ربط الجوال، وانسخ الرابط والصقه هنا.') + '</p>' +
      '<input dir="ltr" placeholder="الصق رابط الربط هنا" style="font-size:16px;padding:12px;border-radius:12px;border:1px solid #9bb"><button style="font-size:16px;padding:12px;border-radius:12px;border:0;background:#2f8cff;color:#fff">اتصل</button></form>';
    d.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      const v = d.querySelector('input').value.trim(); let t = v, base = '';
      try { const u = new URL(v); t = u.searchParams.get('t') || ''; base = u.origin; } catch {}
      if (!t) return;
      try { localStorage.setItem('mu.tok', t); } catch {}
      location.href = (base && base !== location.origin ? base : location.origin) + '/?t=' + encodeURIComponent(t);
    };
    document.body.append(d);
  }

  async function call(method, path, body, raw, signal) {
    if (!tok && !(await pair())) { authBox(); throw new Error('ما فيه ربط مع البيسي.'); }
    const headers = { Authorization: 'Bearer ' + tok };
    if (!raw && body !== undefined) headers['content-type'] = 'application/json';
    let r;
    try { r = await fetch(path, { method, headers, body: raw ? body : body === undefined ? undefined : JSON.stringify(body), signal }); }
    catch (e) { if (e.name === 'AbortError') throw e; throw new Error('ما قدرت أوصل للبيسي. تأكد إنه شغّال ومتصل بنفس الشبكة أو Tailscale.'); }
    if (r.status === 401) { try { localStorage.removeItem('mu.tok'); } catch {} tok = ''; if (await pair()) { location.reload(); throw new Error('إعادة ربط'); } authBox('الرابط انتهت صلاحيته أو تغيّر المفتاح. انسخ الرابط الجديد من البيسي.'); throw new Error('غير مصرّح'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok && !d.error) d.error = 'خطأ ' + r.status;
    return d;
  }
  const b64 = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; };

  function listen() {
    if (es || !tok) return;
    es = new EventSource('/api/events?t=' + encodeURIComponent(tok));
    es.addEventListener('chats', () => handlers.forEach((f) => f()));
    es.addEventListener('revoked', () => { es.close(); es = null; try { localStorage.removeItem('mu.tok'); } catch {} tok = ''; pair().then((ok) => { if (ok) location.reload(); else authBox('تغيّر مفتاح الربط. انسخ الرابط الجديد من البيسي.'); }); });
    let was = false;
    es.onopen = () => { if (was) handlers.forEach((f) => f()); was = true; };
  }

  window.api = {
    web: true,
    chat: async (messages, extra) => {
      const id = Math.random().toString(36).slice(2), ac = new AbortController(); curChat = { id, ac };
      try { return await call('POST', '/api/chat', { messages, extra, id }, false, ac.signal); }
      catch (e) { if (e.name === 'AbortError') return { aborted: true }; throw e; }
      finally { if (curChat && curChat.id === id) curChat = null; }
    },
    cancel: () => { const c = curChat; if (!c) return; call('POST', '/api/chat/cancel', { id: c.id }).catch(() => {}); c.ac.abort(); },
    tts: async (text) => { const r = await call('POST', '/api/tts', { text }); return r.audio ? { audio: b64(r.audio), mime: r.mime } : r; },
    stt: (b, o) => call('POST', '/api/stt?lang=' + encodeURIComponent((o && o.lang) || 'ar'), b, true),
    extract: (ab, name) => call('POST', '/api/extract?name=' + encodeURIComponent(name || ''), ab, true),
    archive: (ab, kind) => call('POST', '/api/archive?kind=' + encodeURIComponent(kind || 'zip'), ab, true),
    titleGen: async (t) => (await call('POST', '/api/title', { text: t })).title || null,
    getSettings: () => call('GET', '/api/settings'),
    saveSettings: (s) => call('POST', '/api/settings', s),
    getChats: async () => { const d = await call('GET', '/api/chats'); listen(); return d; },
    setChats: (c) => call('PUT', '/api/chats', c),
    onChatsChanged: (f) => handlers.push(f),
    onTimer: () => {},
    win: { mode: async () => ({ custom: false, max: false, minW: 0, minH: 0, platform: 'web' }), min() {}, max() {}, close() {}, bounds: async () => null, setBounds() {}, relaunch: () => location.reload(), onState() {} }
  };

  /* ما نسمح بالتكبير بالقرص (سفاري يتجاهل الـ viewport) */
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((e) => document.addEventListener(e, (ev) => ev.preventDefault()));
  /* تلميح تثبيته كتطبيق إذا انفتح من المتصفح */
  addEventListener('load', () => {
    const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    let seen = false; try { seen = localStorage.getItem('mu.inst') === '1'; } catch {}
    if (standalone || seen || !/iPhone|iPad|Android/i.test(navigator.userAgent)) return;
    const ios = /iPhone|iPad/i.test(navigator.userAgent), d = document.createElement('div'); d.id = 'instBar';
    d.innerHTML = '<span>' + (ios ? 'عشان يصير تطبيق كامل: اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية».' : 'عشان يصير تطبيق كامل: قائمة المتصفح ⋮ ثم «تثبيت التطبيق».') + '</span><button>تمام</button>';
    d.querySelector('button').onclick = () => { try { localStorage.setItem('mu.inst', '1'); } catch {} d.remove(); };
    setTimeout(() => document.body.append(d), 1500);
  });
  if (!tok) addEventListener('DOMContentLoaded', () => { pair().then((ok) => { if (ok) location.reload(); else authBox(); }); });
  /* الكيبورد: نتبع الارتفاع الفعلي بس وهو مفتوح، وبغير كذا نخلي الصفحة تملا الشاشة كاملة */
  const isField = () => /^(TEXTAREA|INPUT)$/.test((document.activeElement || {}).tagName || '');
  const mob = () => matchMedia('(max-width:760px)').matches;
  const vvGap = () => (window.visualViewport ? Math.max(innerHeight - visualViewport.height, 0) : 0);
  const sync = () => {
    const vv = window.visualViewport;
    const small = vv && vv.height < screen.height * 0.72;
    const open = mob() && (vvGap() > 120 || !!small);
    document.body.classList.toggle('kb', open);
    const w = document.getElementById('win');
    if (w) {
      /* الكيبورد مفتوح: نثبّت النافذة على المساحة المرئية فعلياً، فما تنزاح الصفحة ولا تلخبط */
      if (open && vv && vvGap() > 120) { w.style.position = 'fixed'; w.style.top = vv.offsetTop + 'px'; w.style.height = vv.height + 'px'; }
      else { w.style.position = ''; w.style.top = ''; w.style.height = ''; }
    }
    if (!open) scrollTo(0, 0);
    fit();
  };
  /* التطبيق المثبّت على الآيفون: ارتفاع الصفحة يطلع أقصر من الشاشة (فراغ تحت)، فنضبطه على ارتفاع الشاشة الفعلي */
  const stand = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  function fit() {
    const r = document.documentElement, b = document.body;
    if (stand && mob() && !b.classList.contains('kb')) { const h = Math.max(innerHeight, screen.height) + 'px'; r.style.height = h; b.style.height = h; }
    else { r.style.height = ''; b.style.height = ''; }
  }
  addEventListener('resize', fit); addEventListener('orientationchange', fit);
  if (window.visualViewport) { visualViewport.addEventListener('resize', sync); visualViewport.addEventListener('scroll', () => { scrollTo(0, 0); if (document.body.classList.contains('kb')) sync(); }); }
  document.addEventListener('focusin', () => setTimeout(sync, 250));
  document.addEventListener('focusout', () => setTimeout(sync, 200));
  addEventListener('DOMContentLoaded', () => { if (mob() && isField()) document.activeElement.blur(); sync(); });
  /* manifest يحمل المفتاح عشان التطبيق المثبّت يفتح مربوط */
  addEventListener('DOMContentLoaded', () => {
    const l = document.querySelector('link[rel=manifest]'); if (l && tok) l.href = '/manifest.webmanifest?t=' + encodeURIComponent(tok);
    if ('serviceWorker' in navigator && isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});
  });

  /* عارض الصور: اضغط أي صورة بالمحادثة تكبر، قرّب بإصبعين، واضغط بأي مكان تسكّرها */
  addEventListener('DOMContentLoaded', () => {
    const lb = document.createElement('div'); lb.id = 'lb'; lb.hidden = true;
    lb.innerHTML = '<button class="lb-x" aria-label="إغلاق"><svg class="ic"><use href="#i-x"/></svg></button><img alt="">';
    document.body.append(lb);
    const im = lb.querySelector('img');
    let sc = 1, tx = 0, ty = 0; const pts = new Map(); let d0 = 0, s0 = 1, moved = false;
    const apply = () => { im.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + sc + ')'; };
    const close = () => { lb.hidden = true; im.removeAttribute('src'); sc = 1; tx = ty = 0; apply(); };
    document.addEventListener('click', (e) => {
      const t = e.target.closest && e.target.closest('.thumbs img, .m .md img');
      if (!t || !t.src) return;
      im.src = t.src; sc = 1; tx = ty = 0; apply(); lb.hidden = false;
    });
    lb.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, e); moved = false; if (pts.size === 2) { const [a, b] = [...pts.values()]; d0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); s0 = sc; } });
    lb.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      if (pts.size === 2) { pts.set(e.pointerId, e); const [a, b] = [...pts.values()]; sc = Math.min(6, Math.max(1, s0 * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / d0)); moved = true; apply(); }
      else if (sc > 1) { tx += e.clientX - p.clientX; ty += e.clientY - p.clientY; pts.set(e.pointerId, e); moved = true; apply(); }
    });
    const up = (e) => { const was = pts.size; pts.delete(e.pointerId); if (was === 1 && !moved) close(); if (sc <= 1) { tx = ty = 0; apply(); } };
    lb.addEventListener('pointerup', up); lb.addEventListener('pointercancel', (e) => pts.delete(e.pointerId));
  });

  /* شريط تمرير واضح (سفاري يخبّي الأصلي): يظهر دايم لما المحتوى طويل، وتقدر تسحبه بإصبعك */
  addEventListener('DOMContentLoaded', () => {
    const win = document.getElementById('win'); if (!win) return;
    const items = [];
    document.querySelectorAll('#log, .welcome, #list, .pad').forEach((el) => {
      const bar = document.createElement('i'); bar.className = 'sbar'; win.append(bar);
      const it = { el, bar }; items.push(it);
      let sy = 0, st = 0, drag = false;
      bar.addEventListener('pointerdown', (e) => { drag = true; sy = e.clientY; st = el.scrollTop; bar.setPointerCapture(e.pointerId); bar.classList.add('drag'); el.style.scrollBehavior = 'auto'; e.preventDefault(); });
      bar.addEventListener('pointermove', (e) => { if (!drag) return; const ch = el.clientHeight, sh = el.scrollHeight, track = ch - 16, th = Math.max(40, track * ch / sh); el.scrollTop = st + (e.clientY - sy) * (sh - ch) / Math.max(1, track - th); });
      const end = () => { drag = false; bar.classList.remove('drag'); el.style.scrollBehavior = ''; };
      bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
      el.addEventListener('scroll', () => place(it), { passive: true });
    });
    function place(it) {
      const { el, bar } = it, ch = el.clientHeight, sh = el.scrollHeight;
      if (!mob() || el.offsetParent === null || el.clientWidth < 40 || sh <= ch + 4) { bar.style.display = 'none'; return; }
      const cr = el.getBoundingClientRect(), wr = win.getBoundingClientRect(), pad = 8, track = ch - pad * 2, th = Math.max(40, track * ch / sh);
      const top = pad + (el.scrollTop / (sh - ch)) * (track - th);
      bar.style.display = 'block'; bar.style.height = th + 'px'; bar.style.top = (cr.top - wr.top + top) + 'px'; bar.style.left = (cr.left - wr.left + 3) + 'px';
    }
    const all = () => items.forEach(place);
    setInterval(all, 400); addEventListener('resize', all); all();
  });

  /* سحب بالإصبع مثل تطبيقات الجوال: من اليمين لليسار تفتح قائمة المحادثات، ومن اليسار لليمين تسكّرها */
  addEventListener('DOMContentLoaded', () => {
    const hist = document.getElementById('hist'); if (!hist) return;
    let sx = 0, sy = 0, st = 0, ok = false;
    document.addEventListener('touchstart', (e) => {
      const lb = document.getElementById('lb');
      ok = e.touches.length === 1 && mob() && hist.offsetParent !== null && !(lb && !lb.hidden) &&
        !(e.target.closest && e.target.closest('.qa, textarea, input, select, .sbar, pre, table'));
      if (ok) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = Date.now(); }
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
      if (!ok) return; ok = false;
      const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Date.now() - st > 700 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      const off = hist.classList.contains('off');
      if (off && dx < 0 && sx > innerWidth * 0.3) { hist.classList.remove('off'); hap('LIGHT'); }
      else if (!off && dx > 0) { hist.classList.add('off'); hap('LIGHT'); }
    }, { passive: true });
  });

  /* ===== اهتزاز خفيف (داخل تطبيق الآيفون؛ بالمتصفح ما يسوي شي) ===== */
  function hap(style) {
    try {
      const H = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
      if (H) H.impact({ style: style || 'LIGHT' }); else if (navigator.vibrate) navigator.vibrate(8);
    } catch {}
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('#go, .rail-btn, .qa .btn, .cta .btn, .sw, .ib');
    if (t && mob()) hap(t.id === 'go' ? 'MEDIUM' : 'LIGHT');
  }, true);

  /* ===== اسحب من فوق لتحت لتحديث المحادثات ===== */
  addEventListener('DOMContentLoaded', () => {
    const pill = document.createElement('div'); pill.id = 'ptr'; pill.textContent = 'اسحب للتحديث'; document.body.append(pill);
    let el = null, y0 = 0, armed = false;
    document.addEventListener('touchstart', (e) => {
      el = null; if (!mob() || e.touches.length !== 1) return;
      const s = e.target.closest && e.target.closest('#log, #list, .welcome');
      if (s && s.scrollTop <= 0) { el = s; y0 = e.touches[0].clientY; armed = false; }
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
      if (!el) return;
      const q = document.getElementById('q'); if (q && q.value) { el = null; pill.classList.remove('on'); return; }
      const pull = e.touches[0].clientY - y0;
      if (pull <= 12 || el.scrollTop > 0) { pill.classList.remove('on'); return; }
      pill.classList.add('on'); pill.style.transform = 'translate(-50%,' + Math.min(pull * 0.45, 60) + 'px)';
      if (pull > 110 && !armed) { armed = true; pill.textContent = 'اترك للتحديث'; hap('MEDIUM'); }
      else if (pull <= 110 && armed) { armed = false; pill.textContent = 'اسحب للتحديث'; }
    }, { passive: true });
    document.addEventListener('touchend', () => {
      if (el && armed) { pill.textContent = 'جاري التحديث…'; setTimeout(() => location.reload(), 200); }
      else pill.classList.remove('on');
      el = null;
    }, { passive: true });
  });

  /* ===== شاشة «البيسي مو متصل» + إعادة اتصال تلقائي ===== */
  addEventListener('DOMContentLoaded', () => {
    const ov = document.createElement('div'); ov.id = 'offline'; ov.hidden = true;
    ov.innerHTML = '<div class="oc"><div class="oi"><svg class="ic"><use href="#i-x"/></svg></div><h3>البيسي مو متصل</h3>' +
      '<p>تأكد إن البيسي شغّال ومتصل بالنت. ولو أنت برا البيت لازم Tailscale يكون شغّال على الجوال. بيرجع يتصل لحاله أول ما يشتغل.</p>' +
      '<button class="btn pri" id="offRetry">أعد المحاولة</button></div>';
    document.body.append(ov);
    let fails = 0, busy = false;
    const check = async () => {
      if (busy || document.hidden) return; busy = true;
      try {
        const c = new AbortController(), t = setTimeout(() => c.abort(), 4000);
        const r = await fetch('/manifest.webmanifest?_=' + Date.now(), { cache: 'no-store', signal: c.signal }); clearTimeout(t);
        if (!r.ok) throw 0;
        fails = 0; if (!ov.hidden) { ov.hidden = true; location.reload(); }
      } catch { if (++fails >= 2) ov.hidden = false; }
      busy = false;
    };
    setInterval(check, 5000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) { fails = 1; check(); } });
    document.getElementById('offRetry').onclick = () => { fails = 1; check(); };
  });
})();
