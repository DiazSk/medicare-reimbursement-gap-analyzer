/* Pure formatting and colour helpers. No DOM, no globals beyond window.MD.
   Classic script on purpose: ES modules are CORS-blocked over file://, and
   docs/index.html must keep opening straight from disk. */
(function (root) {
  "use strict";

  function money(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) return "—";
    const a = Math.abs(v), s = v < 0 ? "-$" : "$";
    if (a >= 1e9) return s + (a / 1e9).toFixed(digits ?? 2) + "B";
    if (a >= 1e6) return s + (a / 1e6).toFixed(digits ?? 1) + "M";
    if (a >= 1e3) return s + (a / 1e3).toFixed(digits ?? 1) + "K";
    return s + a.toFixed(digits ?? 2);
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
