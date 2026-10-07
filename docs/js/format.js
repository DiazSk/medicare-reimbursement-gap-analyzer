/* Pure formatting and colour helpers. No DOM, no globals beyond window.MD.
   Classic script on purpose: ES modules are CORS-blocked over file://, and
   docs/index.html must keep opening straight from disk. */
(function (root) {
  "use strict";

  function money(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    const a = Math.abs(v), s = v < 0 ? "-$" : "$";
    /* An explicit `digits` means the caller is an axis, which wants the shortest
       TRUTHFUL label -- so trailing zeros come off. money(1.5e9, 0) used to render
       "$2B": distinct from its neighbours, so the collision fallback below never
       fired, and wrong by half a billion. One decimal plus trimming gives "$1.5B"
       for that tick and still "$1B" and "$500M" for the round ones. The no-digits
       default path is untouched, so money(12.5) stays "$12.50". */
    const fix = (x, d) => {
      const out = x.toFixed(d);
      return digits === undefined ? out : out.replace(/\.0+$/, "");
    };
    if (a >= 1e9) return s + fix(a / 1e9, digits ?? 2) + "B";
    if (a >= 1e6) return s + fix(a / 1e6, digits ?? 1) + "M";
    if (a >= 1e3) return s + fix(a / 1e3, digits ?? 1) + "K";
    return s + fix(a, digits ?? 2);
  }

  function count(v) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  function pct(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    return (v * 100).toFixed(d ?? 1) + "%";
  }

  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    return sorted[Math.min(sorted.length - 1, Math.round(q * (sorted.length - 1)))];
  }

  root.MD = root.MD || {};
  root.MD.format = { money, count, pct, quantile };
})(typeof window !== "undefined" ? window : globalThis);
