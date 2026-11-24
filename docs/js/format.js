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

  /* Axis ticks want the shortest TRUTHFUL label. money(v, 0) rendered 1.5e9 as "$2B":
     wrong by half a billion, and distinct from "$1B", so axisBottom's duplicate-label
     fallback never fired on it. One decimal fixes the truth; trimming a trailing ".0"
     keeps the round ticks short. Separate from money() because the trim belongs to the
     caller's intent -- money(12, 2) is currency and must keep its cents. */
  const moneyTick = (v) => money(v, 1).replace(/\.0+(?=[BMK]?$)/, "");

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
  root.MD.format = { money, moneyTick, count, pct, quantile };
})(typeof window !== "undefined" ? window : globalThis);
