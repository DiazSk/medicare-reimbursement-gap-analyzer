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
    const f = (label, i) => {
      // An explicit index wins, so duplicate labels no longer collapse onto one band.
      // Callers that have a row index should pass it; the label lookup stays for
      // callers that only have the string.
      const k = (typeof i === "number" && i >= 0 && i < labels.length) ? i : idx.get(label);
      // An unknown label is a data/label mismatch, not a reason to emit NaN.
      if (k === undefined) return (r0 + r1) / 2;
      return r0 + step * (k + 0.5);
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

  /* ── marks ──────────────────────────────────────────────────────────────── */

  // Two decimals is below a device pixel at every size this page draws, and it
  // keeps the markup diffable when a renderer is changed.
  const n2 = (v) => (Math.round(v * 100) / 100).toString();

  /* A tip is { label, value, note } -- the entity, the number, and the cohort it
     rests on. tip.js reads the three attributes separately so it can set the label
     in grey mono above a bold value; <title> gets them joined, because a screen
     reader announces an element's title as one utterance and three sibling
     attributes would announce as nothing. Both or neither: an empty <title> is an
     empty announcement.

     A bare string is accepted as a value-only tip. Every call site passes parts, but
     a missed one should render its text rather than "[object Object]" -- index.html
     swallows render throws into a console.warn, so a loud failure here would not
     actually be loud. */
  const TIP_KEYS = ["label", "value", "note"];

  function tipParts(tip) {
    if (tip === null || tip === undefined || tip === "") return { attr: "", child: "" };
    const p = typeof tip === "string" ? { value: tip } : tip;
    const present = TIP_KEYS.filter((k) => p[k] !== null && p[k] !== undefined && p[k] !== "");
    if (!present.length) return { attr: "", child: "" };
    return {
      attr: present.map((k) => ` data-tip-${k}="${esc(p[k])}"`).join(""),
      // Only the parts that exist, so there is never a dangling separator.
      child: `<title>${present.map((k) => esc(p[k])).join(" · ")}</title>`,
    };
  }

  function rule(x1, x2, y, o) {
    return `<line x1="${n2(x1)}" y1="${n2(y)}" x2="${n2(x2)}" y2="${n2(y)}" `
      + `stroke="${o.stroke}" stroke-width="${o.width == null ? 1 : o.width}"/>`;
  }

  /* Hollow is --sheet interior inside a --series stroke, so the OUTLINE carries
     the contrast -- 4.03:1 regardless of what sits behind the interior. That is
     what makes filled/hollow a legal encoding channel. */
  function dot(x, y, r, o) {
    const t = tipParts(o.tip);
    return `<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(r)}" `
      + `fill="${o.filled ? o.series : o.sheet}" stroke="${o.series}" `
      + `stroke-width="1"${t.attr}>${t.child}</circle>`;
  }

  function dumbbell(xA, xB, y, o) {
    const r = o.r == null ? 4 : o.r;
    const t = tipParts(o.tip);
    return `<g${t.attr}>${t.child}`
      + rule(xA, xB, y, { stroke: o.series, width: 1 })
      // B is the smaller cohort by convention, drawn in --whisker inside the same
      // --series stroke so it reads lighter without spending a second hue.
      + `<circle cx="${n2(xB)}" cy="${n2(y)}" r="${n2(r)}" fill="${o.whisker}" `
      + `stroke="${o.series}" stroke-width="1"/>`
      + `<circle cx="${n2(xA)}" cy="${n2(y)}" r="${n2(r)}" fill="${o.series}" `
      + `stroke="${o.series}" stroke-width="1"/>`
      + `</g>`;
  }

  function pathLine(points, o) {
    if (!points || !points.length) return "";
    const d = points
      .map((p, i) => (i ? "L" : "M") + n2(p[0]) + "," + n2(p[1]))
      .join("");
    return `<path d="${d}" fill="none" stroke="${o.stroke}" `
      + `stroke-width="${o.width == null ? 1 : o.width}"`
      + (o.dash ? ` stroke-dasharray="${o.dash}"` : "") + `/>`;
  }

  /* The explicit 1px stroke is the compliance mechanism, not decoration: hero 5's
     fill is --series at 69% alpha, which is 2.53:1 on its own. */
  function bubble(x, y, r, o) {
    const t = tipParts(o.tip);
    return `<circle cx="${n2(x)}" cy="${n2(y)}" r="${n2(r)}" fill="${o.fill}" `
      + `stroke="${o.stroke}" stroke-width="1"${t.attr}>${t.child}</circle>`;
  }

  /* ── chrome ─────────────────────────────────────────────────────────────── */

  /* Geist Mono at its default width. 0.62em is measured, not guessed: the mono
     face is monospaced, so one ratio covers every string, and the gutter has to be
     sized from the LONGEST label or the longest one clips silently. */
  const MONO_RATIO = 0.62;
  function labelWidth(labels, px) {
    let max = 0;
    for (const l of labels) max = Math.max(max, String(l == null ? "" : l).length);
    return Math.ceil(max * px * MONO_RATIO);
  }

  /* The horizontal budget, shared by both plots. The label gutter takes what its
     longest label needs (cap 220) -- but never so much that the plot area falls below
     MIN_PLOT, because a 37px plot at 320px is every dot in one smear. When the gutter
     has to yield, labels are cut to fit with an ellipsis (`maxChars`, else null).
     MIN_PLOT is 160: the narrowest measured findings-page host (526) leaves 243px with
     the widest gutter, so 160 never touches it, while at a 375px phone it still leaves
     a plot a reader can read. GUTTER_FLOOR keeps about six characters of label. */
  const MIN_PLOT = 160, GUTTER_FLOOR = 48;
  function fitGutter(labels, W, rightReserve) {
    const want = Math.min(220, labelWidth(labels, 10.5) + 14);
    const gutter = Math.min(want, Math.max(GUTTER_FLOOR, W - rightReserve - MIN_PLOT));
    if (gutter >= want) return { gutter, maxChars: null };
    return { gutter, maxChars: Math.max(2, Math.floor((gutter - 14) / (10.5 * MONO_RATIO))) };
  }

  function axisBottom(scale, y, fmt, o) {
    const all = scale.ticks ? scale.ticks(5) : [];
    const r0 = scale.range[0], r1 = scale.range[1];
    // Only the ticks that actually land on the drawing. (A scale's own ticks() stays
    // inside its domain, but a caller may hand over any list.)
    const drawn = all.filter((t) => {
      const x = scale(t);
      return x >= r0 - 1 && x <= r1 + 1;
    });
    /* A brief formatter can render two neighbouring ticks identically (a 0-decimal
       one turns 1.5e9 and 2e9 both into "$2B"), which puts two identical labels on
       one axis -- worse than an imprecise one, because it reads as a repeated datum.
       The shipped axes use moneyTick, which keeps those apart; this is the net for
       any formatter that does not. Fall back to the precise formatter ONLY when the brief one
       collides, so axes that do not collide keep their short labels. */
    let f = fmt;
    if (o.fmtPrecise && f) {
      const labels = drawn.map(f);
      if (new Set(labels).size !== labels.length) f = o.fmtPrecise;
    }
    let out = rule(r0, r1, y, { stroke: o.axis, width: 1 });
    /* Thin the ticks until neighbours clear each other. At a phone's 160px plot, three
       "100,000,000" labels (~72px each) printed on top of one another. Every k-th tick
       is kept, from the first; k is 1 -- nothing dropped -- wherever labels already fit. */
    const text = drawn.map((t) => String(f ? f(t) : t));
    const gap = drawn.length > 1 ? Math.abs(scale(drawn[1]) - scale(drawn[0])) : Infinity;
    const k = Math.max(1, Math.ceil((labelWidth(text, 10.5) + 8) / gap));
    for (const [i, t] of drawn.entries()) {
      if (i % k) continue;
      out += `<text x="${n2(scale(t))}" y="${n2(y + 14)}" text-anchor="middle" `
        + `font-size="10.5" fill="${o.muted}">${esc(text[i])}</text>`;
    }
    return out;
  }

  function axisLeft(labels, band, x, o) {
    const size = o.size == null ? 10.5 : o.size;
    /* The family goes in a STYLE attribute, not a presentation attribute, for two
       reasons both observed on the rendered page: the token value contains double
       quotes, which unescaped split the tag into fourteen attributes with nine garbage
       names; and dash.css's `.chartbox svg text { font-family: var(--font-mono) }`
       outranks a presentation attribute, so even escaped it would never apply. An
       inline style beats both. */
    const fam = o.family ? ` style="font-family:${esc(o.family)}"` : "";
    let out = "";
    for (const [i, l] of labels.entries()) {
      const emph = o.emphasis ? !!o.emphasis(l) : false;
      // Truncation is for the DRAWN text only; `l` stays the band key, so two labels
      // that truncate alike still get their own rows. The full text is the hover title.
      const full = String(l == null ? "" : l);
      const cut = o.maxChars != null && full.length > o.maxChars;
      const shown = cut ? full.slice(0, Math.max(1, o.maxChars - 1)) + "\u2026" : full;
      out += `<text x="${n2(x)}" y="${n2(band(l, i) + size / 3)}" text-anchor="end" `
        + `font-size="${size}"${fam}`
        + ` fill="${emph && o.ink ? o.ink : o.muted}">${esc(shown)}`
        + (cut ? `<title>${esc(full)}</title>` : "") + `</text>`;
    }
    return out;
  }

  /* Only where zero is actually in the domain. An all-positive cohort has no zero
     to mark, and a rule clamped to the axis edge draws a datum that is not there. */
  function zeroRule(scale, yTop, yBottom, o) {
    const d0 = Math.min(scale.domain[0], scale.domain[1]);
    const d1 = Math.max(scale.domain[0], scale.domain[1]);
    if (d0 > 0 || d1 < 0) return "";
    const x = scale(0);
    return `<line x1="${n2(x)}" y1="${n2(yTop)}" x2="${n2(x)}" y2="${n2(yBottom)}" `
      + `stroke="${o.ink}" stroke-width="1"/>`;
  }

  // An empty body yields no <svg> at all: a labelled empty frame reads as a
  // chart that found nothing, and the honest version of that belongs in prose.
  function frame(w, h, body, o) {
    if (!body) return "";
    return `<svg viewBox="0 0 ${n2(w)} ${n2(h)}" role="img" `
      + `aria-label="${esc(o.aria)}" preserveAspectRatio="xMidYMid meet">`
      + (o.defs ? `<defs>${o.defs}</defs>` : "")
      + body + `</svg>`;
  }

  /* The shared horizontal dot plot: six of the eight converted charts are this
     shape. One hairline per row, a dot on it, the value as mono text in the right
     margin -- which is exactly where the reference puts its confidence interval,
     and where this page has an honest figure to put instead.

     `signed: true` adds the zero rule and makes the default fill follow the sign.
     `filled` overrides that, because hero 2 needs the channel for reliability. */
  function dotPlot(spec) {
    const t = spec.t;
    const rows = spec.rows || [];
    if (!rows.length) {
      return `<p class="empty">No row matches this filter, so there is nothing `
        + `to plot here.</p>`;
    }

    const rowH = spec.rowH == null ? 26 : spec.rowH;
    // A detached or display:none host reports 0, which would collapse the drawing.
    const W = Math.max(320, spec.width == null ? 760 : spec.width);
    const labels = rows.map(spec.label);
    const fmtValue = spec.fmtValue || spec.fmt;
    /* The value column is sized from the formatted values, like the label gutter.
       It was a fixed 86, which holds 12 characters; "2,645,126,871" is 13 and drew as
       "2,645,126,87" -- no error, a plausible number wrong by a factor of ten. 86 stays
       as the floor so every chart whose values already fit is drawn exactly as before. */
    const valW = Math.min(160, Math.max(86, labelWidth(
      rows.map(spec.value).filter((v) => Number.isFinite(v)).map(fmtValue), 10.5) + 14));
    const { gutter, maxChars } = fitGutter(labels, W, valW);
    const padT = 8, padB = 34;
    const H = padT + rows.length * rowH + padB;
    const x0 = gutter, x1 = W - valW;

    const vals = rows.map(spec.value).filter((v) => Number.isFinite(v));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (spec.signed) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    const x = spec.log ? scaleLog([Math.max(1, lo), hi], [x0, x1])
                       : scaleLinear([lo, hi], [x0, x1]);
    const band = scaleBand(labels, [padT, padT + rows.length * rowH], 0);

    // The axis wants brevity; this column wants precision. The axis's moneyTick
    // renders $2.35B and $1.86B as "$2.4B" and "$1.9B", and the dot's position already
    // carries magnitude -- this text is the only place the exact figure appears on the chart.

    let body = "";

    /* The selection band is drawn FIRST, so it sits behind every mark -- a band
       that covers the dot it is selecting is worse than no band. dotPlot resolves
       it from a predicate rather than taking pre-built markup, so callers never
       have to know rowH, padT or the frame width. */
    if (spec.highlight) {
      for (const [i, r] of rows.entries()) {
        if (!spec.highlight(r)) continue;
        const y = band(spec.label(r), i);
        body += `<rect x="0" y="${y - rowH / 2}" width="${W}" `
          + `height="${rowH}" fill="${spec.seal || t.seal}"/>`;
      }
    }

    for (const [i, r] of rows.entries()) {
      const label = spec.label(r);
      const v = spec.value(r);
      const y = band(label, i);
      body += rule(x0, x1, y, { stroke: t.hair });
      if (!Number.isFinite(v)) continue;
      const filled = spec.filled ? !!spec.filled(r)
        : spec.signed ? v >= 0 : true;
      body += dot(x(v), y, 4.5,
        { filled, series: t.series, sheet: t.sheet, tip: spec.tip(r) });
      body += `<text x="${W - valW + 8}" y="${y + 3.5}" font-size="10.5" `
        + `fill="${t.ink2}">${esc(fmtValue(v))}</text>`;
    }

    if (spec.signed) {
      body += zeroRule(x, padT, padT + rows.length * rowH, { ink: t.ink1 });
    }
    body += axisLeft(labels, band, gutter - 10,
      { muted: t.ink2, ink: t.ink1, emphasis: spec.emphasis, family: spec.family, maxChars });
    body += axisBottom(x, padT + rows.length * rowH + 6, spec.fmt,
      { axis: t.axis, muted: t.muted, fmtPrecise: fmtValue });
    body += `<text x="${x0}" y="${H - 4}" font-size="10.5" fill="${t.muted}">`
      + `${esc(spec.axisTitle)}</text>`;

    return frame(W, H, body, { aria: spec.aria });
  }

  /* Participating and non-participating are a genuine PAIR on one row, which is
     what a dumbbell is for -- it reads as one comparison instead of two bars that
     happen to be adjacent. Log axis: the two cohorts differ by three orders of
     magnitude. */
  function dumbbellPlot(spec) {
    const t = spec.t;
    const rows = spec.rows || [];
    if (!rows.length) {
      return `<p class="empty">No specialty in this filter has providers on both `
        + `sides of the participation line, so there is no pair to compare.</p>`;
    }
    const rowH = 26, valW = 10;
    // A detached or display:none host reports 0, which would collapse the drawing.
    const W = Math.max(320, spec.width == null ? 760 : spec.width);
    const labels = rows.map(spec.label);
    const { gutter, maxChars } = fitGutter(labels, W, valW + 40);
    const padT = 8, padB = 34;
    const H = padT + rows.length * rowH + padB;
    const x0 = gutter, x1 = W - valW - 40;

    const all = rows.flatMap((r) => [spec.a(r), spec.b(r)])
      .filter((v) => Number.isFinite(v) && v > 0);
    const x = scaleLog([1, Math.max(2, Math.max.apply(null, all))], [x0, x1]);
    const band = scaleBand(labels, [padT, padT + rows.length * rowH], 0);

    let body = "";
    for (const [i, r] of rows.entries()) {
      const y = band(spec.label(r), i);
      body += rule(x0, x1, y, { stroke: t.hair });
      body += dumbbell(x(spec.a(r)), x(spec.b(r)), y,
        { series: t.series, sheet: t.sheet, whisker: t.whisker, tip: spec.tip(r) });
    }
    body += axisLeft(labels, band, gutter - 10,
      { muted: t.ink2, family: t.sans, maxChars });
    body += axisBottom(x, padT + rows.length * rowH + 6, spec.fmt,
      { axis: t.axis, muted: t.muted });
    body += `<text x="${x0}" y="${H - 4}" font-size="10.5" fill="${t.muted}">`
      + `${esc(spec.axisTitle)}</text>`;

    const legend = `<div class="legend"><span class="lk">`
      + `<i style="background:${t.series}"></i>${esc(spec.legend[0])}</span>`
      + `<span class="lk"><i style="background:${t.whisker}"></i>`
      + `${esc(spec.legend[1])}</span></div>`;

    return legend + frame(W, H, body, { aria: spec.aria });
  }

  root.MD = root.MD || {};
  /* tipParts is exported for marks this module does not draw -- the choropleth
     builds its own <path> per state, and it should carry the same attributes as
     every dot and bubble rather than hand-rolling a second tooltip format. */
  root.MD.svg = { esc, scaleLinear, scaleLog, scaleBand, niceTicks,
                  rule, dot, dumbbell, pathLine, bubble, tipParts,
                  axisBottom, axisLeft, labelWidth, zeroRule, frame,
                  dotPlot, dumbbellPlot };
})(typeof window !== "undefined" ? window : globalThis);
