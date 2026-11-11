'use strict';
const { app, BrowserWindow, ipcMain, shell, Notification, globalShortcut, screen, dialog, safeStorage } = require('electron');
const fs = require('fs'), path = require('path'), zlib = require('zlib'), { spawn } = require('child_process');
/* مجلد البيانات: نثبّته على المجلد القديم اللي فيه محادثاتك وإعداداتك، عشان تغيير الاسم أو الأيقونة ما يضيّع شي */
try {
  const base = app.getPath('appData');
  const found = ['murattib-assistant', 'Electron', 'مساعدي'].map((n) => path.join(base, n))
    .find((d) => ['chats.json', 'settings.json', 'memory.json'].some((f) => fs.existsSync(path.join(d, f))));
  if (found) app.setPath('userData', found);
} catch {}
const os = require('os'), crypto = require('crypto');
const Calc = require('./calc'), Sync = require('./sync'), Srv = require('./server');

let win = null, whisperProc = null, httpSrv = null;
const chatCtls = new Map();
let maxed = false, prevBounds = null, custom = true;
const MIN_W = 900, MIN_H = 620;

/* ───────────── ملفات وإعدادات ───────────── */
const SECRET = ['key', 'freeKey', 'grokKey', 'elKey', 'sttKey', 'openaiKey', 'syncToken'];
const DEF = {
  uiv: 2, provider: 'anthropic', key: '', model: 'claude-sonnet-5-5', ollamaModel: 'llama3.1', ollamaThink: false,
  whisperExe: '', whisperModel: '', whisperAuto: false, whisperUrl: 'http://127.0.0.1:8080/inference',
  autoTitle: true, maxHistory: '24', alwaysOnTop: false, startup: false, timestamps: true, confirmApps: false,
  style: 'najdi', freePreset: 'gemini', freeKey: '', freeModel: 'gemini-2.5-flash', grokKey: '', grokModel: 'grok-4.7',
  bg: true, glow: true, wavyFrame: true, fsize: '16', theme: 'sky',
  engine: 'windows', voiceName: '', rate: '1', elKey: '', elVoiceM: '', elVoiceF: '', piperExe: '', piperModel: '',
  sounds: true, voice: 'female', speak: true, apps: '', modes: '',
  sttEngine: 'local', sttKey: '', sttAuto: false, openaiKey: '',
  syncOn: false, syncPort: 8765, syncToken: ''
};
const UD = (f) => path.join(app.getPath('userData'), f);
const SF = () => UD('settings.json'), MF = () => UD('memory.json'), CF = () => UD('chats.json'), WF = () => UD('window.json');

function writeAtomicSync(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
const enc = (v) => {
  if (!v) return v;
  try { return safeStorage.isEncryptionAvailable() ? 'enc:' + safeStorage.encryptString(v).toString('base64') : v; } catch { return v; }
};
const dec = (v) => {
  if (typeof v !== 'string' || !v.startsWith('enc:')) return v;
  try { return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64')); } catch { return ''; }
};
function load() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(SF(), 'utf8')); } catch {}
  const o = { ...DEF, ...raw };
  if (raw.uiv !== 2) { o.theme = 'sky'; o.uiv = 2; }          // ترحيل للشكل الجديد
  for (const k of SECRET) o[k] = dec(o[k]);                      // المفاتيح تُحفظ مشفّرة على الجهاز
  return o;
}
function persistSettings(s) {
  const o = { ...DEF, ...s };
  for (const k of SECRET) o[k] = enc(String(o[k] || ''));
  writeAtomicSync(SF(), JSON.stringify(o));
}

const EMPTY = () => ({ sections: [], chats: [], notes: [], tasks: [], deleted: {} });
function loadChats() {
  try {
    const d = JSON.parse(fs.readFileSync(CF(), 'utf8'));
    return Sync.fix(Sync.norm(Array.isArray(d) ? { chats: d } : d));
  } catch (e) {
    try { if (fs.existsSync(CF())) fs.copyFileSync(CF(), UD('chats.corrupt.json')); } catch {}
    return EMPTY();
  }
}
let chatsQ = Promise.resolve(), chatsState = null;
const saveChats = (c) => (chatsQ = chatsQ.then(async () => {
  const f = CF(), tmp = f + '.tmp';
  await fs.promises.writeFile(tmp, JSON.stringify(c));
  await fs.promises.rename(tmp, f);
}).catch(() => {}));
const getChats = () => chatsState || (chatsState = loadChats());
/* دمج اللي جاي (من النافذة أو الجوال) مع المحفوظ، وإشعار الباقين إذا تغيّر شي */
function mergeChats(inc, from) {
  if (!inc || typeof inc !== 'object') return getChats();
  const cur = getChats(), out = Sync.merge(cur, inc);
  if (Sync.sig(out) !== Sync.sig(cur) || Object.keys(out.deleted).length !== Object.keys(cur.deleted).length) {
    chatsState = out; saveChats(out);
    if (httpSrv) httpSrv.broadcast('chats');
    if (from === 'http' && win && !win.isDestroyed()) win.webContents.send('chats:changed');
  }
  return chatsState;
}

const memL = () => { try { return JSON.parse(fs.readFileSync(MF(), 'utf8')); } catch { return []; } };
const lines = (t) => String(t || '').split('\n').map((l) => l.trim()).filter((l) => l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; });

/* ───────────── Whisper ───────────── */
function startWhisper(S) {
  if (whisperProc || !S.whisperAuto || !S.whisperExe || !S.whisperModel) return;
  try {
    whisperProc = spawn(S.whisperExe, ['-m', S.whisperModel, '--host', '127.0.0.1', '--port', '8080', '-l', 'ar'], { cwd: path.dirname(S.whisperExe) });
    whisperProc.on('exit', () => { whisperProc = null; });
    whisperProc.on('error', () => { whisperProc = null; });
  } catch { whisperProc = null; }
}
function stopWhisper() { if (whisperProc) { try { whisperProc.kill(); } catch {} whisperProc = null; } }

/* ───────────── قراءة الأرشيف (ZIP) ───────────── */
function parseZip(buf) {
  const EOCD = 0x06054b50; let i = buf.length - 22;
  for (; i >= 0; i--) { if (buf.readUInt32LE(i) === EOCD) break; }
  if (i < 0) throw new Error('ملف ZIP غير سليم');
  const cdOffset = buf.readUInt32LE(i + 16), cdCount = buf.readUInt16LE(i + 10);
  let p = cdOffset; const entries = [];
  for (let k = 0; k < cdCount && p < buf.length - 4; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), compSize = buf.readUInt32LE(p + 20), uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42), name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compSize, uncompSize, localOffset }); p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
function readZipEntry(buf, e) {
  const lp = e.localOffset, nameLen = buf.readUInt16LE(lp + 26), extraLen = buf.readUInt16LE(lp + 28);
  const dataStart = lp + 30 + nameLen + extraLen, data = buf.subarray(dataStart, dataStart + e.compSize);
  if (e.method === 0) return data;
  if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: 400000 }); // حماية من ملفات مضغوطة خبيثة
  return null;
}
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decEnt = (t) => t.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return ''; } }
  return ENT[e.toLowerCase()] ?? m;
});
const zipGet = (buf, ents, re) => { const e = ents.find((x) => re.test(x.name)); return e ? (readZipEntry(buf, e) || Buffer.alloc(0)).toString('utf8') : ''; };
function extractDoc(ab, name) {
  const ext = (String(name).match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
  const buf = Buffer.from(ab); let out = '';
  try {
    if (ext === 'rtf') {
      out = buf.toString('latin1').replace(/\\'([0-9a-f]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\par[d]?/g, '\n').replace(/\{\\\*[^{}]*\}/g, '').replace(/\\[a-z]+-?\d* ?/gi, '').replace(/[{}]/g, '');
    } else {
      const ents = parseZip(buf);
      if (ext === 'docx') {
        out = decEnt(zipGet(buf, ents, /^word\/document\.xml$/).replace(/<\/w:p>/g, '\n').replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<[^>]+>/g, ''));
      } else if (ext === 'pptx') {
        const sl = ents.filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x.name)).sort((a, b) => parseInt(a.name.match(/(\d+)\.xml/)[1]) - parseInt(b.name.match(/(\d+)\.xml/)[1]));
        out = sl.map((e, i) => `--- شريحة ${i + 1} ---\n` + decEnt((readZipEntry(buf, e) || Buffer.alloc(0)).toString('utf8').replace(/<\/a:p>/g, '\n').replace(/<[^>]+>/g, ''))).join('\n');
      } else if (ext === 'xlsx') {
        const ss = [...zipGet(buf, ents, /^xl\/sharedStrings\.xml$/).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decEnt(m[1].replace(/<[^>]+>/g, '')));
        const sheets = ents.filter((x) => /^xl\/worksheets\/sheet\d+\.xml$/.test(x.name)); let rows = 0;
        for (const [i, e] of sheets.entries()) {
          out += `--- ورقة ${i + 1} ---\n`;
          for (const r of (readZipEntry(buf, e) || Buffer.alloc(0)).toString('utf8').matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
            const cells = [...r[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((c) => {
              const body = c[2] || '', t = /t="(\w+)"/.exec(c[1]); const v = /<v>([\s\S]*?)<\/v>/.exec(body);
              if (t && t[1] === 's' && v) return ss[+v[1]] ?? '';
              if (t && t[1] === 'inlineStr') return decEnt(body.replace(/<[^>]+>/g, ''));
              return v ? decEnt(v[1]) : '';
            });
            out += cells.join('\t') + '\n'; if (++rows > 3000) break;
          }
        }
      } else if (['odt', 'ods', 'odp'].includes(ext)) {
        out = decEnt(zipGet(buf, ents, /^content\.xml$/).replace(/<\/text:p>|<\/text:h>|<\/table:table-row>/g, '\n').replace(/<\/table:table-cell>/g, '\t').replace(/<[^>]+>/g, ''));
      } else if (ext === 'epub') {
        out = ents.filter((x) => /\.(x?html?)$/i.test(x.name)).slice(0, 60).map((e) => decEnt((readZipEntry(buf, e) || Buffer.alloc(0)).toString('utf8').replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<\/(p|div|h\d|li)>/g, '\n').replace(/<[^>]+>/g, ''))).join('\n');
      } else return { error: 'صيغة ما أعرف أقرأها: ' + ext };
    }
    out = out.replace(/\n{3,}/g, '\n\n').trim();
    if (!out) return { error: 'ما لقيت نص داخل الملف.' };
    return { text: out.slice(0, 80000) };
  } catch (e) { return { error: 'ما قدرت أقرأ الملف: ' + e.message }; }
}
function readArchive(ab, kind) {
  if (kind !== 'zip') return { error: 'صيغة RAR ما أقدر أفكها مباشرة. فكّه بـ WinRAR أو 7-Zip وأرسل لي الملفات اللي بداخله، أو حوّله إلى ZIP.' };
  try {
    const buf = Buffer.from(ab), entries = parseZip(buf).filter((e) => !e.name.endsWith('/'));
    const TEXT = /\.(txt|md|json|js|ts|py|html|css|c|cpp|cs|java|go|rs|php|sql|xml|yml|yaml|log|ini|bat|sh|csv)$/i;
    let out = `قائمة ملفات الأرشيف (${entries.length}):\n` + entries.slice(0, 300).map((e) => e.name).join('\n') + '\n';
    let used = 0;
    for (const e of entries) {
      if (used > 150000) break;
      if (!TEXT.test(e.name) || e.uncompSize > 150000) continue;
      try { const d = readZipEntry(buf, e); if (!d) continue; const t = d.toString('utf8'); out += `\n--- ${e.name} ---\n${t.slice(0, 20000)}\n`; used += t.length; } catch {}
    }
    return { text: out };
  } catch (e) { return { error: 'ما قدرت أفك الأرشيف: ' + e.message }; }
}

/* ───────────── أدوات الذكاء ───────────── */
function launch(S, name) {
  const n = String(name || '').trim().toLowerCase();
  const all = lines(S.apps);
  const hit = all.find(([k]) => k.toLowerCase() === n) || all.find(([k]) => k.toLowerCase().includes(n));
  if (!n || !hit) return `ما لقيت تطبيق اسمه "${name}" في قائمة التطبيقات المسموحة.`;
  if (S.confirmApps) {
    const r = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['شغّل', 'إلغاء'], defaultId: 0, cancelId: 1, title: 'مساعدي', message: `تشغيل «${hit[0]}»؟` });
    if (r !== 0) return 'المستخدم رفض تشغيل التطبيق.';
  }
  try { spawn(`"${hit[1]}"`, [], { detached: true, stdio: 'ignore', shell: true }).unref(); return `شغّلت ${hit[0]}.`; }
  catch (e) { return `فشل تشغيل ${hit[0]}: ${e.message}`; }
}
function runMode(S, name) {
  const hit = lines(S.modes).find(([k]) => k.toLowerCase().includes(String(name || '').trim().toLowerCase()));
  if (!hit) return `ما لقيت مود اسمه "${name}".`;
  return hit[1].split(',').map((a) => launch(S, a)).join(' ');
}
function calc(expr) {
  try { return Calc.format(Calc.evaluate(expr)); } catch (e) { return 'ما قدرت أحسبها: ' + e.message; }
}
function runTool(S, u) {
  const i = u.input || {};
  if (u.name === 'launch_app') return launch(S, i.name);
  if (u.name === 'run_mode') return runMode(S, i.name);
  if (u.name === 'calculate') return calc(i.expression);
  if (u.name === 'remember') { const m = memL(); m.push(String(i.text || '')); writeAtomicSync(MF(), JSON.stringify(m.slice(-60))); return 'حفظت.'; }
  if (u.name === 'open_url') { if (!/^https?:\/\//i.test(i.url || '')) return 'رابط غير صالح'; shell.openExternal(i.url); return 'فتحت الرابط.'; }
  if (u.name === 'set_timer') {
    const ms = Math.min(Math.max(+i.minutes || 1, 0.1), 600) * 60000, lb = i.label || 'انتهى المؤقت';
    setTimeout(() => { try { new Notification({ title: 'مساعدي', body: lb }).show(); } catch {} win && !win.isDestroyed() && win.webContents.send('timer', lb); }, ms);
    return `ضبطت مؤقت ${i.minutes} دقيقة.`;
  }
  return 'أداة غير معروفة';
}
const TOOLS = [
  { name: 'remember', description: 'يحفظ معلومة تخص المستخدم لاستخدامها لاحقاً', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'open_url', description: 'يفتح رابط في المتصفح', input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'set_timer', description: 'يضبط مؤقت وينبه المستخدم', input_schema: { type: 'object', properties: { minutes: { type: 'number' }, label: { type: 'string' } }, required: ['minutes'] } },
  { name: 'launch_app', description: 'يشغل تطبيق من قائمة التطبيقات اللي حددها المستخدم', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'run_mode', description: 'يشغل مود (مجموعة تطبيقات) حدده المستخدم مثل مود اللعب', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'calculate', description: 'حاسبة دقيقة لتعبير رياضي (+ - * / ^ % وأقواس ودوال sqrt, abs, round, sin, cos, ln, log)', input_schema: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] } }
];
function system(S, extra) {
  const st = S.style === 'najdi' ? 'تكلم باللهجة النجدية السعودية بشكل طبيعي وودّي.' : 'تكلم بالعربية الفصحى المبسطة.';
  const apps = lines(S.apps).map((a) => a[0]).join('، ') || 'ما فيه';
  const modes = lines(S.modes).map((a) => a[0]).join('، ') || 'ما فيه';
  return `أنت مساعد شخصي يومي ومبرمج وحاسبة. ${st} اختصر وكن عملي. التطبيقات المسموحة: ${apps}. المودات: ${modes}. استخدم الأدوات لتشغيل التطبيقات والحساب، ولا تشغّل شي خارج القائمة. إذا ذكر المستخدم معلومة تخصه تستحق الحفظ استخدم remember. معلومات محفوظة: ${memL().join(' | ') || 'ما فيه'}${extra ? ' تعليمات هذا القسم: ' + extra : ''}`;
}

/* ───────────── اتصال بمزوّدي الذكاء ───────────── */
const E = (m) => new Error(m);
async function post(url, headers, body, ctl, netMsg) {
  let r;
  try {
    r = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
      signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(120000)])
    });
  } catch (e) {
    if (ctl.signal.aborted) throw E('ABORT');
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw E('انتهت مهلة الاتصال، جرّب مرة ثانية.');
    throw E(netMsg || 'ما قدرت أتصل بالخادم. تأكد من الإنترنت.');
  }
  try { return await r.json(); } catch { throw E('رد غير مفهوم من الخادم (HTTP ' + r.status + ').'); }
}

async function anth(c, messages) {
  const { S } = c;
  if (!S.key) throw E('حط مفتاح Claude في الإعدادات أول.');
  const msgs = [...messages];
  for (let i = 0; i < 6; i++) {
    const d = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': S.key, 'anthropic-version': '2023-06-01' },
      { model: S.model, max_tokens: 4096, system: system(S, c.ex), tools: TOOLS, messages: msgs }, c.ctl);
    if (d.error) throw E(d.error.message || 'خطأ من Claude');
    const uses = (d.content || []).filter((b) => b.type === 'tool_use');
    if (!uses.length) return (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    msgs.push({ role: 'assistant', content: d.content });
    msgs.push({ role: 'user', content: uses.map((u) => ({ type: 'tool_result', tool_use_id: u.id, content: String(runTool(S, u)) })) });
  }
  throw E('تعبت أحاول، جرب مرة ثانية.');
}
const oaTools = () => TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
const toOA = (ms) => ms.map((m) => {
  if (typeof m.content === 'string') return m;
  const parts = [];
  for (const b of m.content) {
    if (b.type === 'text') parts.push({ type: 'text', text: b.text });
    else if (b.type === 'image') parts.push({ type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
    else parts.push({ type: 'text', text: '[ملف PDF مرفق، وهذا المزوّد ما يقرأ PDF مباشرة]' });
  }
  return { role: m.role, content: parts };
});
async function oa(c, messages, url, key, model) {
  if (!key) throw E('حط المفتاح في الإعدادات أول.');
  let useTools = true;
  const msgs = [{ role: 'system', content: system(c.S, c.ex) }, ...toOA(messages)];
  for (let i = 0; i < 6; i++) {
    const d = await post(url, { Authorization: 'Bearer ' + key }, { model, messages: msgs, ...(useTools ? { tools: oaTools() } : {}) }, c.ctl);
    if (d.error && useTools && i === 0) { useTools = false; continue; }
    if (d.error) throw E(d.error.message || JSON.stringify(d.error));
    const g = d.choices && d.choices[0] && d.choices[0].message;
    if (!g) throw E('رد فاضي من الخدمة.');
    if (!g.tool_calls || !g.tool_calls.length) return g.content || '';
    msgs.push(g);
    for (const tc of g.tool_calls) {
      let inp = {}; try { inp = JSON.parse(tc.function.arguments); } catch {}
      msgs.push({ role: 'tool', tool_call_id: tc.id, content: String(runTool(c.S, { name: tc.function.name, input: inp })) });
    }
  }
  throw E('تعبت أحاول، جرب مرة ثانية.');
}
const FREE = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions'
};
const grok = (c, m) => oa(c, m, 'https://api.x.ai/v1/chat/completions', c.S.grokKey, c.S.grokModel);
const free = (c, m) => oa(c, m, FREE[c.S.freePreset] || FREE.gemini, c.S.freeKey, c.S.freeModel);
async function ollama(c, messages) {
  const S = c.S;
  const d = await post('http://localhost:11434/api/chat', {},
    { model: S.ollamaModel, messages: [{ role: 'system', content: system(S, c.ex) }, ...messages.map((m) => typeof m.content === 'string' ? m : ({ role: m.role, content: m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') || '(انظر الصور)', images: m.content.filter((b) => b.type === 'image').map((b) => b.source.data) }))], stream: false, think: !!S.ollamaThink, keep_alive: '30m' },
    c.ctl, 'ما قدرت أوصل لـ Ollama. تأكد إنه شغال.');
  if (d.error) throw E(typeof d.error === 'string' ? d.error : 'خطأ من Ollama');
  return (d.message && d.message.content) || '';
}
/* يرتّب السياق: يشيل أي رسائل زائدة، ويتأكد إن أول رسالة من المستخدم (Claude يرفض غير كذا) */
function cleanContent(c) {
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b && ((b.type === 'text' && typeof b.text === 'string' && b.text.trim()) ||
    ((b.type === 'image' || b.type === 'document') && b.source && b.source.type === 'base64' && typeof b.source.data === 'string' && typeof b.source.media_type === 'string'))).slice(0, 24);
}
function clean(ms, n) {
  const a = (ms || []).slice(-n)
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: cleanContent(m.content) }))
    .filter((m) => (typeof m.content === 'string' ? m.content.trim() : m.content.length));
  while (a.length && a[0].role !== 'user') a.shift();
  return a;
}
async function titleGen(S, text) {
  const prompt = `لخّص موضوع هذا الكلام بعنوان قصير جداً (٢ إلى ٤ كلمات)، بدون علامات تنصيص ولا نقطة في الآخر، وبالعربي فقط:\n"${String(text).slice(0, 500)}"`;
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
  try {
    let out = null;
    if (S.provider === 'ollama') {
      const d = await post('http://localhost:11434/api/chat', {}, { model: S.ollamaModel, messages: [{ role: 'user', content: prompt }], stream: false, think: false }, ctl);
      out = d.message && d.message.content;
    } else if (S.provider === 'anthropic') {
      if (!S.key) return null;
      const d = await post('https://api.anthropic.com/v1/messages', { 'x-api-key': S.key, 'anthropic-version': '2023-06-01' },
        { model: S.model, max_tokens: 30, messages: [{ role: 'user', content: prompt }] }, ctl);
      out = d.content && d.content[0] && d.content[0].text;
    } else {
      const g = S.provider === 'grok';
      const url = g ? 'https://api.x.ai/v1/chat/completions' : (FREE[S.freePreset] || FREE.gemini);
      const key = g ? S.grokKey : S.freeKey, model = g ? S.grokModel : S.freeModel;
      if (!key) return null;
      const d = await post(url, { Authorization: 'Bearer ' + key }, { model, messages: [{ role: 'user', content: prompt }], max_tokens: 30 }, ctl);
      out = d.choices && d.choices[0] && d.choices[0].message.content;
    }
    return out ? out.trim().replace(/^["«“]|["»”.]$/g, '') : null;
  } catch { return null; } finally { clearTimeout(t); }
}

/* ───────────── عمليات مشتركة بين النافذة والجوال ───────────── */
async function doChat(p, id, ext) {
  const S = load(), n = Math.max(4, parseInt(S.maxHistory, 10) || 24);
  const messages = clean(p && p.messages, n);
  if (!messages.length) return { error: 'ما فيه رسالة أرسلها.' };
  const ctl = ext || new AbortController(), key = id || 'main';
  chatCtls.get(key) && chatCtls.get(key).abort();
  chatCtls.set(key, ctl);
  const c = { S, ctl, ex: String((p && p.extra) || '').slice(0, 1000) };
  try {
    const text = S.provider === 'ollama' ? await ollama(c, messages)
      : S.provider === 'grok' ? await grok(c, messages)
      : S.provider === 'free' ? await free(c, messages)
      : await anth(c, messages);
    return { text };
  } catch (e) {
    if (e.message === 'ABORT') return { aborted: true };
    return { error: e.message || 'صار خطأ غير متوقع.' };
  } finally { if (chatCtls.get(key) === ctl) chatCtls.delete(key); }
}
const cancelChat = (id) => { const c = chatCtls.get(id || 'main'); if (c) c.abort(); };

async function doTts(text) {
  const S = load();
  try {
    if (S.engine === 'eleven') {
      const id = S.voice === 'male' ? S.elVoiceM : S.elVoiceF;
      const x = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(id)}`, {
        method: 'POST', headers: { 'xi-api-key': S.elKey, 'content-type': 'application/json' },
        body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }), signal: AbortSignal.timeout(60000)
      });
      if (!x.ok) return { error: 'ElevenLabs رجّع خطأ ' + x.status + '، راجع المفتاح والـ Voice ID.' };
      return { audio: Buffer.from(await x.arrayBuffer()), mime: 'audio/mpeg' };
    }
    if (S.engine === 'openai') {
      if (!S.openaiKey) return { error: 'حط مفتاح OpenAI في إعدادات الصوت.' };
      const speech = (body) => fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST', headers: { Authorization: 'Bearer ' + S.openaiKey, 'content-type': 'application/json' },
        body: JSON.stringify({ voice: S.voice === 'male' ? 'onyx' : 'nova', input: text, response_format: 'mp3', ...body }), signal: AbortSignal.timeout(60000)
      });
      // الموديل الأحدث يقبل تعليمات للأسلوب واللهجة؛ وإذا حسابك ما يدعمه نرجع للقديم
      let x = await speech({ model: 'gpt-4o-mini-tts', instructions: 'تكلم بالعربية بلهجة سعودية بيضاء طبيعية، بنبرة ودودة وواضحة وسرعة معتدلة، وانطق الكلمات بدقة.' });
      if (!x.ok) x = await speech({ model: 'tts-1' });
      if (!x.ok) return { error: 'OpenAI رجّع خطأ ' + x.status + '، راجع المفتاح.' };
      return { audio: Buffer.from(await x.arrayBuffer()), mime: 'audio/mpeg' };
    }
    if (S.engine === 'piper') {
      const out = path.join(app.getPath('temp'), 'tts.wav');
      await new Promise((ok, no) => {
        const p = spawn(S.piperExe, ['-m', S.piperModel, '-f', out]);
        p.on('error', no); p.on('close', ok); p.stdin.end(text);
      });
      return { audio: fs.readFileSync(out), mime: 'audio/wav' };
    }
  } catch (e) { return { error: 'فشل الصوت: ' + e.message }; }
  return { error: 'محرك غير معروف' };
}

const STT_HINT = 'مرحباً، هذا حديث باللغة العربية بلهجة سعودية.';
async function doStt(ab, opts) {
  const S = load(), lang = (opts && opts.lang) || 'ar', eng = S.sttEngine || 'local';
  try {
    const f = new FormData();
    f.append('file', new Blob([ab], { type: 'audio/wav' }), 'a.wav');
    f.append('response_format', 'json'); f.append('temperature', '0');
    if (lang !== 'auto') f.append('language', lang);
    if (lang === 'ar') f.append('prompt', STT_HINT);
    let url = S.whisperUrl, headers = {};
    if (eng === 'groq' || eng === 'openai') {
      const key = S.sttKey || (eng === 'groq' && S.freePreset === 'groq' ? S.freeKey : '') || (eng === 'openai' ? S.openaiKey : '');
      if (!key) return { error: 'حط مفتاح التعرف على الكلام في الإعدادات (' + (eng === 'groq' ? 'Groq' : 'OpenAI') + ').' };
      url = eng === 'groq' ? 'https://api.groq.com/openai/v1/audio/transcriptions' : 'https://api.openai.com/v1/audio/transcriptions';
      f.append('model', eng === 'groq' ? 'whisper-large-v3' : 'whisper-1'); headers = { Authorization: 'Bearer ' + key };
    } else { f.append('model', 'whisper-1'); f.append('temperature_inc', '0.2'); }
    const r = await fetch(url, { method: 'POST', body: f, headers, signal: AbortSignal.timeout(120000) });
    let d = null; try { d = await r.json(); } catch {}
    if (!r.ok) return { error: 'خدمة التعرف رجّعت خطأ ' + r.status + (d && d.error ? ': ' + (d.error.message || d.error) : '') };
    return { text: String((d && d.text) || '').replace(/\[[A-Z_ ]+\]/g, '').trim() };
  } catch { return { error: eng === 'local' ? 'ما وصلت لخادم Whisper. شغّله أول أو راجع الرابط في الإعدادات.' : 'ما قدرت أتصل بخدمة التعرف على الكلام. تأكد من الإنترنت.' }; }
}

/* ───────────── خادم الجوال ───────────── */
/* الجوال يقدر يغيّر هذي فقط؛ المفاتيح والمسارات تبقى على البيسي */
const REMOTE_OK = ['provider', 'model', 'ollamaModel', 'ollamaThink', 'autoTitle', 'maxHistory', 'style', 'freePreset', 'freeModel', 'grokModel',
  'theme', 'fsize', 'sounds', 'voice', 'speak', 'rate', 'sttAuto', 'timestamps', 'engine', 'sttEngine', 'bg', 'glow'];
const maskedSettings = () => {
  const S = load(), o = { ...S };
  for (const k of SECRET) o[k] = S[k] ? '••••••' : '';
  delete o.syncToken;
  for (const k of ['whisperExe', 'whisperModel', 'piperExe', 'piperModel']) delete o[k];
  return o;
};
const remoteApi = {
  getSettings: maskedSettings,
  saveSettings(s) {
    if (!s || typeof s !== 'object') return false;
    const cur = load(); for (const k of REMOTE_OK) if (k in s && typeof s[k] === typeof DEF[k]) cur[k] = s[k];
    persistSettings(cur); return true;
  },
  getChats, mergeChats: (c) => mergeChats(c, 'http'),
  chat: (b, id, ac) => doChat(b, 'r' + id, ac), cancel: (id) => cancelChat('r' + id),
  tts: doTts, stt: doStt, title: (t) => titleGen(load(), t),
  extract: (buf, name) => extractDoc(buf, name), archive: (buf, kind) => readArchive(buf, kind)
};
function tokenOf() {
  const S = load();
  if (S.syncToken) return S.syncToken;
  S.syncToken = crypto.randomBytes(18).toString('base64url'); persistSettings(S); return S.syncToken;
}
async function applyServer(S) {
  if (!httpSrv) httpSrv = Srv.create({ dir: __dirname, getToken: () => load().syncToken, api: remoteApi });
  if (!S.syncOn) { httpSrv.stop(); return { ok: true }; }
  tokenOf();
  const port = Math.min(65535, Math.max(1024, parseInt(S.syncPort, 10) || 8765));
  if (httpSrv.running && httpSrv.port === port) return { ok: true };
  httpSrv.stop();
  try { await httpSrv.start(port); return { ok: true }; }
  catch (e) { return { error: e.code === 'EADDRINUSE' ? 'المنفذ ' + port + ' مستخدم، غيّره من الإعدادات.' : e.message }; }
}
function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) {
    if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  }
  return out;
}
function tailscaleName() {
  return new Promise((ok) => {
    try {
      const p = spawn('tailscale', ['status', '--json'], { windowsHide: true }); let b = '';
      const t = setTimeout(() => { try { p.kill(); } catch {} ok(null); }, 4000);
      p.stdout.on('data', (d) => { b += d; }); p.on('error', () => { clearTimeout(t); ok(null); });
      p.on('close', () => { clearTimeout(t); try { const j = JSON.parse(b); ok({ dns: String((j.Self && j.Self.DNSName) || '').replace(/\.$/, ''), ips: (j.Self && j.Self.TailscaleIPs) || [] }); } catch { ok(null); } });
    } catch { ok(null); }
  });
}

/* ───────────── IPC ───────────── */
ipcMain.handle('get', () => load());
ipcMain.handle('save', async (_, s) => {
  if (!s || typeof s !== 'object') return false;
  const old = load();
  persistSettings({ ...s, syncToken: old.syncToken });
  if (win && !win.isDestroyed()) win.setAlwaysOnTop(!!s.alwaysOnTop);
  try { app.setLoginItemSettings({ openAtLogin: !!s.startup }); } catch {}
  if (s.whisperAuto) startWhisper(s); else stopWhisper();
  if (!!s.syncOn !== !!old.syncOn || String(s.syncPort) !== String(old.syncPort)) { const r = await applyServer(load()); if (r.error) return { error: r.error }; }
  return true;
});
ipcMain.handle('sync:info', async () => {
  const S = load(), ts = await tailscaleName();
  return { on: !!S.syncOn, running: !!(httpSrv && httpSrv.running), port: parseInt(S.syncPort, 10) || 8765, token: S.syncOn ? tokenOf() : '', ips: lanIps(), ts };
});
ipcMain.handle('sync:regen', () => { const S = load(); S.syncToken = crypto.randomBytes(18).toString('base64url'); persistSettings(S); if (httpSrv) httpSrv.broadcast('revoked'); return S.syncToken; });
ipcMain.handle('title', (_, t) => titleGen(load(), t));
ipcMain.handle('archive', (_, ab, kind) => readArchive(ab, kind));
ipcMain.handle('extract', (_, ab, name) => extractDoc(ab, name));
ipcMain.handle('chat', (_, p) => doChat(p, 'main'));
ipcMain.on('chat:cancel', () => cancelChat('main'));
ipcMain.handle('tts', (_, text) => doTts(text));
ipcMain.handle('chats:get', () => getChats());
ipcMain.handle('chats:set', (_, c) => mergeChats(c, 'ipc'));
ipcMain.handle('stt', (_, ab, opts) => doStt(ab, opts));

/* ───────────── النافذة ───────────── */
function boundsOnScreen(b) {
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return false;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y < a.y + a.height - 40 && b.y + 80 > a.y;
  });
}
function createWindow(S) {
  custom = S.wavyFrame !== false;
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(WF(), 'utf8')); } catch {}
  const base = custom
    ? { width: 1180, height: 780, minWidth: MIN_W, minHeight: MIN_H, frame: false, transparent: true, hasShadow: false, maximizable: false, backgroundColor: '#00000000' }
    : { width: 1100, height: 720, minWidth: 820, minHeight: 560, backgroundColor: '#0b1220' };
  if (saved && boundsOnScreen(saved)) Object.assign(base, { x: saved.x, y: saved.y, width: Math.max(saved.width, base.minWidth), height: Math.max(saved.height, base.minHeight) });

  win = new BrowserWindow({
    ...base, show: false, autoHideMenuBar: true, title: 'مساعدي', icon: path.join(__dirname, 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false }
  });
  win.loadFile('index.html');
  win.once('ready-to-show', () => win.show());
  win.setAlwaysOnTop(!!S.alwaysOnTop);

  // الروابط تنفتح في المتصفح، والنافذة ما تتنقل لأي صفحة ثانية
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { e.preventDefault(); if (/^https?:\/\//i.test(url)) shell.openExternal(url); });

  let t = null;
  const saveB = () => { clearTimeout(t); t = setTimeout(() => { if (!win || win.isDestroyed() || maxed || win.isMinimized()) return; try { fs.writeFileSync(WF(), JSON.stringify(win.getBounds())); } catch {} }, 600); };
  win.on('resize', saveB); win.on('move', saveB);
  win.on('closed', () => { win = null; });
}
function toggleMax() {
  if (!win || !custom) return;
  if (maxed) { if (prevBounds) win.setBounds(prevBounds); maxed = false; }
  else { prevBounds = win.getBounds(); win.setBounds(screen.getDisplayMatching(prevBounds).workArea); maxed = true; }
  win.webContents.send('win:state', { max: maxed });
}
ipcMain.handle('win:mode', () => ({ custom, max: maxed, minW: MIN_W, minH: MIN_H, platform: process.platform }));
ipcMain.on('win:min', () => win && win.minimize());
ipcMain.on('win:max', toggleMax);
ipcMain.on('win:close', () => win && win.close());
ipcMain.handle('win:bounds', () => (win ? win.getBounds() : null));
ipcMain.on('win:setBounds', (_, b) => {
  if (!win || maxed || !b || ![b.x, b.y, b.width, b.height].every(Number.isFinite)) return;
  win.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: Math.max(MIN_W, Math.round(b.width)), height: Math.max(MIN_H, Math.round(b.height)) });
});
ipcMain.on('app:relaunch', () => { app.relaunch(); app.exit(0); });

/* ───────────── تشغيل التطبيق ───────────── */
try { if (process.platform === 'win32') app.setAppUserModelId('local.murattib.assistant'); } catch {}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
  app.whenReady().then(() => {
    const S0 = load();
    createWindow(S0);
    try { app.setLoginItemSettings({ openAtLogin: !!S0.startup }); } catch {}
    startWhisper(S0);
    if (S0.syncOn) applyServer(S0);
    try {
      globalShortcut.register('Alt+Space', () => {
        if (!win) return;
        if (win.isVisible() && win.isFocused()) win.minimize(); else { win.show(); win.restore(); win.focus(); }
      });
    } catch {}
  });
  app.on('window-all-closed', () => { stopWhisper(); if (httpSrv) httpSrv.stop(); chatsQ.finally(() => app.quit()); });
  app.on('before-quit', stopWhisper);
  app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch {} });
}
