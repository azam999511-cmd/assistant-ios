/* حاسبة آمنة بدون eval — تُستخدم في الواجهة وفي أداة calculate حقت الذكاء */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const FN = {
    sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil,
    sin: Math.sin, cos: Math.cos, tan: Math.tan, ln: Math.log, log: Math.log10, exp: Math.exp
  };
  const CONST = { pi: Math.PI, e: Math.E };
  const AR = '٠١٢٣٤٥٦٧٨٩';

  function tokenize(src) {
    const s = String(src)
      .replace(/[٠-٩]/g, (c) => AR.indexOf(c))
      .replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/٫/g, '.')
      .toLowerCase();
    if (s.length > 500) throw new Error('التعبير طويل');
    const out = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        const m = /^(?:\d+\.?\d*|\.\d+)/.exec(s.slice(i));
        if (!m) throw new Error('رقم غير صحيح');
        out.push({ k: 'n', v: parseFloat(m[0]) }); i += m[0].length; continue;
      }
      if (/[a-z]/.test(c)) {
        const m = /^[a-z]+/.exec(s.slice(i));
        out.push({ k: 'id', v: m[0] }); i += m[0].length; continue;
      }
      if ('+-*/^%()'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
      throw new Error('رمز غير مسموح: ' + c);
    }
    return out;
  }

  function evaluate(src) {
    const t = tokenize(src); let i = 0;
    const peek = () => t[i], next = () => t[i++];
    const isOp = (v) => peek() && peek().k === 'op' && peek().v === v;
    const expect = (v) => { if (!isOp(v)) throw new Error('تعبير ناقص'); i++; };

    function expr(d) {
      let l = term(d);
      while (isOp('+') || isOp('-')) {
        const op = next().v, r = term(d);
        const rv = r.pct ? l.v * r.v : r.v; // 200+10% = 220
        l = { v: op === '+' ? l.v + rv : l.v - rv, pct: false };
      }
      return l;
    }
    function term(d) {
      let l = unary(d);
      while (isOp('*') || isOp('/')) {
        const op = next().v, r = unary(d);
        if (op === '/' && r.v === 0) throw new Error('القسمة على صفر');
        l = { v: op === '*' ? l.v * r.v : l.v / r.v, pct: false };
      }
      return l;
    }
    function unary(d) {
      if (isOp('-')) { next(); const x = unary(d); return { v: -x.v, pct: x.pct }; }
      if (isOp('+')) { next(); return unary(d); }
      return power(d);
    }
    function power(d) {
      const b = postfix(d);
      if (isOp('^')) { next(); const e = unary(d); return { v: Math.pow(b.v, e.v), pct: false }; }
      return b;
    }
    function postfix(d) {
      let x = primary(d);
      while (isOp('%')) { next(); x = { v: x.v / 100, pct: true }; }
      return x;
    }
    function primary(d) {
      if (d > 60) throw new Error('تعبير معقد');
      const k = next();
      if (!k) throw new Error('تعبير ناقص');
      if (k.k === 'n') return { v: k.v, pct: false };
      if (k.k === 'id') {
        if (Object.prototype.hasOwnProperty.call(CONST, k.v)) return { v: CONST[k.v], pct: false };
        if (Object.prototype.hasOwnProperty.call(FN, k.v)) {
          expect('('); const a = expr(d + 1); expect(')');
          return { v: FN[k.v](a.v), pct: false };
        }
        throw new Error('دالة غير معروفة: ' + k.v);
      }
      if (k.v === '(') { const x = expr(d + 1); expect(')'); return { v: x.v, pct: false }; }
      throw new Error('تعبير غير صحيح');
    }

    const r = expr(0);
    if (i < t.length) throw new Error('تعبير غير صحيح');
    if (!Number.isFinite(r.v)) throw new Error('نتيجة غير صالحة');
    return r.v;
  }

  const format = (n) => String(+Number(n).toPrecision(12));
  return { evaluate, format };
});
