/* دمج المحادثات بين البيسي والجوال بدون ما يضيع شي:
   كل عنصر (محادثة/ملاحظة/مهمة/قسم) له id و upd (آخر تعديل)، والأحدث يفوز.
   الحذف يتسجل كـ tombstone عشان ما يرجع العنصر من الجهاز الثاني. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Sync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const KEYS = ['chats', 'notes', 'tasks', 'sections'];
  const TTL = 60 * 86400e3;
  let seq = 0;

  function norm(d) {
    const o = d && typeof d === 'object' && !Array.isArray(d) ? { ...d } : { chats: Array.isArray(d) ? d : [] };
    KEYS.forEach((k) => { if (!Array.isArray(o[k])) o[k] = []; });
    if (!o.deleted || typeof o.deleted !== 'object') o.deleted = {};
    return o;
  }
  /* يعطي id/ts لأي ملاحظة أو مهمة قديمة ما عندها */
  function fix(d) {
    d.notes = d.notes.map((x) => (typeof x === 'string' ? { t: x } : x)).filter(Boolean);
    for (const k of ['notes', 'tasks']) {
      d[k].forEach((x) => {
        if (x.id == null) x.id = 'i' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);
        if (!x.ts) x.ts = x.upd || Date.now();
      });
    }
    return d;
  }
  const hash = (it) => JSON.stringify(it, (k, v) => (k === 'upd' || k === 'imgs' || k === 'pdfs' ? undefined : v));

  /* يعلّم اللي تغيّر محلياً بوقت التعديل، واللي انحذف بـ tombstone */
  function stamp(d, snap) {
    fix(d);
    const now = Date.now();
    for (const k of KEYS) {
      const seen = new Set();
      d[k].forEach((it) => {
        if (it.id == null) return;
        const key = k + ':' + it.id; seen.add(key);
        const h = hash(it);
        if (snap.get(key) !== h) { it.upd = now; snap.set(key, hash(it)); }
      });
      for (const key of [...snap.keys()]) {
        if (key.startsWith(k + ':') && !seen.has(key)) { d.deleted[key.slice(k.length + 1)] = now; snap.delete(key); }
      }
    }
    return d;
  }
  /* يسجّل الوضع الحالي كأنه "متزامن" بدون ما يغيّر upd */
  function resnap(d, snap) {
    snap.clear();
    for (const k of KEYS) d[k].forEach((it) => { if (it.id != null) snap.set(k + ':' + it.id, hash(it)); });
  }

  function merge(a, b) {
    a = fix(norm(a)); b = fix(norm(b));
    const out = norm({}), now = Date.now();
    for (const src of [a.deleted, b.deleted]) {
      for (const [id, t] of Object.entries(src)) if (now - t < TTL) out.deleted[id] = Math.max(out.deleted[id] || 0, t);
    }
    for (const k of KEYS) {
      const m = new Map();
      for (const it of [...a[k], ...b[k]]) {
        if (!it || it.id == null) continue;
        const p = m.get(it.id);
        if (!p || (it.upd || 0) > (p.upd || 0)) m.set(it.id, it);
      }
      out[k] = [...m.values()].filter((it) => !(out.deleted[String(it.id)] >= (it.upd || 0) && out.deleted[String(it.id)] > 0));
      if (k === 'sections') out[k].sort((x, y) => (+x.id || 0) - (+y.id || 0));
      else out[k].sort((x, y) => (y.ts || 0) - (x.ts || 0));
    }
    return out;
  }
  const sig = (d) => KEYS.map((k) => d[k].map((it) => it.id + ':' + (it.upd || 0)).join(',')).join('|');
  return { KEYS, norm, fix, stamp, resnap, merge, sig };
});
