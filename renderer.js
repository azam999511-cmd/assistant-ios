'use strict';
(() => {
/* ═════════ أدوات صغيرة ═════════ */
const $ = (id) => document.getElementById(id);
const qsa = (s, r = document) => [...r.querySelectorAll(s)];
const ico = (n, c = '') => `<svg class="ic ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const lsGet = (k) => { try { return localStorage.getItem('mu.' + k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem('mu.' + k, v); } catch {} };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const TEXT_RE = /\.(txt|md|json|js|ts|py|html|css|c|cpp|cs|java|go|rs|php|sql|xml|yml|yaml|log|ini|bat|sh|csv)$/i;

const WEB = !!(window.api && window.api.web);
let S = {}, D = { sections: [], chats: [], notes: [], tasks: [], deleted: {} };
const snap = new Map();
let curId = null, fsec = 0, busy = false, curp = 'chat', att = [], reBusy = false, reOut = '';
let isMax = false, winMode = { custom: true, minW: 900, minH: 620 };
let spkId = 0, audioEl = null;
let micOn = false, micCtl = null;

/* ═════════ إشعارات ═════════ */
let toastT = 0;
function hideToast() { $('toast').classList.remove('on'); }
function toast(t, act) {
  $('toastTxt').textContent = t;
  const b = $('toastBtn');
  if (act) { b.hidden = false; b.textContent = act.label; b.onclick = () => { hideToast(); act.fn(); }; }
  else { b.hidden = true; b.onclick = null; }
  $('toast').classList.add('on');
  clearTimeout(toastT); toastT = setTimeout(hideToast, act ? 6500 : 3400);
}

/* ═════════ حفظ البيانات ═════════ */
let pT = 0, remotePend = false;
/* يحفظ ويدمج مع النسخة الثانية (البيسي/الجوال)؛ إذا وصل شي جديد نعرضه */
async function flush() {
  clearTimeout(pT);
  Sync.stamp(D, snap);
  let m; try { m = await api.setChats(D); } catch { return; }
  if (m && m.chats && Sync.sig(Sync.norm(m)) !== Sync.sig(D)) { if (busy) remotePend = true; else adopt(m); }
}
function persist(now) { clearTimeout(pT); if (now) { flush(); return; } pT = setTimeout(flush, WEB ? 1200 : 250); }
addEventListener('beforeunload', () => { try { Sync.stamp(D, snap); if (!WEB) api.setChats(D); } catch {} });
document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); else if (WEB) flush(); });
function adopt(m) {
  const before = curChat(), bu = before && before.upd;
  D = normD(m); Sync.resnap(D, snap);
  if (!D.chats.some((c) => c.id === curId)) curId = D.chats[0]?.id || null;
  drawSecs(); drawList(); noteDraw(); todoDraw();
  const now = curChat();
  if (!before || !now || now.upd !== bu || now.msgs.length !== before.msgs.length) drawChat();
}
function normD(d) {
  const o = (d && !Array.isArray(d) && typeof d === 'object') ? d : { chats: Array.isArray(d) ? d : [] };
  return { ...o, sections: o.sections || [], chats: o.chats || [], notes: o.notes || [], tasks: o.tasks || [], deleted: o.deleted || {} };
}
const saveQuiet = () => api.saveSettings(S);

/* ═════════ الإطار المموّج ═════════ */
const Frame = (() => {
  const OB = 17, IB = 33, RO = 58, RI = 44, AO = 6.5, AI = 2.6, STEP = 6, TAU = Math.PI * 2;
  let outl = null, inl = null, raf = 0, last = 0, running = false, animated = true, active = true, ready = false;

  function outline(inset, r) {
    const W = innerWidth, H = innerHeight;
    const x = inset, y = inset, w = W - 2 * inset, h = H - 2 * inset;
    r = Math.min(r, w / 2 - 1, h / 2 - 1);
    const parts = [
      { t: 'l', x0: x + r, y0: y, x1: x + w - r, y1: y, nx: 0, ny: -1 },
      { t: 'a', cx: x + w - r, cy: y + r, a0: -Math.PI / 2 },
      { t: 'l', x0: x + w, y0: y + r, x1: x + w, y1: y + h - r, nx: 1, ny: 0 },
      { t: 'a', cx: x + w - r, cy: y + h - r, a0: 0 },
      { t: 'l', x0: x + w - r, y0: y + h, x1: x + r, y1: y + h, nx: 0, ny: 1 },
      { t: 'a', cx: x + r, cy: y + h - r, a0: Math.PI / 2 },
      { t: 'l', x0: x, y0: y + h - r, x1: x, y1: y + r, nx: -1, ny: 0 },
      { t: 'a', cx: x + r, cy: y + r, a0: Math.PI }
    ];
    const P = []; let s = 0, px = null, py = null;
    const push = (X, Y, nx, ny) => { if (px !== null) s += Math.hypot(X - px, Y - py); P.push({ x: X, y: Y, nx, ny, s }); px = X; py = Y; };
    for (const p of parts) {
      if (p.t === 'l') {
        const len = Math.hypot(p.x1 - p.x0, p.y1 - p.y0), n = Math.max(1, Math.ceil(len / STEP));
        for (let i = 0; i < n; i++) { const u = i / n; push(p.x0 + (p.x1 - p.x0) * u, p.y0 + (p.y1 - p.y0) * u, p.nx, p.ny); }
      } else {
        const n = Math.max(3, Math.ceil((Math.PI * r / 2) / STEP));
        for (let i = 0; i < n; i++) { const a = p.a0 + (i / n) * Math.PI / 2; push(p.cx + r * Math.cos(a), p.cy + r * Math.sin(a), Math.cos(a), Math.sin(a)); }
      }
    }
    const L = s + Math.hypot(P[0].x - px, P[0].y - py);
    return { P, L, k1: Math.max(2, Math.round(L / 330)), k2: Math.max(3, Math.round(L / 195)), k3: Math.max(1, Math.round(L / 590)) };
  }
  function pathFor(o, amp, t, ph) {
    const { P, L, k1, k2, k3 } = o; let d = '';
    for (let i = 0; i < P.length; i++) {
      const p = P[i], u = p.s / L * TAU;
      const w = amp * (.55 * Math.sin(k1 * u + t * .9 + ph) + .3 * Math.sin(k2 * u - t * 1.25 + ph * 1.7) + .15 * Math.sin(k3 * u + t * .55 + ph * .6));
      d += (i ? 'L' : 'M') + (p.x + p.nx * w).toFixed(1) + ' ' + (p.y + p.ny * w).toFixed(1);
    }
    return d + 'Z';
  }
  function draw(t) {
    if (!outl) return;
    const dO = pathFor(outl, AO, t, 0), dI = pathFor(inl, AI, t, 2.1);
    $('fBody').setAttribute('d', dO); $('fSh1').setAttribute('d', dO); $('fSh2').setAttribute('d', dO); $('fIn').setAttribute('d', dI);
  }
  function build() { outl = outline(OB, RO); inl = outline(IB, RI); }
  function loop(ts) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (ts - last < 33) return;
    last = ts; draw(ts / 1000);
  }
  function sync() {
    const want = ready && animated && active && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (want && !running) { running = true; raf = requestAnimationFrame(loop); }
    if (!want && running) { running = false; cancelAnimationFrame(raf); }
    if (!want && ready && active) draw(1.3);
  }
  let rT = 0;
  addEventListener('resize', () => { if (!ready) return; cancelAnimationFrame(rT); rT = requestAnimationFrame(() => { build(); if (!running) draw(1.3); }); });
  return {
    init() { build(); ready = true; sync(); },
    setAnimated(v) { animated = !!v; sync(); },
    setActive(v) { active = !!v; if (v && ready) { build(); } sync(); }
  };
})();

/* ═════════ تحكم النافذة ═════════ */
function setMax(m) {
  isMax = !!m;
  $('win').classList.toggle('max', isMax);
  $('wMax').innerHTML = ico(isMax ? 'restore' : 'max');
  $('wMax').setAttribute('aria-label', isMax ? 'استعادة' : 'تكبير');
  Frame.setActive(!isMax);
}
async function initWin() {
  try { winMode = await api.win.mode(); } catch {}
  $('win').classList.toggle('native', !winMode.custom);
  if (!winMode.custom) { Frame.setActive(false); return; }
  Frame.init();
  $('wMin').onclick = () => api.win.min();
  $('wMax').onclick = () => api.win.max();
  $('wClose').onclick = () => { persist(true); setTimeout(() => api.win.close(), 60); };
  api.win.onState((s) => setMax(s.max));
  setMax(winMode.max);

  $('grips').addEventListener('pointerdown', async (e) => {
    const g = e.target.closest('i[data-e]'); if (!g || isMax) return;
    e.preventDefault();
    const edge = g.dataset.e, sx = e.screenX, sy = e.screenY;
    const b = await api.win.bounds(); if (!b) return;
    g.setPointerCapture(e.pointerId);
    let raf = 0, nb = null;
    const mv = (ev) => {
      const dx = ev.screenX - sx, dy = ev.screenY - sy;
      let { x, y, width, height } = b;
      if (edge.includes('e')) width = b.width + dx;
      if (edge.includes('s')) height = b.height + dy;
      if (edge.includes('w')) { width = b.width - dx; x = b.x + dx; }
      if (edge.includes('n')) { height = b.height - dy; y = b.y + dy; }
      if (width < winMode.minW) { if (edge.includes('w')) x = b.x + b.width - winMode.minW; width = winMode.minW; }
      if (height < winMode.minH) { if (edge.includes('n')) y = b.y + b.height - winMode.minH; height = winMode.minH; }
      nb = { x, y, width, height };
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; api.win.setBounds(nb); });
    };
    const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); g.removeEventListener('pointercancel', up); };
    g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up); g.addEventListener('pointercancel', up);
  });
}

/* ═════════ الكرة (واحدة فقط) ═════════ */
const orb = document.createElement('div');
orb.className = 'orb state-idle'; orb.id = 'orb';
orb.innerHTML = '<span class="ring"></span><span class="halo"></span><span class="halo h2"></span><span class="halo h3"></span><span class="core"></span>' + ico('spark', 'mark');
const LBL = { idle: 'جاهز', listen: 'يستمع…', think: 'يفكر…', speak: 'يتكلم…' };
const CAP = { idle: 'بانتظارك… اكتب أو كلّمني', listen: 'أسمعك، تكلّم…', think: 'أفكر بالإجابة…', speak: 'أتكلم…' };
function setOrb(s) {
  orb.className = 'orb state-' + s;
  if (s !== 'listen') orb.style.setProperty('--lvl', 0);
  $('stPill').dataset.s = s; $('stTxt').textContent = LBL[s]; $('orbCap').textContent = CAP[s];
}
const settleOrb = () => setOrb(busy || reBusy ? 'think' : 'idle');
function placeOrb(home) { (home ? $('orbHome') : $('orbDock')).append(orb); }

/* ═════════ المظهر ═════════ */
const THEMES = ['sky', 'night', 'violet', 'ember'], OLD_THEME = { cyan: 'sky', purple: 'violet', red: 'ember' };
function applyTheme(t) {
  t = OLD_THEME[t] || t; if (!THEMES.includes(t)) t = 'sky';
  document.documentElement.dataset.theme = t; S.theme = t;
  qsa('.theme-btn').forEach((b) => b.classList.toggle('on', b.dataset.theme === t));
}
function applyLook() {
  document.documentElement.style.fontSize = clamp(parseFloat(S.fsize) || 16, 12, 22) + 'px';
  applyTheme(S.theme);
  document.body.classList.toggle('no-bg', S.bg === false);
  document.body.classList.toggle('no-glow', S.glow === false);
  Frame.setAnimated(S.bg !== false);
  updateConn(); tipDraw();
}
qsa('.theme-btn').forEach((b) => { b.onclick = () => { applyTheme(b.dataset.theme); saveQuiet(); }; });

const PROV = { anthropic: 'Claude', grok: 'Grok', free: 'مجاني', ollama: 'محلي' };
function needsKey() {
  return (S.provider === 'anthropic' && !S.key) || (S.provider === 'grok' && !S.grokKey) || (S.provider === 'free' && !S.freeKey);
}
function updateConn() {
  const w = needsKey();
  $('conn').classList.toggle('warn', w);
  $('connTxt').textContent = (PROV[S.provider] || 'Claude') + (w ? ' · بدون مفتاح' : '');
  $('pv').value = S.provider || 'anthropic';
}
$('conn').onclick = () => tab('set');

/* ═════════ الإعدادات ═════════ */
const SET = [
  { h: 'الذكاء', f: [
    { id: 'provider', t: 'select', l: 'مصدر الذكاء', o: { anthropic: 'Claude (Anthropic)', grok: 'Grok (xAI)', free: 'مجاني (Gemini / Groq / OpenRouter)', ollama: 'نموذج محلي (Ollama)' } },
    { id: 'style', t: 'select', l: 'أسلوب الكلام', o: { najdi: 'نجدي', fusha: 'فصحى مبسطة' } },
    { id: 'key', t: 'pw', l: 'مفتاح Claude (Anthropic)', dep: ['provider', 'anthropic'] },
    { id: 'model', t: 'text', l: 'نموذج Claude', ltr: 1, dep: ['provider', 'anthropic'] },
    { id: 'grokKey', t: 'pw', l: 'مفتاح Grok (xAI)', dep: ['provider', 'grok'] },
    { id: 'grokModel', t: 'text', l: 'نموذج Grok', ltr: 1, dep: ['provider', 'grok'] },
    { id: 'freePreset', t: 'select', l: 'الخدمة المجانية', o: { gemini: 'Google Gemini (الأفضل للبداية)', groq: 'Groq (سريع جداً)', openrouter: 'OpenRouter' }, dep: ['provider', 'free'] },
    { id: 'freeKey', t: 'pw', l: 'مفتاح الخدمة المجانية', dep: ['provider', 'free'] },
    { id: 'freeModel', t: 'text', l: 'نموذج الخدمة المجانية', ltr: 1, dep: ['provider', 'free'] },
    { id: 'ollamaModel', t: 'text', l: 'نموذج Ollama', ltr: 1, dep: ['provider', 'ollama'] },
    { id: 'ollamaThink', t: 'check', l: 'تفكير النموذج المحلي (أدق لكن أبطأ)', dep: ['provider', 'ollama'] },
    { id: 'maxHistory', t: 'num', l: 'أقصى عدد رسائل في السياق', min: 4, max: 100 },
    { id: 'autoTitle', t: 'check', l: 'عنوان تلقائي للمحادثة' }
  ] },
  { h: 'الصوت (الرد الصوتي)', f: [
    { id: 'speak', t: 'check', l: 'يقرأ الردود بصوت عالٍ' },
    { id: 'voice', t: 'select', l: 'الصوت: ولد أو بنت', o: { female: 'بنت', male: 'ولد' } },
    { id: 'engine', t: 'select', l: 'محرك الصوت', o: { windows: 'Windows (بدون إنترنت)', openai: 'OpenAI (أوضح، يحتاج مفتاح)', eleven: 'ElevenLabs', piper: 'Piper' } },
    { id: 'rate', t: 'range', l: 'سرعة الكلام', min: .5, max: 2, step: .1 },
    { id: 'voiceName', t: 'voice', l: 'صوت ويندوز محدد (اتركه «تلقائي» عشان يتبع ولد/بنت)', dep: ['engine', 'windows'] },
    { id: 'openaiKey', t: 'pw', l: 'مفتاح OpenAI', dep: ['engine', 'openai'] },
    { id: 'elKey', t: 'pw', l: 'مفتاح ElevenLabs', dep: ['engine', 'eleven'] },
    { id: 'elVoiceM', t: 'text', l: 'Voice ID ولد', ltr: 1, dep: ['engine', 'eleven'] },
    { id: 'elVoiceF', t: 'text', l: 'Voice ID بنت', ltr: 1, dep: ['engine', 'eleven'] },
    { id: 'piperExe', t: 'text', l: 'مسار Piper', ltr: 1, dep: ['engine', 'piper'] },
    { id: 'piperModel', t: 'text', l: 'مسار موديل Piper', ltr: 1, dep: ['engine', 'piper'] },
    { id: 'sounds', t: 'check', l: 'المؤثرات الصوتية' }
  ] },
  { h: 'التعرف على كلامك', hint: 'Groq (مجاني) هو الأدق للعربي. المحلي يحتاج خادم whisper شغّال عندك.', f: [
    { id: 'sttEngine', t: 'select', l: 'محرك التعرف', o: { local: 'محلي (Whisper على جهازك)', groq: 'Groq — whisper-large-v3 (الأدق)', openai: 'OpenAI Whisper' } },
    { id: 'sttKey', t: 'pw', l: 'مفتاح التعرف (Groq أو OpenAI)', dep: ['sttEngine', 'groq|openai'] },
    { id: 'sttAuto', t: 'check', l: 'أرسل تلقائياً بعد ما أخلّص كلام (بدونها يظهر النص تراجعه أول)' },
    { id: 'whisperUrl', t: 'text', l: 'رابط Whisper', ltr: 1, dep: ['sttEngine', 'local'] },
    { id: 'whisperAuto', t: 'check', l: 'تشغيل Whisper تلقائياً', dep: ['sttEngine', 'local'] },
    { id: 'whisperExe', t: 'text', l: 'مسار whisper-server', ltr: 1, dep: ['sttEngine', 'local'] },
    { id: 'whisperModel', t: 'text', l: 'مسار الموديل (الأفضل large-v3 أو medium)', ltr: 1, dep: ['sttEngine', 'local'] }
  ] },
  { h: 'النافذة والمظهر', f: [
    { id: 'fsize', t: 'range', l: 'حجم الخط', min: 13, max: 20, step: 1 },
    { id: 'bg', t: 'check', l: 'حركة الإطار والخلفية' },
    { id: 'glow', t: 'check', l: 'توهّج الكرة' },
    { id: 'wavyFrame', t: 'check', l: 'حواف مموّجة للنافذة (يحتاج إعادة تشغيل)' },
    { id: 'alwaysOnTop', t: 'check', l: 'دائماً فوق' },
    { id: 'startup', t: 'check', l: 'تشغيل مع ويندوز' },
    { id: 'timestamps', t: 'check', l: 'إظهار وقت الرسائل' }
  ] },
  { h: 'التطبيقات والمودات', hint: 'سطر لكل تطبيق بصيغة: الاسم=المسار الكامل. والمود: الاسم=تطبيق1,تطبيق2', f: [
    { id: 'apps', t: 'area', l: 'التطبيقات المسموحة (اسم=مسار)', full: 1 },
    { id: 'modes', t: 'area', l: 'المودات (اسم=تطبيق1,تطبيق2)', full: 1 },
    { id: 'confirmApps', t: 'check', l: 'اسألني قبل تشغيل أي تطبيق' }
  ] }
];
const PC_ONLY = new Set(['wavyFrame', 'alwaysOnTop', 'startup', 'voiceName', 'piperExe', 'piperModel', 'whisperUrl', 'whisperAuto', 'whisperExe', 'whisperModel', 'apps', 'modes', 'confirmApps', 'syncOn', 'syncPort']);
if (WEB) {
  for (let i = SET.length - 1; i >= 0; i--) {
    SET[i].f = SET[i].f.filter((f) => f.t !== 'pw' && !PC_ONLY.has(f.id));
    if (!SET[i].f.length) SET.splice(i, 1);
  }
} else {
  SET.push({ h: 'ربط الجوال', hint: 'شغّله وافتح الرابط من جوالك (نفس الشبكة أو عبر Tailscale). المحادثات تتزامن، وكل مفاتيحك تبقى على البيسي.', sync: 1, f: [
    { id: 'syncOn', t: 'check', l: 'السماح للجوال بالاتصال بهذا الجهاز' },
    { id: 'syncPort', t: 'num', l: 'المنفذ', min: 1024, max: 65535, def: 8765, dep: ['syncOn', 'on'] }
  ] });
}
const ALL_F = SET.flatMap((g) => g.f);

function field(f) {
  const w = document.createElement('div'); w.className = 'fld' + (f.full ? ' full' : ''); w.dataset.id = f.id;
  if (f.dep) w.dataset.dep = f.dep.join(':');
  const lab = document.createElement('label'); lab.textContent = f.l; lab.htmlFor = f.id;
  let el;
  if (f.t === 'select' || f.t === 'voice') {
    el = document.createElement('select');
    if (f.o) Object.entries(f.o).forEach(([v, n]) => el.add(new Option(n, v)));
  } else if (f.t === 'check') {
    el = document.createElement('input'); el.type = 'checkbox'; el.className = 'sw'; w.classList.add('sw-row');
  } else if (f.t === 'area') {
    el = document.createElement('textarea'); el.rows = 4; el.spellcheck = false;
  } else if (f.t === 'range') {
    el = document.createElement('input'); el.type = 'range'; el.min = f.min; el.max = f.max; el.step = f.step; w.classList.add('rng');
  } else if (f.t === 'num') {
    el = document.createElement('input'); el.type = 'number'; el.min = f.min; el.max = f.max;
  } else {
    el = document.createElement('input'); el.type = f.t === 'pw' ? 'password' : 'text'; el.spellcheck = false; el.autocomplete = 'off';
    if (f.ltr || f.t === 'pw') el.dir = 'ltr';
  }
  el.id = f.id;
  if (f.t === 'check') w.append(lab, el);
  else if (f.t === 'pw') {
    const box = document.createElement('div'); box.className = 'pw';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'ib'; b.innerHTML = ico('eye'); b.title = 'إظهار / إخفاء';
    b.onclick = () => { const s = el.type === 'password'; el.type = s ? 'text' : 'password'; b.innerHTML = ico(s ? 'eyex' : 'eye'); };
    box.append(el, b); w.append(lab, box);
  } else if (f.t === 'range') {
    const rv = document.createElement('span'); rv.className = 'rv'; rv.id = f.id + '_v';
    el.oninput = () => { rv.textContent = el.value + (f.id === 'fsize' ? 'px' : '×'); };
    lab.append(' '); lab.append(rv); w.append(lab, el);
  } else w.append(lab, el);
  return w;
}
function buildSet() {
  const root = $('sf'); root.innerHTML = '';
  SET.forEach((g) => {
    const card = document.createElement('div'); card.className = 'card';
    const h = document.createElement('h3'); h.textContent = g.h; card.append(h);
    if (g.hint) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = g.hint; card.append(p); }
    const grid = document.createElement('div'); grid.className = 'sgrid';
    g.f.forEach((f) => grid.append(field(f)));
    card.append(grid);
    if (g.sync) { const box = document.createElement('div'); box.id = 'syncInfo'; box.className = 'syncinfo'; card.append(box); }
    root.append(card);
  });
  ['provider', 'engine', 'sttEngine'].forEach((id) => { $(id).addEventListener('change', updateDeps); });
  $('voice').addEventListener('change', () => { if ($('voiceName')) $('voiceName').value = ''; collect(); speak('هلا والله، هذا صوتي. كيف أقدر أخدمك؟', true); });
}
function updateDeps() {
  qsa('.fld[data-dep]').forEach((w) => { const [k, v] = w.dataset.dep.split(':'); const c = $(k); w.hidden = !c || !v.split('|').includes(c.value); });
}
function voices() {
  const s = $('voiceName'); if (!s) return;
  const keep = S.voiceName || s.value || '';
  s.innerHTML = ''; s.add(new Option('تلقائي', ''));
  speechSynthesis.getVoices().filter((v) => /^ar/i.test(v.lang)).forEach((v) => s.add(new Option(v.name, v.name)));
  if (keep && ![...s.options].some((o) => o.value === keep)) s.add(new Option(keep, keep));
  s.value = keep;
}
function fillSet() {
  voices();
  ALL_F.forEach((f) => {
    const el = $(f.id); if (!el) return;
    if (f.t === 'check') el.checked = !!S[f.id];
    else { el.value = S[f.id] ?? ''; if (f.t === 'range') el.dispatchEvent(new Event('input')); }
  });
  updateDeps();
}
function collect() {
  ALL_F.forEach((f) => {
    const el = $(f.id); if (!el) return;
    if (f.t === 'check') S[f.id] = el.checked;
    else if (f.t === 'num') S[f.id] = String(clamp(parseInt(el.value, 10) || (f.def || 24), f.min, f.max));
    else if (f.t === 'text' || f.t === 'pw') S[f.id] = el.value.trim();
    else S[f.id] = el.value;
  });
  S.theme = document.documentElement.dataset.theme || 'sky';
}
async function syncInfoDraw() {
  const box = $('syncInfo'); if (!box || !api.sync) return;
  box.innerHTML = '';
  const row = (t, cls) => { const d = document.createElement('div'); d.className = 'srow ' + (cls || ''); if (t) d.textContent = t; box.append(d); return d; };
  let i; try { i = await api.sync.info(); } catch { return; }
  if (!i.on) { row('مقفل. فعّل الخيار فوق واحفظ.', 'dim'); return; }
  if (!i.running) { row('الخادم ما اشتغل. غالباً المنفذ مستخدم؛ غيّره واحفظ.', 'bad'); return; }
  row('شغّال. افتح أحد الروابط التالية من الجوال (الرابط فيه مفتاح خاص، لا تشاركه):', 'ok');
  const links = [];
  if (i.ts && i.ts.dns) links.push(['Tailscale (HTTPS، يحتاج الأمر تحت)', `https://${i.ts.dns}/?t=${i.token}`]);
  if (i.ts) (i.ts.ips || []).filter((x) => /^\d+\./.test(x)).forEach((x) => links.push(['Tailscale', `http://${x}:${i.port}/?t=${i.token}`]));
  i.ips.forEach((x) => links.push(['نفس الواي فاي', `http://${x}:${i.port}/?t=${i.token}`]));
  links.forEach(([n, u]) => {
    const r = row('', 'lnk'), l = document.createElement('div'); l.className = 'ltxt'; l.innerHTML = `<b>${esc(n)}</b><code dir="ltr">${esc(u)}</code>`;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn sm'; b.textContent = 'نسخ';
    b.onclick = async () => { try { await navigator.clipboard.writeText(u); toast('اننسخ الرابط'); } catch { toast('ما قدرت أنسخ'); } };
    r.append(l, b);
  });
  if (!i.ts) row('Tailscale ما انلقى على هذا الجهاز: بدونه الجوال يشتغل فقط وهو على نفس الواي فاي.', 'dim');
  else row('للـ HTTPS (ضروري للمايك وتثبيت التطبيق): شغّل مرة واحدة في موجه الأوامر:  tailscale serve --bg ' + i.port, 'dim');
  const rg = document.createElement('button'); rg.type = 'button'; rg.className = 'btn sm'; rg.textContent = 'غيّر المفتاح (يفصل كل الأجهزة)';
  rg.onclick = async () => { await api.sync.regen(); toast('انغيّر المفتاح، افتح الروابط الجديدة'); syncInfoDraw(); };
  box.append(rg);
}
$('sv').onclick = async () => {
  const wasWavy = S.wavyFrame !== false;
  collect(); const sr = await api.saveSettings(S); applyLook(); chipsDraw(); cardsDraw(); syncInfoDraw();
  if (sr && sr.error) return toast(sr.error);
  if ((S.wavyFrame !== false) !== wasWavy) toast('الحواف تتغير بعد إعادة التشغيل', { label: 'أعد التشغيل الحين', fn: () => api.win.relaunch() });
  else toast('انحفظت الإعدادات');
};
$('pv').onchange = async () => {
  S.provider = $('pv').value; if ($('provider')) { $('provider').value = S.provider; updateDeps(); }
  await saveQuiet(); updateConn(); tipDraw();
};
$('bkexp').onclick = () => {
  collect();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({ settings: S, data: D })], { type: 'application/json' }));
  a.download = 'مساعدي-نسخة-احتياطية.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};
$('bkimp').onclick = () => {
  const i = document.createElement('input'); i.type = 'file'; i.accept = '.json';
  i.onchange = () => {
    if (!i.files.length) return; const r = new FileReader();
    r.onload = async () => {
      try {
        const o = JSON.parse(r.result);
        if (o.settings) { S = { ...S, ...o.settings }; await api.saveSettings(S); fillSet(); applyLook(); }
        if (o.data) { D = normD(o.data); await flush(); curId = D.chats[0]?.id || null; drawSecs(); drawList(); drawChat(); noteDraw(); todoDraw(); }
        toast('رجّعت النسخة الاحتياطية');
      } catch { toast('ملف غير صالح'); }
    };
    r.readAsText(i.files[0]);
  };
  i.click();
};
$('tv').onclick = () => { collect(); speak('هلا والله، هذا صوتي الجديد. كيف تبيني أكلمك؟', true); };

/* ═════════ أصوات قصيرة ═════════ */
let AC = null;
function beep(f) {
  if (!S.sounds) return;
  try {
    AC = AC || new AudioContext(); AC.resume();
    const o = AC.createOscillator(), g = AC.createGain(); o.frequency.value = f;
    g.gain.setValueAtTime(.04, AC.currentTime); g.gain.exponentialRampToValueAtTime(1e-4, AC.currentTime + .14);
    o.connect(g); g.connect(AC.destination); o.start(); o.stop(AC.currentTime + .15);
  } catch {}
}

/* ═════════ عرض النص (ماركداون خفيف وآمن) ═════════ */
function inline(s) {
  const frag = document.createDocumentFragment();
  s.split(/(`[^`\n]+`)/g).forEach((seg, i) => {
    if (i % 2) { const c = document.createElement('code'); c.textContent = seg.slice(1, -1); frag.append(c); }
    else if (seg) {
      const sp = document.createElement('span');
      sp.innerHTML = esc(seg)
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/(^|[\s(،])(https?:\/\/[^\s<)،]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
      frag.append(...sp.childNodes);
    }
  });
  return frag;
}
function textBlocks(text, root) {
  const lines = text.split('\n'); let list = null, para = null;
  const flush = () => { list = null; para = null; };
  for (const raw of lines) {
    const ln = raw.replace(/\s+$/, '');
    if (!ln.trim()) { flush(); continue; }
    let m;
    if ((m = /^\s{0,3}#{1,4}\s+(.*)$/.exec(ln))) { flush(); const h = document.createElement('h4'); h.append(inline(m[1])); root.append(h); continue; }
    if ((m = /^\s*([-*•])\s+(.*)$/.exec(ln)) || (m = /^\s*(\d+)[.)]\s+(.*)$/.exec(ln))) {
      const ordered = /\d/.test(m[1]);
      if (!list || list.tagName !== (ordered ? 'OL' : 'UL')) { list = document.createElement(ordered ? 'ol' : 'ul'); root.append(list); para = null; }
      const li = document.createElement('li'); li.append(inline(m[2])); list.append(li); continue;
    }
    if ((m = /^\s*>\s?(.*)$/.exec(ln))) { flush(); const q = document.createElement('blockquote'); q.append(inline(m[1])); root.append(q); continue; }
    list = null;
    if (!para) { para = document.createElement('p'); root.append(para); } else para.append(document.createElement('br'));
    para.append(inline(ln));
  }
}
function codeBlock(lang, code) {
  const w = document.createElement('div'); w.className = 'code';
  const hd = document.createElement('div'); hd.className = 'code-hd';
  const l = document.createElement('span'); l.textContent = lang || 'code';
  const b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.innerHTML = ico('copy') + 'نسخ';
  b.onclick = () => { navigator.clipboard.writeText(code).then(() => toast('انسخ الكود'), () => toast('ما قدرت أنسخ')); };
  hd.append(l, b);
  const pre = document.createElement('pre'); pre.textContent = code;
  w.append(hd, pre); return w;
}
function mdNode(text) {
  const root = document.createElement('div'); root.className = 'md';
  String(text).split(/(```[\s\S]*?(?:```|$))/g).forEach((p) => {
    if (!p) return;
    if (p.startsWith('```')) {
      const m = /^```([\w+#.-]*)[^\S\n]*\n?([\s\S]*?)(?:```)?$/.exec(p);
      root.append(codeBlock(m ? m[1] : '', (m ? m[2] : p).replace(/\n$/, '')));
    } else textBlocks(p, root);
  });
  return root;
}
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });

/* ═════════ المحادثات ═════════ */
function curChat() { return D.chats.find((c) => c.id === curId); }
function showWelcome(v) {
  $('welcome').style.display = v ? 'flex' : 'none';
  $('log').style.display = v ? 'none' : 'flex';
  placeOrb(v);
}
function mk() {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  D.chats.unshift({ id, title: 'محادثة جديدة', msgs: [], sec: fsec || 0, ts: Date.now() });
  curId = id; persist(true); drawList(); drawChat();
}
function drawSecs() {
  const e = $('secs'); e.innerHTML = '';
  const mkc = (txt, on, fn) => { const b = document.createElement('button'); b.className = 'sc' + (on ? ' on' : ''); b.textContent = txt; b.onclick = fn; return b; };
  e.append(mkc('الكل', fsec === 0, () => { fsec = 0; drawSecs(); drawList(); }));
  D.sections.forEach((s) => {
    const b = mkc((s.name || ''), fsec === s.id, (ev) => {
      if (ev.target.closest('.rm')) { delSection(s); return; }
      fsec = s.id; drawSecs(); drawList();
    });
    const x = document.createElement('span'); x.className = 'rm'; x.innerHTML = ico('x'); x.title = 'احذف القسم';
    b.append(x); e.append(b);
  });
  const add = mkc('', false, async () => {
    const r = await formDialog('قسم جديد', [{ id: 'name', label: 'اسم القسم', value: '' }], 'أضف');
    if (!r || !r.name.trim()) return;
    D.sections.push({ id: Date.now(), name: r.name.trim().slice(0, 24) }); persist(true); drawSecs();
  });
  add.classList.add('add'); add.innerHTML = ico('plus'); add.title = 'قسم جديد'; e.append(add);
}
function delSection(s) {
  const hit = D.chats.filter((c) => c.sec === s.id).map((c) => c.id);
  D.chats.forEach((c) => { if (c.sec === s.id) c.sec = 0; });
  D.sections = D.sections.filter((x) => x.id !== s.id);
  if (fsec === s.id) fsec = 0;
  persist(true); drawSecs(); drawList();
  toast(`حذفت القسم «${s.name}»`, { label: 'تراجع', fn: () => { D.sections.push(s); D.chats.forEach((c) => { if (hit.includes(c.id)) c.sec = s.id; }); persist(true); drawSecs(); drawList(); } });
}
function drawList() {
  const e = $('list'); e.innerHTML = '';
  const q = ($('srch').value || '').trim().toLowerCase();
  const rows = D.chats.filter((c) => (!fsec || c.sec === fsec) && (!q || (c.title || '').toLowerCase().includes(q)));
  if (!rows.length) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = q ? 'ما لقيت شي' : 'ما فيه محادثات للحين'; e.append(d); return; }
  rows.forEach((c) => {
    const d = document.createElement('div'); d.className = 'ci' + (c.id === curId ? ' on' : '');
    const sp = document.createElement('span'); sp.textContent = c.title || 'محادثة';
    const x = document.createElement('button'); x.className = 'del'; x.type = 'button'; x.title = 'احذف'; x.innerHTML = ico('trash');
    x.onclick = (ev) => { ev.stopPropagation(); delChat(c); };
    d.append(sp, x);
    d.onclick = () => { curId = c.id; drawList(); drawChat(); tab('chat'); };
    e.append(d);
  });
}
function delChat(c) {
  const idx = D.chats.findIndex((x) => x.id === c.id); if (idx < 0) return;
  D.chats.splice(idx, 1);
  if (curId === c.id) { curId = D.chats[0]?.id || null; drawChat(); }
  persist(true); drawList();
  toast('انحذفت المحادثة', { label: 'تراجع', fn: () => { D.chats.splice(Math.min(idx, D.chats.length), 0, c); curId = c.id; persist(true); drawList(); drawChat(); } });
}
$('srch').oninput = drawList;
$('new').onclick = () => { mk(); tab('chat'); $('q').focus(); };
$('togHist').onclick = () => { const o = $('hist').classList.toggle('off'); lsSet('histOff', o ? '1' : '0'); };

const scrollEnd = () => { const l = $('log'); l.scrollTop = l.scrollHeight; };
function bubble(role, text, o = {}) {
  const d = document.createElement('div'); d.className = 'm ' + role + (o.err ? ' err' : '');
  d.append(o.err ? Object.assign(document.createElement('div'), { textContent: text }) : mdNode(text));
  if (o.thumbs && o.thumbs.length) {
    const t = document.createElement('div'); t.className = 'thumbs';
    o.thumbs.forEach((u) => { const im = document.createElement('img'); im.src = u; im.alt = ''; t.append(im); });
    d.append(t);
  }
  if (o.files && o.files.length) {
    const f = document.createElement('div'); f.className = 'files';
    o.files.forEach((n) => { const c = document.createElement('span'); c.className = 'fchip'; c.innerHTML = ico('file'); c.append(n); f.append(c); });
    d.append(f);
  }
  const meta = document.createElement('div'); meta.className = 'meta';
  if (S.timestamps !== false && o.ts) { const t = document.createElement('time'); t.textContent = fmtTime(o.ts); meta.append(t); }
  else meta.append(document.createElement('time'));
  const ib = (icon, title, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'ib'; b.title = title; b.innerHTML = ico(icon); b.onclick = fn; meta.append(b); };
  if (role === 'a' && !o.err) {
    ib('copy', 'انسخ', () => navigator.clipboard.writeText(text).then(() => toast('انسخت'), () => toast('ما قدرت أنسخ')));
    ib('vol', 'اقرأها بصوت', () => speak(text, true));
  }
  if (o.err) ib('retry', 'أعد المحاولة', () => { d.remove(); ask(); });
  d.append(meta);
  $('log').append(d); scrollEnd(); return d;
}
function drawChat() {
  const c = curChat();
  $('ttl').textContent = c ? c.title : '';
  $('log').innerHTML = '';
  if (!c || !c.msgs.length) { showWelcome(true); return; }
  showWelcome(false);
  c.msgs.forEach((m) => bubble(m.role === 'user' ? 'u' : 'a', m.display ?? m.content, { ts: m.ts, files: m.files, thumbs: m.thumbs }));
}
$('rn').onclick = async () => {
  const c = curChat(); if (!c) return;
  const f = [{ id: 'title', label: 'اسم المحادثة', value: c.title }];
  if (D.sections.length) f.push({ id: 'sec', label: 'القسم', type: 'select', value: String(c.sec || 0), options: [['0', 'بدون قسم'], ...D.sections.map((s) => [String(s.id), s.name])] });
  const r = await formDialog('تعديل المحادثة', f);
  if (!r) return;
  if (r.title.trim()) c.title = r.title.trim().slice(0, 60);
  if (r.sec !== undefined) c.sec = +r.sec;
  $('ttl').textContent = c.title; persist(true); drawList();
};
$('ex').onclick = () => {
  const c = curChat(); if (!c || !c.msgs.length) return toast('ما فيه شي أصدّره');
  const t = c.msgs.map((m) => (m.role === 'user' ? 'أنا: ' : 'المساعد: ') + (m.display ?? m.content)).join('\n\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/plain' }));
  a.download = (c.title || 'محادثة').replace(/[\\/:*?"<>|]/g, '_') + '.txt'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
};

/* ═════════ الترحيب ═════════ */
const FEATS = [
  ['speak', 'vol', 'الرد الصوتي', 'يقرأ لك الردود بصوت عالٍ'],
  ['sounds', 'bell', 'المؤثرات الصوتية', 'نغمة خفيفة عند الإضافة'],
  ['bg', 'wave', 'الحواف المتحركة', 'حركة ناعمة للإطار والخلفية']
];
function cardsDraw() {
  const c = $('cards'); c.innerHTML = '';
  FEATS.forEach(([k, ic, t, d]) => {
    const l = document.createElement('label'); l.className = 'fcard';
    l.innerHTML = `<span class="fi">${ico(ic)}</span><span class="tx"><b>${esc(t)}</b><small>${esc(d)}</small></span>`;
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.className = 'sw'; cb.checked = S[k] !== false && !!S[k];
    cb.onchange = () => { S[k] = cb.checked; const sEl = $(k); if (sEl) sEl.checked = cb.checked; saveQuiet(); applyLook(); };
    l.append(cb); c.append(l);
  });
}
function tipDraw() {
  const need = needsKey();
  $('tip').hidden = !need && lsGet('tipOff') === '1';
  if (need) {
    $('tipTxt').textContent = 'ما فيه مفتاح للذكاء المختار. حطّ المفتاح في الإعدادات عشان أقدر أرد عليك.';
    $('tipBtn').textContent = 'افتح الإعدادات'; $('tipBtn').onclick = () => tab('set');
  } else {
    $('tipTxt').textContent = 'اختصارات: Alt+Space يظهر أو يخفي المساعد، Ctrl+K للأوامر، Ctrl+N محادثة جديدة.';
    $('tipBtn').textContent = 'جرّب الأوامر'; $('tipBtn').onclick = openPalette;
  }
}
$('tipX').onclick = () => { lsSet('tipOff', '1'); tipDraw(); if (needsKey()) $('tip').hidden = true; };
$('startChat').onclick = () => { $('q').focus(); };
$('startVoice').onclick = () => { if (!micOn) toggleMic(); };

function chipsDraw() {
  const c = $('chips'); c.innerHTML = '';
  (S.modes || '').split('\n').filter((l) => l.includes('=')).forEach((l) => {
    const n = l.split('=')[0].trim(); if (!n) return;
    const b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.innerHTML = ico('play') + esc(n);
    b.onclick = () => { send('شغل مود ' + n); tab('chat'); };
    c.append(b);
  });
}
function qaDraw() {
  $('qa').innerHTML = '';
  ['لخّص', 'ترجم للإنجليزي', 'صحّح لي', 'اشرح الكود', 'اكتب ردّ'].forEach((t) => {
    const b = document.createElement('button'); b.className = 'btn'; b.type = 'button'; b.textContent = t;
    b.onclick = () => { $('q').value = t + ': '; autoGrow(); $('q').focus(); };
    $('qa').append(b);
  });
}

/* ═════════ التنقل ═════════ */
function tab(p) {
  curp = p;
  qsa('.pg').forEach((e) => e.classList.toggle('active', e.id === 'pg-' + p));
  qsa('.rail-btn').forEach((b) => b.classList.toggle('on', b.dataset.p === p));
  if (p === 'chat') setTimeout(() => $('q').focus(), 60);
}
qsa('.rail-btn').forEach((b) => { b.onclick = () => tab(b.dataset.p); });
$('logo').onclick = () => openPalette();

/* ═════════ الإرسال ═════════ */
function autoGrow() { const q = $('q'); q.style.height = 'auto'; q.style.height = Math.min(q.scrollHeight, 140) + 'px'; }
$('q').addEventListener('input', autoGrow);
$('q').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };
$('go').onclick = () => { if (busy) { api.cancel(); stopSp(); } else send(); };
function setBusyUI(b) {
  const g = $('go'); g.classList.toggle('stop', b); g.innerHTML = ico(b ? 'stop' : 'send');
  g.setAttribute('aria-label', b ? 'إيقاف' : 'أرسل');
  if (!b && remotePend) { remotePend = false; flush(); }
}
function trimMedia(c) { c.msgs.slice(0, -4).forEach((m) => { delete m.imgs; delete m.pdfs; }); }   // الصور القديمة تنحذف من السياق عشان ما يكبر الملف
function apiMsg(m) {
  let text = m.content || '';
  const hasI = m.imgs && m.imgs.length, hasP = m.pdfs && m.pdfs.length;
  if (m.hadMedia && !hasI && !hasP) text += '\n[ملاحظة: كان هنا صور أو ملفات مرفقة وانحذفت من السياق لتخفيف الحجم]';
  if (!hasI && !hasP) return { role: m.role, content: text };
  return { role: m.role, content: [
    ...(m.pdfs || []).map((p) => ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.data } })),
    ...(m.imgs || []).map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } })),
    { type: 'text', text: text || '(انظر المرفقات)' }
  ] };
}
async function send(txt) {
  if (busy) return;
  if (ingesting) return toast('انتظر لين أخلّص قراءة الملفات');
  const raw = (txt ?? $('q').value).trim();
  if (!raw && !att.length) return;
  if (!curChat()) mk();
  const c = curChat();
  const imgs = [], pdfs = [], thumbs = []; let extra = '';
  att.forEach((a) => {
    if (a.kind === 'image') { imgs.push({ mime: a.mime, data: a.data }); thumbs.push(a.thumb); }
    else if (a.kind === 'video') { a.frames.forEach((d) => imgs.push({ mime: 'image/jpeg', data: d })); thumbs.push(a.thumb); extra += `\n\n--- ${a.name} ---\n${a.text}`; }
    else if (a.kind === 'pdf') pdfs.push({ name: a.name, data: a.data });
    else extra += `\n\n--- ${a.name} ---\n${a.text}`;
  });
  if (imgs.length > 24) { toast('الحد الأقصى ٢٤ صورة/لقطة في الرسالة، أخذت أول ٢٤'); imgs.length = 24; }
  const m = { role: 'user', content: raw + extra, ts: Date.now() };
  if (att.length) {
    m.display = raw || '(ملفات مرفقة)'; m.files = att.filter((a) => a.kind !== 'image').map((a) => a.name);
    if (thumbs.length) m.thumbs = thumbs;
    if (imgs.length) m.imgs = imgs; if (pdfs.length) m.pdfs = pdfs;
    if (imgs.length || pdfs.length) m.hadMedia = true;
  }
  c.msgs.push(m); c.ts = m.ts; trimMedia(c);
  showWelcome(false);
  bubble('u', m.display ?? m.content, { ts: m.ts, files: m.files, thumbs: m.thumbs });
  $('q').value = ''; autoGrow(); att = []; trayDraw();
  persist(true); drawList();
  await ask();
}
async function ask() {
  const c = curChat(); if (!c || busy) return;
  busy = true; setBusyUI(true); stopSp(true); setOrb('think');
  const dots = document.createElement('div'); dots.className = 'm a'; dots.innerHTML = '<span class="dots"><span></span><span></span><span></span></span>';
  $('log').append(dots); scrollEnd();
  const n = Math.max(4, parseInt(S.maxHistory, 10) || 24);
  const msgs = c.msgs.slice(-n).map(apiMsg);
  let r;
  try { r = await api.chat(msgs, {}); } catch (e) { r = { error: e.message || String(e) }; }
  dots.remove(); busy = false; setBusyUI(false);
  const here = curChat() === c;
  if (r.aborted) { toast('أوقفت الرد'); settleOrb(); return; }
  if (r.error) { if (here) bubble('a', r.error, { err: true }); else toast(r.error); settleOrb(); return; }
  const ans = r.text || '(ما وصلني رد)';
  const m = { role: 'assistant', content: ans, ts: Date.now() };
  c.msgs.push(m); persist(true);
  if (here) bubble('a', ans, { ts: m.ts }); else toast(`وصل رد في «${c.title}»`);
  settleOrb();
  const first = c.msgs.length <= 3 && c.title === 'محادثة جديدة';
  if (S.autoTitle && first) {
    const src = c.msgs[0].display ?? c.msgs[0].content;
    api.titleGen(src || ans).then((t) => { if (t) { c.title = t.slice(0, 40); if (curChat() === c) $('ttl').textContent = c.title; persist(true); drawList(); } }).catch(() => {});
  }
  if (here) speak(ans);
}

/* ═════════ الملفات المرفقة (صور، فيديو، صوت، PDF، Office، نصوص) ═════════ */
const IMG_RE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i, VID_RE = /\.(mp4|webm|mov|m4v|mkv|avi|ogv)$/i, AUD_RE = /\.(mp3|wav|m4a|ogg|oga|opus|flac|aac|weba)$/i;
const DOC_RE = /\.(docx|pptx|xlsx|odt|ods|odp|rtf|epub)$/i;
let ingesting = 0;
const b64 = (u) => u.slice(u.indexOf(',') + 1);
function toB64(ab) { const u = new Uint8Array(ab); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('img')); i.src = src; }); }
function shrink(src, w, h, max, q) {
  const sc = Math.min(1, max / Math.max(w, h)), c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * sc)); c.height = Math.max(1, Math.round(h * sc));
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', q);
}
async function readImage(f) {
  const url = URL.createObjectURL(f);
  try { const im = await loadImg(url), w = im.naturalWidth, h = im.naturalHeight;
    return { kind: 'image', name: f.name, mime: 'image/jpeg', data: b64(shrink(im, w, h, 1568, .82)), thumb: shrink(im, w, h, 1000, .78) };
  } finally { URL.revokeObjectURL(url); }
}
const once = (el, ev, ms) => new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('timeout')), ms);
  el.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true });
  el.addEventListener('error', () => { clearTimeout(t); rej(new Error('error')); }, { once: true });
});
async function readVideo(f) {
  const url = URL.createObjectURL(f), v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.src = url;
  try {
    await once(v, 'loadeddata', 25000);
    const dur = isFinite(v.duration) ? v.duration : 0, n = dur > 0 ? clamp(Math.ceil(dur / 12), 4, 8) : 1, frames = []; let thumb = '';
    for (let i = 0; i < n; i++) {
      v.currentTime = dur > 0 ? (i + .5) / n * dur : 0; await once(v, 'seeked', 15000);
      const w = v.videoWidth, h = v.videoHeight;
      frames.push(b64(shrink(v, w, h, 1024, .75))); if (!i) thumb = shrink(v, w, h, 1000, .78);
    }
    let tr = '';
    if (f.size <= 80e6 && dur <= 600) {
      try { const r = await api.stt(wav16(await decodeTo16k(await f.arrayBuffer())), { lang: 'auto' }); if (r.text) tr = r.text; else if (r.error) toast('تعذّر تفريغ صوت الفيديو: ' + r.error); } catch {}
    }
    const meta = `فيديو «${f.name}» — المدة ${Math.round(dur)} ثانية، الأبعاد ${v.videoWidth}×${v.videoHeight}. أرفقت ${frames.length} لقطات موزعة بالترتيب على مدة الفيديو.`;
    return { kind: 'video', name: f.name, frames, thumb, text: meta + (tr ? '\nتفريغ الصوت:\n' + tr : '') };
  } finally { URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); }
}
async function readAudio(f) {
  const r = await api.stt(wav16(await decodeTo16k(await f.arrayBuffer())), { lang: 'auto' });
  if (r.error) throw new Error(r.error);
  return { kind: 'audio', name: f.name, text: `تفريغ الملف الصوتي «${f.name}»:\n` + (r.text || '(ما سمعت كلام)') };
}
async function looksText(f) {
  const u = new Uint8Array(await f.slice(0, 4096).arrayBuffer());
  if (!u.length) return false; for (const b of u) if (b === 0) return false;
  try { new TextDecoder('utf-8', { fatal: true }).decode(u.subarray(0, u.length - 3)); return true; } catch { return false; }
}
async function ingestOne(f, toRe) {
  const n = f.name, big = (mb) => { if (f.size > mb * 1e6) { toast(`«${n}» كبير، الحد ${mb} ميجا`); return true; } return false; };
  if (/\.(heic|heif)$/i.test(n)) return toast('صيغة HEIC ما تنفتح هنا، حوّلها إلى JPG أو PNG');
  if (IMG_RE.test(n) || (f.type.startsWith('image/') && !/svg/.test(f.type))) { if (big(30)) return; att.push(await readImage(f)); return; }
  if (VID_RE.test(n) || f.type.startsWith('video/')) { if (big(1500)) return; toast(`جاري قراءة الفيديو «${n}»…`); att.push(await readVideo(f)); hideToast(); return; }
  if (AUD_RE.test(n) || f.type.startsWith('audio/')) { if (big(80)) return; toast(`جاري تفريغ «${n}»…`); att.push(await readAudio(f)); hideToast(); return; }
  if (/\.pdf$/i.test(n)) {
    if (big(12)) return;
    if (S.provider !== 'anthropic') toast('ملاحظة: PDF يقرأه Claude فقط، المزوّد الحالي ما يدعمه');
    att.push({ kind: 'pdf', name: n, data: toB64(await f.arrayBuffer()) }); return;
  }
  if (DOC_RE.test(n)) {
    if (big(25)) return; const r = await api.extract(await f.arrayBuffer(), n);
    if (r.error) toast(r.error); else att.push({ kind: 'text', name: n, text: r.text }); return;
  }
  if (/\.zip$/i.test(n)) {
    if (big(25)) return; const r = await api.archive(await f.arrayBuffer(), 'zip');
    if (r.error) toast(r.error); else att.push({ kind: 'text', name: n, text: r.text.slice(0, 60000) }); return;
  }
  if (/\.(rar|7z|tar|gz)$/i.test(n)) return toast('الأرشيف هذا ما أقدر أفكه مباشرة. حوّله إلى ZIP أو فكّه وارفع ملفاته.');
  if (TEXT_RE.test(n) || await looksText(f)) {
    if (big(8)) return; const t = (await f.text()).slice(0, 60000);
    if (toRe) { $('reInput').value = t; toast(`حطيت «${n}» في الصندوق`); } else att.push({ kind: 'text', name: n, text: t }); return;
  }
  toast(`«${n}» نوع ما أقدر أقرأه. جرّب صورة، فيديو، PDF، Word، Excel، نص أو ZIP.`);
}
async function ingest(files, toRe) {
  ingesting++;
  try { for (const f of files) { try { await ingestOne(f, toRe); } catch (e) { toast(`ما قدرت أقرأ «${f.name}»` + (e && e.message ? ': ' + e.message : '')); } trayDraw(); } }
  finally { ingesting--; trayDraw(); }
}
function trayDraw() {
  const t = $('tray'); t.innerHTML = '';
  att.forEach((a, i) => {
    const c = document.createElement('span'); c.className = 'fchip';
    if (a.thumb) { const im = document.createElement('img'); im.src = a.thumb; c.append(im); } else c.innerHTML = ico('file');
    c.append(a.name + (a.kind === 'video' ? ` (${a.frames.length} لقطات)` : ''));
    const x = document.createElement('button'); x.type = 'button'; x.innerHTML = ico('x'); x.title = 'إزالة';
    x.onclick = () => { att.splice(i, 1); trayDraw(); };
    c.append(x); t.append(c);
  });
}
$('att').onclick = () => {
  const i = document.createElement('input'); i.type = 'file'; i.multiple = true;
  i.onchange = () => ingest([...i.files], false); i.click();
};
$('q').addEventListener('paste', (e) => {
  const fs = [...((e.clipboardData && e.clipboardData.files) || [])];
  if (fs.length) { e.preventDefault(); ingest(fs, false); }
});
let dragN = 0;
const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
addEventListener('dragenter', (e) => { if (hasFiles(e)) { e.preventDefault(); dragN++; $('drop').classList.add('on'); } });
addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragN <= 0) { dragN = 0; $('drop').classList.remove('on'); } });
addEventListener('drop', (e) => {
  if (!hasFiles(e)) return; e.preventDefault(); dragN = 0; $('drop').classList.remove('on');
  ingest([...e.dataTransfer.files], curp === 're');
});

/* ═════════ الصوت: التكلم ═════════ */
function speechText(t) {
  return String(t).replace(/```[\s\S]*?```/g, ' (كود) ').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'رابط').replace(/[*_#>]+/g, '').replace(/\s+/g, ' ').trim();
}
function chunks(t, max = 180) {
  const out = []; let cur = '';
  t.split(/(?<=[.!؟?،\n])\s+/).forEach((s) => {
    while (s.length > max) { out.push((cur + ' ' + s.slice(0, max)).trim()); cur = ''; s = s.slice(max); }
    if ((cur + ' ' + s).length > max) { if (cur) out.push(cur); cur = s; } else cur = (cur + ' ' + s).trim();
  });
  if (cur) out.push(cur);
  return out;
}
const MALE_RE = /naayf|hamed|shakir|salman|fahed|taim|maged|ismael|bassel|omar|jamal|male/i;
const FEM_RE = /zariyah|hoda|salma|laila|amina|fatima|iman|reem|sana|female/i;
function pickVoice() {
  const ar = speechSynthesis.getVoices().filter((v) => /^ar/i.test(v.lang));
  if (!ar.length) return null;
  const male = S.voice === 'male', want = male ? MALE_RE : FEM_RE, opp = male ? FEM_RE : MALE_RE;
  const named = S.voiceName && ar.find((v) => v.name === S.voiceName);
  if (named) return { v: named, pitch: 1 };
  const hit = ar.filter((v) => want.test(v.name)).sort((a, b) => (/SA/i.test(b.lang) ? 1 : 0) - (/SA/i.test(a.lang) ? 1 : 0))[0];
  if (hit) return { v: hit, pitch: 1 };
  const neutral = ar.find((v) => !opp.test(v.name));            // ما فيه صوت بالجنس المطلوب: نعدّل النبرة
  return { v: neutral || ar[0], pitch: male ? .78 : 1.12 };
}
async function ensureVoices() {
  if (speechSynthesis.getVoices().length) return;
  await new Promise((r) => { const t = setTimeout(r, 1500); speechSynthesis.addEventListener('voiceschanged', () => { clearTimeout(t); r(); }, { once: true }); });
}
function stopSp(silent) {
  spkId++; speechSynthesis.cancel();
  if (audioEl) { try { audioEl.pause(); } catch {} audioEl = null; }
  if (!silent) settleOrb();
}
$('mute').onclick = () => { stopSp(); if (busy) api.cancel(); };
async function speak(text, force) {
  if ((!S.speak && !force) || !text) return;
  const t = speechText(text); if (!t) return;
  const my = ++spkId; speechSynthesis.cancel();
  if (audioEl) { try { audioEl.pause(); } catch {} audioEl = null; }
  const done = () => { if (my === spkId) settleOrb(); };
  setOrb('speak');
  if (S.engine === 'windows' || !S.engine) {
    await ensureVoices(); if (my !== spkId) return;
    const pk = pickVoice();
    if (!pk) { toast('ما فيه صوت عربي منصّب في ويندوز. ثبّته من الإعدادات ← الوقت واللغة ← الكلام ← إضافة أصوات ← العربية، أو غيّر محرك الصوت من إعدادات الصوت.'); return done(); }
    const parts = chunks(t); if (!parts.length) return done();
    let started = false;
    speechSynthesis.cancel(); speechSynthesis.resume();
    setTimeout(() => {
      if (my !== spkId) return;
      parts.forEach((p, i) => {
        const u = new SpeechSynthesisUtterance(p); u.lang = pk.v.lang || 'ar-SA'; u.voice = pk.v; u.pitch = pk.pitch; u.rate = parseFloat(S.rate) || 1;
        if (i === 0) u.onstart = () => { started = true; };
        if (i === parts.length - 1) u.onend = done;
        u.onerror = (ev) => { if (ev.error !== 'canceled' && ev.error !== 'interrupted') { toast('تعذّر تشغيل الصوت: ' + ev.error); done(); } };
        speechSynthesis.speak(u);
      });
      setTimeout(() => { if (my === spkId && !started) { speechSynthesis.cancel(); toast('الصوت ما اشتغل. جرّب محرك صوت ثاني من الإعدادات.'); done(); } }, 5000);
    }, 80);
    return;
  }
  try {
    const r = await api.tts(t.slice(0, 2500));
    if (my !== spkId) return;
    if (r.error) { toast(r.error); return done(); }
    const url = URL.createObjectURL(new Blob([r.audio], { type: r.mime }));
    const a = audioEl = new Audio(url);
    a.onended = () => { URL.revokeObjectURL(url); done(); };
    a.onerror = () => { toast('ما قدرت أشغّل الصوت'); done(); };
    await a.play();
  } catch { toast('فشل الصوت'); done(); }
}

/* ═════════ الصوت: الاستماع ═════════ */
function wav16(f32) {
  const n = f32.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true); v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const s = clamp(f32[i], -1, 1); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return buf;
}
/* يفك أي ملف صوت/فيديو إلى 16kHz أحادي، ويرفع مستوى الصوت لو كان واطي (يفيد دقة التعرف) */
async function decodeTo16k(ab) {
  const ctx = new AudioContext();
  try {
    const dec = await ctx.decodeAudioData(ab);
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(Math.min(dec.duration, 600) * 16000)), 16000);
    const s = off.createBufferSource(); s.buffer = dec; s.connect(off.destination); s.start();
    const out = (await off.startRendering()).getChannelData(0);
    let pk = 0; for (let i = 0; i < out.length; i++) { const a = Math.abs(out[i]); if (a > pk) pk = a; }
    if (pk > .005) { const g = Math.min(8, .9 / pk); if (g > 1.05) for (let i = 0; i < out.length; i++) out[i] *= g; }
    return out;
  } finally { ctx.close(); }
}
const toWav16k = async (blob) => wav16(await decodeTo16k(await blob.arrayBuffer()));
const STT_JUNK = /(اشترك(وا)? في (ال)?قناة|ترجمة نانسي قنقر|شكرا? (ل)?(لمشاهدتكم|للمشاهدة)|thanks for watching|subtitles by)/i;
function micUI(on) {
  micOn = on; const m = $('mic'); m.classList.toggle('rec', on);
  m.innerHTML = ico(on ? 'stop' : 'mic') + `<span>${on ? 'إيقاف' : 'كلّمني'}</span>`;
}
async function toggleMic() {
  if (micOn) { if (micCtl) micCtl.finish(); return; }
  if (busy) return toast('انتظر الرد يخلص أول');
  stopSp(true);
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: true } }); }
  catch { toast('ما قدرت أوصل للمايك. تأكد من إذن المايك في ويندوز.'); return; }
  const ctx = new AudioContext(), an = ctx.createAnalyser(); an.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(an);
  const rec = new MediaRecorder(stream), parts = [], buf = new Float32Array(an.fftSize);
  let heard = false, lastLoud = 0, raf = 0, cancelled = false, stopped = false, floor = 0, fn = 0, above = 0;
  const t0 = performance.now();
  rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
  const cleanup = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); ctx.close(); micCtl = null; micUI(false); };
  rec.onstop = async () => {
    cleanup();
    if (cancelled) return settleOrb();
    if (!heard) { toast('ما سمعت شي، جرّب مرة ثانية'); return settleOrb(); }
    setOrb('think');
    try {
      const r = await api.stt(await toWav16k(new Blob(parts, { type: rec.mimeType || 'audio/webm' })), { lang: 'ar' });
      settleOrb();
      if (r.error) return toast(r.error);
      const txt = (r.text || '').trim();
      if (!txt || STT_JUNK.test(txt)) return toast('ما فهمت الكلام، جرّب مرة ثانية');
      if (S.sttAuto) send(txt);
      else { const q = $('q'); q.value = (q.value ? q.value + ' ' : '') + txt; autoGrow(); q.focus(); toast('راجع النص وعدّله إذا تبي، وبعدها اضغط إرسال'); }
    } catch { toast('ما قدرت أعالج الصوت'); settleOrb(); }
  };
  const finish = (cancel) => { if (stopped) return; stopped = true; cancelled = !!cancel; if (rec.state !== 'inactive') rec.stop(); };
  micCtl = { finish, cancel: () => finish(true) };
  const loop = () => {
    raf = requestAnimationFrame(loop);
    an.getFloatTimeDomainData(buf);
    let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length), now = performance.now();
    orb.style.setProperty('--lvl', clamp(rms * 7, 0, 1).toFixed(2));
    if (now - t0 < 500) { floor = Math.min(.02, (floor * fn + rms) / (fn + 1)); fn++; }      // نقيس ضجيج الغرفة أول نص ثانية
    const thr = Math.max(.012, floor * 2.8);
    if (rms > thr) { if (++above >= 3) { heard = true; lastLoud = now; } } else above = 0;
    if (heard && now - lastLoud > 1800) finish();
    else if (!heard && now - t0 > 10000) finish();
    else if (now - t0 > 60000) finish();
  };
  rec.start(); micUI(true); setOrb('listen'); loop();
}
$('mic').onclick = toggleMic;

/* ═════════ هندسة عكسية ═════════ */
const RE_P = {
  analyze: 'قم بهندسة عكسية وتحليل عميق للكود أو النص التالي. اشرح البنية، المنطق، أي تشفير أو تشويش، واقترح طريقة فك أو تحسين:\n\n',
  decrypt: 'حاول فك تشفير أو فك تشويش (deobfuscate) النص/الكود التالي. جرب Base64 و Hex و ROT و XOR بسيط وأي نمط واضح، واعرض النتيجة مع الشرح:\n\n',
  explain: 'اشرح هذا الكود بالتفصيل بالعربية، سطر بسطر إن لزم، ووضح ماذا يفعل:\n\n'
};
async function reSend(mode) {
  const text = $('reInput').value.trim();
  if (!text) return toast('الصق شي أول');
  if (reBusy || busy) return;
  reBusy = true; setOrb('think');
  $('reResult').innerHTML = '<span class="dots"><span></span><span></span><span></span></span>';
  const prompt = RE_P[mode] + text;
  const r = await api.chat([{ role: 'user', content: prompt }], 'هذا قسم الهندسة العكسية: أجب بتنسيق واضح وضع الكود داخل كتل ```.').catch((e) => ({ error: e.message }));
  reBusy = false; settleOrb();
  if (r.aborted) { $('reResult').innerHTML = '<span class="muted">أُوقف التحليل.</span>'; return; }
  if (r.error) { reOut = ''; $('reResult').textContent = r.error; return; }
  reOut = r.text || '';
  $('reResult').replaceChildren(mdNode(reOut));
  $('reResult').dataset.prompt = prompt;
}
$('reAnalyze').onclick = () => reSend('analyze');
$('reDecrypt').onclick = () => reSend('decrypt');
$('reExplain').onclick = () => reSend('explain');
$('reClear').onclick = () => { $('reInput').value = ''; reOut = ''; $('reResult').innerHTML = '<span class="muted">النتيجة تظهر هنا…</span>'; };
$('reCopy').onclick = () => { if (!reOut) return toast('ما فيه نتيجة'); navigator.clipboard.writeText(reOut).then(() => toast('انسخت النتيجة'), () => toast('ما قدرت أنسخ')); };
$('reToChat').onclick = () => {
  if (!reOut) return toast('ما فيه نتيجة');
  mk(); const c = curChat(); c.title = 'هندسة عكسية';
  c.msgs.push({ role: 'user', content: $('reResult').dataset.prompt || '', display: 'تحليل كود من صفحة الهندسة العكسية', ts: Date.now() }, { role: 'assistant', content: reOut, ts: Date.now() });
  persist(true); drawList(); drawChat(); tab('chat');
};

/* ═════════ الملاحظات والمهام ═════════ */
function noteDraw() {
  const e = $('nl'); e.innerHTML = '';
  if (!D.notes.length) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = 'ما عندك ملاحظات للحين'; e.append(d); return; }
  D.notes.forEach((n, i) => {
    const o = typeof n === 'string' ? { t: n } : n;
    const d = document.createElement('div'); d.className = 'note';
    const p = document.createElement('p'); p.textContent = o.t;
    const a = document.createElement('div'); a.className = 'nact';
    const b = (l, ic, f) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'btn'; x.innerHTML = ico(ic) + l; x.onclick = f; a.append(x); };
    b('نسخ', 'copy', () => navigator.clipboard.writeText(o.t).then(() => toast('انسخت'), () => toast('ما قدرت أنسخ')));
    b('اسأل المساعد', 'chat', () => { $('q').value = 'عندي هالملاحظة: ' + o.t + '\n'; autoGrow(); tab('chat'); });
    b('احذف', 'trash', () => { const [rm] = D.notes.splice(i, 1); noteDraw(); persist(true); toast('انحذفت الملاحظة', { label: 'تراجع', fn: () => { D.notes.splice(i, 0, rm); noteDraw(); persist(true); } }); });
    if (o.ts) { const t = document.createElement('time'); t.textContent = new Date(o.ts).toLocaleDateString('ar-SA'); a.append(t); }
    d.append(p, a); e.append(d);
  });
}
$('nsv').onclick = () => {
  const v = $('nt').value.trim(); if (!v) return toast('اكتب الملاحظة أول');
  D.notes.unshift({ t: v, ts: Date.now() }); $('nt').value = ''; noteDraw(); persist(true); beep(600);
};
function todoDraw() {
  const e = $('todo'); e.innerHTML = '';
  const done = D.tasks.filter((t) => t.done).length;
  $('todoSub').textContent = D.tasks.length ? `أنجزت ${done} من ${D.tasks.length}` : 'رتّب يومك بمهام صغيرة.';
  $('tdc').hidden = !done;
  if (!D.tasks.length) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = 'ما عندك مهام. ضيف أول مهمة!'; e.append(d); return; }
  D.tasks.forEach((t, i) => {
    const d = document.createElement('div'); d.className = 'todo-item' + (t.done ? ' done' : '');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!t.done;
    cb.onchange = () => { t.done = cb.checked; todoDraw(); persist(); if (t.done) beep(760); };
    const sp = document.createElement('span'); sp.textContent = t.t;
    const del = document.createElement('button'); del.type = 'button'; del.className = 'ib sm'; del.innerHTML = ico('trash'); del.title = 'احذف';
    del.onclick = () => { D.tasks.splice(i, 1); todoDraw(); persist(true); };
    d.append(cb, sp, del); e.append(d);
  });
}
$('tda').onclick = () => { const v = $('tdi').value.trim(); if (!v) return toast('اكتب المهمة أول'); D.tasks.unshift({ t: v, done: false }); $('tdi').value = ''; todoDraw(); persist(true); beep(600); };
$('tdi').onkeydown = (e) => { if (e.key === 'Enter') $('tda').click(); };
$('tdc').onclick = () => { D.tasks = D.tasks.filter((t) => !t.done); todoDraw(); persist(true); };

/* ═════════ الحاسبة ═════════ */
const KEYS = [['C', 'fn'], ['(', 'fn'], [')', 'fn'], ['back', 'fn'], ['7'], ['8'], ['9'], ['÷', 'op'], ['4'], ['5'], ['6'], ['×', 'op'], ['1'], ['2'], ['3'], ['−', 'op'], ['0'], ['.'], ['%', 'op'], ['+', 'op'], ['=', 'eq']];
const SYM = { '÷': '/', '×': '*', '−': '-' };
let cex = '', cjustEq = false;
const showEx = (s) => s.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
function calcInput(k) {
  const ce = $('ce'), cr = $('cr');
  if (k === 'C') { cex = ''; cr.textContent = ''; ce.textContent = '0'; cjustEq = false; return; }
  if (k === 'back') { cex = cex.slice(0, -1); ce.textContent = showEx(cex) || '0'; return; }
  if (k === '=') {
    if (!cex) return;
    try {
      const r = Calc.format(Calc.evaluate(cex));
      cr.textContent = showEx(cex) + ' ='; addHist(showEx(cex), r); cex = r; ce.textContent = r; cjustEq = true;
    } catch (e) { cr.textContent = e.message; }
    return;
  }
  const v = SYM[k] || k;
  if (cjustEq && /[\d.(]/.test(v)) cex = '';
  cjustEq = false;
  cex += v; ce.textContent = showEx(cex);
}
function addHist(expr, res) {
  const h = $('chist'); if (!h.querySelector('div')) h.innerHTML = '';
  const d = document.createElement('div'); d.textContent = `${expr} = ${res}`; d.onclick = () => { cex = res; $('ce').textContent = res; cjustEq = true; };
  h.prepend(d); while (h.children.length > 30) h.lastChild.remove();
}
(function () {
  const e = $('keys');
  KEYS.forEach(([k, cls]) => {
    const b = document.createElement('button'); b.type = 'button'; if (cls) b.className = cls;
    if (k === 'back') b.innerHTML = ico('back'); else b.textContent = k;
    b.onclick = () => calcInput(k); e.append(b);
  });
})();
addEventListener('keydown', (e) => {
  if (curp !== 'calc' || e.ctrlKey || e.altKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
  if (/^[0-9.()+\-*/%^]$/.test(e.key)) { calcInput(e.key === '^' ? '^' : e.key); e.preventDefault(); }
  else if (e.key === 'Enter' || e.key === '=') { calcInput('='); e.preventDefault(); }
  else if (e.key === 'Backspace') calcInput('back');
  else if (e.key === 'Escape' || e.key === 'Delete') calcInput('C');
});

/* ═════════ حوار عام ═════════ */
function formDialog(title, fields, okLabel = 'تم') {
  return new Promise((res) => {
    $('dlgTitle').textContent = title; $('dlgOk').textContent = okLabel;
    const body = $('dlgBody'); body.innerHTML = '';
    fields.forEach((f) => {
      const w = document.createElement('div'); w.className = 'fld';
      const l = document.createElement('label'); l.textContent = f.label; l.htmlFor = 'dlg_' + f.id;
      let el;
      if (f.type === 'select') { el = document.createElement('select'); f.options.forEach(([v, n]) => el.add(new Option(n, v))); }
      else { el = document.createElement('input'); el.type = 'text'; el.maxLength = 80; el.autocomplete = 'off'; }
      el.id = 'dlg_' + f.id; el.value = f.value ?? '';
      w.append(l, el); body.append(w);
    });
    const dlg = $('dlg');
    dlg.onclose = () => {
      if (dlg.returnValue === 'ok') { const o = {}; fields.forEach((f) => { o[f.id] = $('dlg_' + f.id).value; }); res(o); } else res(null);
    };
    dlg.returnValue = ''; dlg.showModal();
    setTimeout(() => { const f = $('dlg_' + fields[0].id); f.focus(); if (f.select) f.select(); }, 30);
  });
}

/* ═════════ لوحة الأوامر ═════════ */
function setProv(p) { $('pv').value = p; $('pv').onchange(); }
function cmds() {
  const c = [
    ['chat', 'محادثة جديدة', () => { mk(); tab('chat'); }],
    ['binary', 'هندسة عكسية', () => tab('re')],
    ['calc', 'الحاسبة', () => tab('calc')],
    ['note', 'ملاحظاتي', () => tab('notes')],
    ['tasks', 'مهامي', () => tab('todo')],
    ['sliders', 'الإعدادات', () => tab('set')],
    ['volx', 'وقّف الصوت', () => stopSp()],
    ['down', 'صدّر المحادثة', () => $('ex').click()]
  ];
  Object.entries(PROV).forEach(([p, n]) => c.push(['brain', 'استخدم ' + n, () => setProv(p)]));
  (S.modes || '').split('\n').filter((l) => l.includes('=')).forEach((l) => { const n = l.split('=')[0].trim(); if (n) c.push(['play', 'مود ' + n, () => { tab('chat'); send('شغل مود ' + n); }]); });
  D.sections.forEach((s) => c.push(['file', 'قسم ' + s.name, () => { fsec = s.id; drawSecs(); drawList(); tab('chat'); }]));
  return c;
}
let cpi = 0, cpl = [];
function cpDraw() {
  const q = $('cpq').value.trim(); cpl = cmds().filter((x) => x[1].includes(q)); cpi = 0;
  const e = $('cpl'); e.innerHTML = '';
  cpl.forEach((x, i) => {
    const d = document.createElement('div'); d.innerHTML = ico(x[0]); d.append(x[1]); if (!i) d.className = 'on';
    d.onclick = () => { $('cp').close(); x[2](); }; e.append(d);
  });
}
function openPalette() { $('cpq').value = ''; cpDraw(); if (!$('cp').open) $('cp').showModal(); $('cpq').focus(); }
$('cpq').oninput = cpDraw;
$('cpq').onkeydown = (e) => {
  const it = $('cpl').children;
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && it.length) {
    e.preventDefault(); it[cpi].classList.remove('on'); cpi = (cpi + (e.key === 'ArrowDown' ? 1 : -1) + it.length) % it.length;
    it[cpi].classList.add('on'); it[cpi].scrollIntoView({ block: 'nearest' });
  }
  if (e.key === 'Enter' && cpl[cpi]) { $('cp').close(); cpl[cpi][2](); }
};
$('cp').addEventListener('click', (e) => { if (e.target === $('cp')) $('cp').close(); });
addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); mk(); tab('chat'); }
  else if (e.key === 'Escape' && !$('cp').open && !$('dlg').open) {
    if (micCtl) micCtl.cancel(); else if (busy) { api.cancel(); stopSp(); } else stopSp();
  }
});

/* ═════════ البداية ═════════ */
async function init() {
  try {
    S = await api.getSettings();
    D = normD(await api.getChats()); Sync.fix(D); Sync.resnap(D, snap);
    await initWin();
    buildSet(); fillSet(); syncInfoDraw(); cardsDraw(); qaDraw(); chipsDraw();
    applyLook();
    if (lsGet('histOff') === '1' || matchMedia('(max-width:760px)').matches) $('hist').classList.add('off');
    const closeH = () => { if (matchMedia('(max-width:760px)').matches) $('hist').classList.add('off'); };
    $('hback').addEventListener('click', () => $('hist').classList.add('off'));
    $('list').addEventListener('click', closeH); $('new').addEventListener('click', closeH);
    drawSecs(); drawList();
    curId = D.chats[0]?.id || null;
    drawChat(); noteDraw(); todoDraw();
    micUI(false); setBusyUI(false); setOrb('idle');
    speechSynthesis.onvoiceschanged = voices;
    if (matchMedia('(max-width:760px)').matches) $('q').placeholder = 'اكتب رسالتك…';
    api.onChatsChanged?.(() => flush());
    api.onTimer?.((t) => { toast('انتهى المؤقت: ' + t); beep(880); });
  } catch (e) {
    toast('صار خطأ أثناء التشغيل: ' + (e.message || e));
  } finally {
    setTimeout(() => $('splash').classList.add('hide'), 450);
  }
}
init();
})();
