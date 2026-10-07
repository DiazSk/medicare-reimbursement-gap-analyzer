/* Hand-drawn SVG primitives. Pure and DOM-free on purpose: there is no document
   here, colours arrive as arguments, and every function returns a string. That is
   what lets the scale arithmetic -- the part of a hand-rolled chart layer that
   actually breaks -- be tested directly in node.

   Classic script, not a module: ES modules are CORS-blocked over file://, and
   docs/index.html must keep opening straight from disk. */
(function (root) {
  "use strict";

  /* ── string safety ──────────────────────────────────────────────────────── */

  // `desc` and `specialty` are free-text CMS fields. One ampersand in a <title>
  // corrupts the document, and it fails silently -- the browser just stops parsing.
  function esc(s) {
    if (s === null || s === undefined) return "";
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ── scales ─────────────────────────────────────────────────────────────── */

  /* A zero-width domain is not an error, it is a one-cohort filter. Returning the
     range midpoint keeps the mark on screen and centred; returning NaN would
     produce d="MNaN,NaN", which renders nothing and throws nothing. */
  function scaleLinear(domain, range) {
    const d0 = domain[0], d1 = domain[1], r0 = range[0], r1 = range[1];
    const span = d1 - d0;
    const f = (v) => (span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0));
    f.domain = domain;
    f.range = range;
    f.ticks = (n) => niceTicks(d0, d1, n == null ? 5 : n);
    return f;
  }

  /* Counts, so the floor is 1: log(0) is -Infinity and a cohort of zero
     non-participating providers is ordinary data, not a bug. A zero-width domain
     returns the range midpoint, matching scaleLinear -- two sibling scales must not
     disagree about their degenerate case. */
  function scaleLog(domain, range) {
    const lo = Math.max(1, domain[0]);
    const hi = Math.max(1, domain[1]);
    const flat = !(hi > lo);
    const l0 = Math.log(lo), l1 = Math.log(hi);
    const r0 = range[0], r1 = range[1];
    const f = (v) => {
      if (flat) return (r0 + r1) / 2;
      const lv = Math.log(Math.max(1, v || 1));
      return r0 + ((lv - l0) / (l1 - l0)) * (r1 - r0);
    };
    f.domain = [lo, hi];
    f.range = range;
    /* Decade ticks. WITHOUT these, a consumer that asks a scale for its ticks gets
       an empty array and the axis renders with no labels at all. */
    f.ticks = () => {
      if (flat) return [lo];
      const out = [];
      for (let d = Math.pow(10, Math.floor(Math.log10(lo))); d <= hi; d *= 10) {
        if (d >= lo) out.push(d);
      }
      return out.length >= 2 ? out : [lo, hi];
    };
    return f;
  }

  function scaleBand(labels, range, pad) {
    const n = Math.max(1, labels.length);
    const r0 = range[0], r1 = range[1];
    const step = (r1 - r0) / n;
    const idx = new Map(labels.map((l, i) => [l, i]));
    const f = (label) => {
      const i = idx.get(label);
      // An unknown label is a data/label mismatch, not a reason to emit NaN.
      if (i === undefined) return (r0 + r1) / 2;
      return r0 + step * (i + 0.5);
    };
    f.step = step;
    f.inner = Math.max(1, step - (pad == null ? 0 : pad));
    f.labels = labels;
    return f;
  }

  /* 1-2-5 ticks. Two guarantees the axis depends on: nothing outside [lo, hi],
     and never fewer than two labels -- a single-tick axis reads as broken, and
     the 1-2-5 step can legitimately exceed a narrow span. */
  function niceTicks(lo, hi, n) {
    if (!isFinite(lo) || !isFinite(hi)) return [];
    if (lo === hi) return [lo];
    if (lo > hi) { const t = lo; lo = hi; hi = t; }
    const raw = (hi - lo) / Math.max(1, n);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
    // Rounding to the step's own precision, not snapping near zero. Accumulating
    // `v += step` yields 0.6000000000000001 and -5.55e-17 where 0 belongs, and
    // money()/pct() render the latter as "-$0.00". One mechanism covers both, and
    // it leaves no near-zero branch to go stale.
    const dp = (() => {
      const s = String(step);
      const i = s.indexOf(".");
      return i < 0 ? 0 : Math.min(20, s.length - i - 1);
    })();
    const out = [];
    const eps = step * 1e-9;
    const first = Math.ceil(lo / step) * step;
    for (let i = 0; ; i++) {
      const v = Number((first + i * step).toFixed(dp));
      if (v > hi + eps) break;
      out.push(v);
    }
    return out.length >= 2 ? out : [lo, hi];
  }

  root.MD = root.MD || {};
  root.MD.svg = { esc, scaleLinear, scaleLog, scaleBand, niceTicks };
})(typeof window !== "undefined" ? window : globalThis);
