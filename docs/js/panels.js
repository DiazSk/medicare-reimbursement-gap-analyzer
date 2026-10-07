/* Panel renderers for the dashboard. Each render* takes a plain view object
   shaped like the contract in index.html's viewFromPayload() -- never the
   global payload -- so a later task can plug in live SQL results unchanged. */
(function (root) {
  "use strict";

  const { money, moneyTick, count, pct, quantile } = root.MD.format;
  const { tokens } = root.MD.charts;
  const { reliability, isReliable } = root.MD.guardrails;
  const T = () => tokens();

  /* ── choropleth support ─────────────────────────────────────────────────
     Geometry lives in us-states.js (us-atlas albers variant, pre-projected and
     pre-inset). Read it lazily, not at load time: panels.test.js loads this module
     with no window.US_STATES at all. */
  const GEOM = () => root.US_STATES || {};

  // The viewBox origin is NEGATIVE because the albers geometry starts at x = -58
  // (Alaska). A "0 0 975 610" box clips it; this cost a rebuild to find.
  const VIEWBOX = "-60 12 1085 595";
  const V = () => root.MD.svg;

  /* Mounts an svg.js chart into its host. dotPlot and dumbbellPlot cannot measure their own
     host -- svg.js is deliberately DOM-free -- so the width is read here. Without it a
     caller silently gets a 760-wide viewBox in a 526px box and 7.3px labels, which is
     the defect this helper exists to make unrepeatable.

     `renderer` names the svg.js function to call, so dumbbellPlot gets the same width
     injection rather than re-opening the footgun at its own call site. Charts that
     build bespoke SVG (hero 3's Lorenz curve, hero 5's scatter) take no spec object
     and read their host directly; generalising further for two callers that share no
     shape would be inventing a framework. */
  function mountSvg(id, title, spec, renderer) {
    const host = document.getElementById(id);
    if (!host) {
      // A typo'd id would otherwise be an empty box with nothing in the console.
      console.warn(`mountSvg: no element #${id}`);
      return;
    }
    const draw = V()[renderer || "dotPlot"];
    host.innerHTML = (title ? `<h3 class="figtitle">${V().esc(title)}</h3>` : "")
      + draw(Object.assign({ t: T(), width: host.clientWidth || 760 }, spec));
  }
  // Callout labels for areas too small to hold one sit in a right margin at this x.
  const GUTTER_X = 952;

  /* Bounding box and centre straight off the path's own numbers. Every command in
     this data is M or L with absolute x,y pairs, so the coordinate stream is simply
     every other number -- no path parser needed. */
  function pathBox(d) {
    const n = d.match(/-?\d+(?:\.\d+)?/g);
    if (!n) return null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k < n.length - 1; k += 2) {
      const x = +n[k], y = +n[k + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  }

  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  /* ── HERO 1 ─────────────────────────────────────────────────────────────── */
  function geoByState(geoRows, filters) {
    const acc = {};
    for (const r of geoRows) {
      if (filters.ruca !== "all" && r.ruca !== filters.ruca) continue;
      const a = acc[r.state] || (acc[r.state] = { premium: 0, pymt: 0, benes: 0 });
      a.premium += r.premium || 0;
      a.pymt += r.pymt || 0;
      a.benes += r.benes || 0;
    }
    return Object.entries(acc).map(([state, a]) => ({
      state, ...a, perBene: a.benes > 0 ? a.premium / a.benes : null,
    }));
  }


  /* Four magnitude bins, and SIGN CARRIED BY FILL TEXTURE rather than by hue: solid is
     above the geographically standardized amount, a 45-degree rule-hatch is below. The
     ramp step then means magnitude on BOTH sides of zero -- eight distinguishable
     states instead of four, which is the resolution the tile map had to spend on sign.

     Quantising is also a contrast fix, though not the one the plan described. The old
     continuous ramp had a dead band where a fill fails 4.5:1 against EITHER ink, and
     binning does make that band unreachable. What binning does NOT fix is the ink
     choice: r300 is a bin, and a single luminance threshold picks white on it at
     2.50:1. That is why the ink comes from rampInk() below and not from a threshold. */
  /* Label ink per ramp bin, taken from the arithmetic rather than from a luminance
     threshold. A single luminance-threshold picker CANNOT express this mapping:
     r300's relative luminance is 0.3694, just under a 0.4 cutoff, so it would choose
     white at 2.50:1 where --ink gives 7.11:1. Measured against each fill:

       bin 0  r100   --ink 13.45:1   white  1.32:1
       bin 1  r300   --ink  7.11:1   white  2.50:1
       bin 2  r500   --ink  3.30:1   white  5.39:1
       bin 3  r700   --ink  1.49:1   white 11.95:1

     The plan claimed quantising made that bad band unreachable. It does not --
     r300 IS one of the four bins, so the threshold was reachable on every load. */
  const rampInk = (bin) => (bin <= 1 ? T().ink1 : "#ffffff");

  const binOf = (v, bound) => Math.min(3, Math.floor(Math.abs(v) / bound * 4));

  function renderChoropleth(rows, filters, bound) {
    const host = document.getElementById("tilemap");
    const G = GEOM();
    if (!Object.keys(G).length) {
      // Loud, not silent: a blank panel would look like a filter with no matches.
      host.innerHTML = '<p class="empty">State geometry (js/us-states.js) did not load, '
        + 'so the map cannot be drawn. The ranking beside it is unaffected.</p>';
      return;
    }
    const ramp = T().ramp;
    const by = Object.fromEntries(rows.map(r => [r.state, r]));
    const per = (st) => (by[st] && by[st].perBene !== null ? by[st].perBene : null);

    // One pattern per bin. Pitch tightens as magnitude rises so the hatch reads as
    // ordered even in monochrome or in print.
    const defs = ramp.map((hex, i) => `<pattern id="h1rule${i}" width="${7 - i}" `
      + `height="${7 - i}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
      + `<rect width="${7 - i}" height="${7 - i}" fill="${T().sheet}"/>`
      + `<line x1="0" y1="0" x2="0" y2="${7 - i}" stroke="${hex}" `
      + `stroke-width="${(1.4 + i * 0.5).toFixed(1)}"/></pattern>`).join("")
      + `<pattern id="h1nodata" width="5" height="5" patternUnits="userSpaceOnUse" `
      + `patternTransform="rotate(45)"><rect width="5" height="5" fill="${T().sheet}"/>`
      + `<line x1="0" y1="0" x2="0" y2="5" stroke="${T().hair}" stroke-width="1"/></pattern>`;

    // Label the eight largest by magnitude; the rest would collide.
    const ranked = Object.keys(G).filter(s => per(s) !== null)
      .sort((a, b) => Math.abs(per(b)) - Math.abs(per(a)));
    const labelled = new Set(ranked.slice(0, 8));

    const shapes = [], labels = [], callouts = [];
    for (const [st, d] of Object.entries(G)) {
      const v = per(st), box = pathBox(d);
      const sel = filters.state !== "all" && st === filters.state;
      const dim = filters.state !== "all" && !sel;
      // Selection rides on the OUTLINE, never on the fill: the fill is already
      // carrying both sign and magnitude.
      const edge = sel ? `stroke="${T().ink1}" stroke-width="2"`
        : `stroke="${T().muted}" stroke-width=".8"`;
      const fade = dim ? ' opacity=".35"' : "";

      if (v === null) {
        const t = V().tipParts({ label: st, value: "No data for this filter" });
        shapes.push(`<path d="${d}" fill="url(#h1nodata)" ${edge}${fade}${t.attr}>`
          + `${t.child}</path>`);
        continue;
      }
      const b = binOf(v, bound), up = v >= 0;
      // Same three parts as every other mark, so one hover layer serves the map too.
      const t = V().tipParts({
        label: st,
        value: `${money(v, 2)} per beneficiary-proxy`,
        note: `${up ? "Above" : "Below"} the standardized amount`,
      });
      shapes.push(`<path d="${d}" fill="${up ? ramp[b] : `url(#h1rule${b})`}" ${edge}${fade}`
        + `${t.attr}>${t.child}</path>`);

      if (!labelled.has(st) || !box || dim) continue;
      if (box.w > 24 && box.h > 14) {
        // A hatched fill is mostly sheet, so it always takes the dark ink.
        const ink = up ? rampInk(b) : T().ink1;
        labels.push(`<text x="${box.cx.toFixed(0)}" y="${(box.cy + 3).toFixed(0)}" `
          + `text-anchor="middle" font-size="9.5" letter-spacing=".06em" `
          + `fill="${ink}">${esc(st)}</text>`);
      } else {
        callouts.push({ st, v, cx: box.cx, cy: box.cy });
      }
    }

    /* Too small to hold a label, so it goes in the right margin with a leader -- the
       atlas convention, and the only way DC/RI/DE/CT read at all. Stacked top-down and
       pushed apart so two leaders never land on the same line.
       ponytail: right gutter only. Every area small enough to need one is in the
       northeast; a western one would need a left gutter too. */
    callouts.sort((a, b) => a.cy - b.cy);
    let lastY = -Infinity;
    for (const c of callouts) {
      const ty = Math.max(c.cy, lastY + 14);
      lastY = ty;
      labels.push(`<polyline points="${(c.cx + 2).toFixed(0)},${c.cy.toFixed(0)} `
        + `${(GUTTER_X - 16)},${ty.toFixed(0)} ${(GUTTER_X - 4)},${ty.toFixed(0)}" `
        + `fill="none" stroke="${T().ink1}" stroke-width=".8"/>`
        + `<circle cx="${c.cx.toFixed(0)}" cy="${c.cy.toFixed(0)}" r="1.8" fill="${T().ink1}"/>`
        + `<text x="${GUTTER_X}" y="${(ty + 3).toFixed(0)}" font-size="9.5" `
        + `letter-spacing=".06em" fill="${T().ink1}">${esc(c.st)} ${esc(money(c.v, 2))}</text>`);
    }

    host.innerHTML = `<svg viewBox="${VIEWBOX}" role="img" aria-label="Geographic premium `
      + `per beneficiary-proxy by state. Solid fill is above the standardized amount, `
      + `ruled fill is below.">`
      /* The labels and callout leaders are drawn over the states, so without
         pointer-events="none" a label swallows the hover for the very state it
         names -- elementFromPoint returns the <text>, which is a sibling of the
         <path> and carries no tip, so closest() finds nothing and the map reads as
         having no data exactly where it is most legible. */
      + `<defs>${defs}</defs>${shapes.join("")}`
      + `<g pointer-events="none">${labels.join("")}</g></svg>`;
  }

  /* Eight keys plus a conditional ninth. The no-data key appears ONLY when a no-data
     area was actually drawn -- a legend key for a state the map does not contain is a
     claim about nothing, and this mockup grew phantom keys twice before this rule. */
  function hero1Legend(rows, bound) {
    const ramp = T().ramp;
    const G = GEOM();
    const drawnStates = rows.filter(r => G[r.state] && r.perBene !== null).length;
    const missing = Object.keys(G).length - drawnStates;
    const step = (i) => money(bound * (i + 1) / 4, 2);
    const solid = ramp.map((c, i) =>
      `<span class="lk"><i style="background:${c}"></i>${step(i)}</span>`).join("");
    const ruled = ramp.map((c, i) =>
      `<span class="lk"><i style="background:${T().sheet};background-image:`
      + `repeating-linear-gradient(45deg,transparent 0 ${6 - i}px,${c} ${6 - i}px `
      + `${(7.4 - i + i * 0.5).toFixed(1)}px)"></i>${step(i)}</span>`).join("");
    const nodata = missing > 0
      ? `<span class="lk"><i style="background:${T().sheet};background-image:`
        + `repeating-linear-gradient(45deg,transparent 0 3px,${T().hair} 3px 4px)"></i>`
        + `No data</span>`
      : "";
    return `<span class="lgroup">Solid · above standard</span>${solid}`
      + `<span class="lgroup">Ruled · below</span>${ruled}${nodata}`;
  }

  function renderHero1(view, filters) {
    const rows = geoByState(view.geo, filters);
    const G = GEOM();
    // Scale only over areas the map actually DRAWS. Territories like MP and FM are in
    // the data but have no geometry, and letting them set the bound compressed every
    // drawn state toward the midpoint.
    const drawn = rows.filter(r => G[r.state] && r.perBene !== null);
    const absSorted = drawn.map(r => Math.abs(r.perBene)).sort((a, b) => a - b);
    // p95 rather than max: Alaska's geographic adjustment is a genuine outlier at
    // roughly twice the next state, so anchoring on it flattens the other fifty. The
    // bin function clamps and the legend states the true range, so nothing is hidden.
    const bound = quantile(absSorted, 0.95) || 1;
    const lo = drawn.length ? Math.min(...drawn.map(r => r.perBene)) : Infinity;
    const hi = drawn.length ? Math.max(...drawn.map(r => r.perBene)) : -Infinity;

    renderChoropleth(rows, filters, bound);
    document.getElementById("ramp").innerHTML = hero1Legend(rows, bound);
    document.getElementById("rampScale").textContent = hero1Ramp(drawn, bound, lo, hi);

    // tornado: extremes at both ends, by total premium
    const sorted = rows.slice().sort((a, b) => b.premium - a.premium);
    const top = sorted.slice(0, 10), bot = sorted.slice(-10).reverse();
    const pick = top.concat(bot).filter((v, i, a) =>
      a.findIndex(x => x.state === v.state) === i);
    pick.sort((a, b) => b.premium - a.premium);

    mountSvg("cGeo", "Largest net senders and receivers", {
      rows: pick,
      label: (r) => r.state,
      value: (r) => r.premium,
      fmt: moneyTick,
      fmtValue: (v) => money(v),
      signed: true,
      axisTitle: "Geographic premium (paid − standardized)",
      aria: "Largest net senders and receivers of geographic premium, by state",
      tip: (r) => ({ label: r.state, value: `${money(r.premium)} premium`,
                     note: `${money(r.pymt)} total Medicare paid` }),
    });

    document.getElementById("h1read").textContent = hero1Read(sorted);
  }

  /* Every readout below is a pure function of the view so it can be tested at
     cohort counts the national payload never produces. Static mode always hands
     these panels the full national arrays, so only live mode reaches the 1- and
     0-cohort branches — but the branches are chosen from the data, not from the
     mode, because "which mode am I in" is not something a renderer should know.

     The templates were written against the static payload, where nonpar_stats
     and the kpi block are national regardless of filter. Live mode recomputes
     them per filter, which is more correct and which drove the originals into
     sentences they were never written for: hero 1 naming one state as both
     extremes with a $0.00 spread between them. */
  const POLICY = "Geographic adjustment is deliberate Medicare policy (wages and "
    + "rent differ); the magnitude is what is worth seeing.";

  function hero1Read(sorted) {
    if (!sorted.length) {
      return "No state matches this filter, so there is no geographic premium to read.";
    }
    if (sorted.length === 1) {
      // A spread needs two cohorts. Naming the same state as both extremes and
      // reporting $0.00 between them reads as a broken calculation.
      const one = sorted[0];
      return `Reading it: this filter selects a single cohort. ${one.state} bills `
        + `${money(Math.abs(one.premium))} ${one.premium >= 0 ? "more" : "less"} than the `
        + `geographically standardized amount for the same work`
        // Math.abs on BOTH figures: "more"/"less" above already carries the
        // direction, so a signed per-beneficiary value reads as a double
        // negative ("bills $4.5K less … -$1.29 per beneficiary-proxy").
        + `${Number.isFinite(one.perBene)
            ? ` — ${money(Math.abs(one.perBene), 2)} per beneficiary-proxy` : ""}. `
        + `Comparing states needs more than one selected, so there is no spread to rank. `
        + POLICY;
    }
    const mx = sorted[0], mn = sorted[sorted.length - 1];
    return `Reading it: ${mx.state} bills ${money(mx.premium)} more than the geographically `
      + `standardized amount for the same work, while ${mn.state} bills `
      + `${money(Math.abs(mn.premium))} less — a spread of `
      + `${money(mx.premium - mn.premium)} attributable to location, not medicine. `
      + POLICY;
  }

  function hero1Ramp(drawn, bound, lo, hi) {
    // lo/hi come from Math.min/max over `drawn`; at zero rows they are ±Infinity,
    // which money() renders as an em dash rather than "$Infinity".
    if (!drawn.length) return "no mapped state matches this filter";
    if (drawn.length === 1) {
      // Unlike h1read this chip has no "more"/"less" to carry the direction, so
      // it says it in the legend's own words rather than leaning on a minus sign
      // ("single cohort · -$8.95 per beneficiary-proxy" was the OK/Unknown case).
      return `single cohort · ${money(Math.abs(lo), 2)} `
        + `${lo < 0 ? "below" : "above"} standard per beneficiary-proxy`;
    }
    return `scale ±${money(bound, 2)} per beneficiary-proxy · actual range `
      + `${money(lo, 2)} to ${money(hi, 2)} (beyond the scale is clamped)`;
  }

  /* ── HERO 2 ─────────────────────────────────────────────────────────────── */
  function renderHero2(view, filters) {
    const st = view.nonparStats;
    const hi = filters.spec === "all" ? null : filters.spec;
    // Specialties with a real non-par cohort, PLUS whichever one the filter
    // selected. Warn, never hide: filtering to Orthopedic Surgery must show its
    // +2,223% wearing a thin-sample badge, not silently drop the panel's only row.
    // The unselected exclusions are named in the caveat line under the chart.
    const ok = view.nonpar.filter(d => d.measurable || d.specialty === hi)
      .sort((a, b) => b.premium_pct - a.premium_pct);
    const forced = !!hi && view.nonpar.some(d => d.specialty === hi && !d.measurable);

    /* Three semantics, three channels -- and one of them is now free. Stage 7c put
       sign on BOTH position and filled/hollow, which was redundant: with a zero
       rule, position is unambiguous on its own. So filled/hollow carries
       RELIABILITY, which is the thing this panel most needs to signal, and the
       1.67:1 alpha fade it replaced is gone for good.

         sign         position across the zero rule
         reliability  filled (ok) vs hollow (thin / very-thin)
         selection    the --seal band behind the row, plus the label going to ink */
    const h2title = `Specialties with at least ${st.min_nonpar_providers} `
      + `non-participating providers`
      + (forced ? ` · plus ${hi}, hollow as a thin sample` : "");
    mountSvg("cNonPar", h2title, {
      rows: ok,
      label: (d) => d.specialty,
      value: (d) => d.premium_pct,
      fmt: (v) => pct(v, 0),
      // pct(v, 0) renders -0.615 as "-62%" while this page's own prose
      // (pinned in panels.test.js) quotes -61.5%. The value column must not
      // contradict the sentence beside it.
      fmtValue: (v) => pct(v),
      signed: true,
      filled: (d) => isReliable(reliability(Number(d.n_n))),
      emphasis: (label) => label === hi,
      family: T().sans,
      highlight: (d) => !!hi && d.specialty === hi,
      axisTitle: "Non-participating exposure vs. participating",
      aria: "Non-participating patient exposure by specialty",
      tip: (d) => ({
        label: d.specialty,
        value: `${pct(d.premium_pct)} ${d.premium_pct < 0 ? "lower" : "higher"} patient exposure`,
        note: `participating ${money(d.exp_y)}/beneficiary (${count(d.n_y)} providers) · `
          + `non-participating ${money(d.exp_n)}/beneficiary (${count(d.n_n)} providers)`,
      }),
    });

    // The denominators ARE the story, so they get their own chart rather than a
    // second axis. Log scale: the two cohorts differ by three orders of magnitude.
    const cohort = view.nonpar.slice()
      .sort((a, b) => (b.n_n || 0) - (a.n_n || 0)).slice(0, 12);
    // The 4th argument selects the renderer; without it mountSvg would call dotPlot.
    mountSvg("cNonParAbs", "Why the ratios are fragile: cohort sizes (log scale)", {
      rows: cohort,
      label: (d) => d.specialty,
      a: (d) => d.n_y,
      b: (d) => d.n_n,
      fmt: (v) => count(v),
      axisTitle: "Distinct providers",
      aria: "Participating and non-participating provider counts by specialty",
      tip: (d) => ({ label: d.specialty, value: `${count(d.n_y)} participating`,
                     note: `${count(d.n_n)} non-participating` }),
      legend: ["Participating providers", "Non-participating providers"],
    }, "dumbbellPlot");

    document.getElementById("h2read").textContent = hero2Read(view);
    document.getElementById("h2caveat").textContent = hero2Caveat(view);
  }

  function hero2Read(view) {
    const st = view.nonparStats, k = view.kpi;
    // The national participation scalars are true at every filter, so they open
    // the sentence in all three branches.
    const national = `only ${count(k.nonpar_providers)} of ${count(k.n_providers)} providers `
      + `(${pct(k.nonpar_pct, 3)}) are non-participating`;
    if (!st.specialties_compared) {
      return `Reading it: ${national}. No specialty in this filter has providers on both `
        + `sides of that line, so there is nothing to compare here.`;
    }
    if (st.specialties_compared === 1) {
      // A distribution across a population of one is not a distribution, and the
      // national sentence explained a phenomenon with zero instances ("0 show
      // non-participating providers leaving patients with LESS exposure").
      const d = view.nonpar[0];
      const dir = d.premium_pct >= 0 ? "MORE" : "LESS";
      return `Reading it: ${national}. In ${d.specialty}, non-participating providers leave `
        + `patients with ${pct(Math.abs(d.premium_pct))} ${dir} exposure per beneficiary than `
        + `their participating peers — ${money(d.exp_n)} against ${money(d.exp_y)} — on `
        + `${count(d.n_n)} non-participating providers measured against ${count(d.n_y)} `
        + `participating ones.`;
    }
    return `Reading it: ${national}. Of ${st.specialties_compared} `
      + `specialties where both groups appear, ${st.negative} show non-participating providers `
      + `leaving patients with LESS exposure, not more — the opposite of the expected direction. `
      + `The likeliest explanation is case mix rather than generosity: the tiny non-par cohorts `
      + `bill a different, cheaper mix of procedures.`;
  }

  function hero2Caveat(view) {
    const st = view.nonparStats;
    if (!st.specialties_compared) return "";
    if (st.specialties_compared === 1) {
      const d = view.nonpar[0];
      if (d.measurable) {
        return `Why it is not badged: ${count(d.n_n)} non-participating providers is at or above `
          + `the ${count(st.min_nonpar_providers)} this dashboard treats as a stable denominator, `
          + `so the ratio is read as a measurement rather than an artifact.`;
      }
      // This is the canonical guardrail case (Orthopedic Surgery, n=11). The
      // number stays on screen, faded and badged -- suppressing it would hide the
      // very artifact this panel exists to name.
      return `Why it is badged: ${count(d.n_n)} non-participating providers is too small a `
        + `denominator for a stable ratio — a handful of unusual bills moves it by hundreds of `
        + `percent, which is why ${count(st.min_nonpar_providers)} is the floor for treating one `
        + `as a finding. It is shown faded and labelled rather than hidden, because the `
        + `denominator artifact is itself the point.`;
    }
    return `Why the threshold: all ${st.positive} specialties showing a positive premium rest on `
      + `11 or fewer non-participating providers. Orthopedic Surgery's apparent +2,223% is `
      + `11 providers measured against 20,699 — a denominator artifact, not a finding, which `
      + `is why only the ${st.measurable} specialties with at least `
      + `${st.min_nonpar_providers} non-par providers are charted.`;
  }

  /* ── HERO 3 ─────────────────────────────────────────────────────────────── */
  function renderHero3(view) {
    const pts = view.lorenz.map(p => ({ x: p.x, y: p.y }));
    /* A Lorenz curve IS a line, so it stays one. The only encoding decision is the
       reference diagonal: 1px dashed --ink-3, which is 4.72:1 where the old
       --ink-muted was 2.96:1 and failed. */
    (() => {
      /* Ruling V applies here too, even though these two charts cannot use
         mountSvg: the viewBox must match the rendered width or the whole SVG scales
         and every label scales with it. Measured: the host is 606px, so a hardcoded
         520 would magnify by 1.17 and drift at any other viewport. Read the host. */
      const host = document.getElementById("cLorenz");
      const S = V(), t = T();
      const W = Math.max(320, host.clientWidth || 520), H = 360;
      const padL = 54, padR = 10, padT = 10, padB = 42;
      const x = S.scaleLinear([0, 1], [padL, W - padR]);
      const y = S.scaleLinear([0, 1], [H - padB, padT]);
      const curve = pts.map((p) => [x(p.x), y(p.y)]);
      let body = "";
      for (const tick of S.niceTicks(0, 1, 5)) {
        body += S.rule(padL, W - padR, y(tick), { stroke: t.grid });
      }
      body += S.pathLine([[x(0), y(0)], [x(1), y(1)]],
        { stroke: t.muted, width: 1, dash: "5 4" });
      body += S.pathLine(curve, { stroke: t.series, width: 2.2 });
      /* The curve is one <path>, so there is nothing per-datum to hover. These are
         invisible hit targets: no fill, no stroke, pointer-events="all" to stay
         hit-testable anyway. Subsampled to ~24 of the payload's 200 points -- at this
         width that is a target every ~22px, close enough to feel continuous without
         200 extra nodes in the DOM.

         Held back and appended LAST, after the axis and its labels. Drawn in place
         here they sat under the axis line, and the three targets nearest the origin
         -- where the curve is flattest and the "bottom 9% hold 0%" reading is the
         whole point of the chart -- were unhoverable. Hit targets go on top of
         everything, not just the mark they belong to. */
      const step = Math.max(1, Math.ceil(pts.length / 24));
      let hits = "";
      for (let i = 0; i < pts.length; i += step) {
        const p = pts[i];
        const tp = S.tipParts({
          label: `Bottom ${pct(p.x, 0)} of providers`,
          value: `${pct(p.y, 0)} of drug spend`,
        });
        hits += `<circle cx="${x(p.x).toFixed(2)}" cy="${y(p.y).toFixed(2)}" r="11" `
          + `fill="none" pointer-events="all"${tp.attr}>${tp.child}</circle>`;
      }
      body += S.axisBottom(x, H - padB, (v) => pct(v, 0),
        { axis: t.axis, muted: t.muted });
      for (const tick of S.niceTicks(0, 1, 5)) {
        body += `<text x="${padL - 8}" y="${y(tick) + 3.5}" text-anchor="end" `
          + `font-size="10.5" fill="${t.muted}">${pct(tick, 0)}</text>`;
      }
      body += `<text x="${padL}" y="${H - 6}" font-size="10.5" fill="${t.muted}">`
        + `Share of drug-billing providers, poorest to richest</text>`;
      body += hits;   // topmost, so nothing drawn above can swallow a hover
      host.innerHTML =
        `<h3 class="figtitle">Lorenz curve — Gini ${view.kpi.gini}</h3>`
        + `<div class="legend"><span class="lk">`
        + `<i style="background:${t.series}"></i>Actual distribution</span>`
        + `<span class="lk"><i style="background:${t.sheet};`
        + `border-color:${t.muted}"></i>Perfect equality</span></div>`
        + S.frame(W, H, body,
            { aria: `Lorenz curve of drug spend concentration, Gini ${view.kpi.gini}` });
    })();

    const j = view.jcodeTop.slice(0, 15);
    mountSvg("cJcode", "Largest drug codes by Medicare payment", {
      rows: j,
      label: (d) => d.hcpcs,
      value: (d) => d.pymt,
      fmt: moneyTick,
      fmtValue: (v) => money(v),
      axisTitle: "Medicare payment",
      aria: "Largest drug codes by Medicare payment",
      tip: (d) => ({ label: d.hcpcs, value: money(d.pymt),
                     note: `${count(d.providers)} providers` }),
    });

    document.getElementById("h3read").textContent = hero3Read(view);
  }

  function hero3Read(view) {
    const k = view.kpi;
    if (!k.n_drug_providers) {
      return "No provider in this filter billed a drug code, so there is no concentration "
        + "to measure.";
    }
    const bits = [];
    if (Number.isFinite(k.lorenz_top1))
      bits.push(`the top 1% of prescribers account for ${pct(k.lorenz_top1)} of it`);
    if (Number.isFinite(k.lorenz_top10))
      bits.push(`the top 10% for ${pct(k.lorenz_top10)}`);
    // A cohort of one has no distribution, so the SQL returns no Gini for it.
    if (!Number.isFinite(k.gini)) {
      return `Reading it: ${count(k.n_drug_providers)} provider${k.n_drug_providers === 1
        ? "" : "s"} in this filter billed a drug code — too few for a concentration measure, `
        + `so no Gini is reported.`;
    }
    // "Extreme" is a claim about the number, and a narrower cohort can be far
    // more even than the national 0.906. Let the number pick its own adjective.
    const verdict = k.gini >= 0.8 ? "extreme concentration"
      : k.gini >= 0.5 ? "substantial concentration"
        : "a relatively even distribution";
    return `Reading it: across ${count(k.n_drug_providers)} providers who billed at least one `
      + `drug code, ${bits.join(", and ")}${bits.length ? ". " : ""}A Gini of ${k.gini} is `
      + `${verdict} — for scale, US household income sits near 0.49. Much of this is `
      + `structural: infusion-heavy specialties buy and bill expensive biologics, so a few `
      + `practices carry enormous drug volume legitimately.`;
  }

  /* ── HERO 4 ─────────────────────────────────────────────────────────────── */
  const TIER_LABELS = { md: "Physician (MD/DO)", np: "Nurse Practitioner",
                        pa: "Physician Assistant", spec: "Specialist" };
  function renderHero4(view) {
    const tiers = view.credentialTiers.filter(t => TIER_LABELS[t]);
    const rows = view.credentials.filter(d => d.shared)
      .filter(d => tiers.some(t => d[t] !== null && d[t] !== undefined))
      .sort((a, b) => a.hcpcs.localeCompare(b.hcpcs));
    /* A HEATMAP, not a grouped bar chart. Four credential tiers are non-ordinal
       categories, and the largest mutually->=3:1 subset of a single blue ramp is two
       steps -- which is why index.html used to carry a comment admitting two of these
       four series failed 3:1. Drawing the matrix AS a matrix removes the problem
       instead of working around it: position carries the category, the ramp carries
       the value, and each cell prints its own number.

       Rendered as a real HTML grid rather than on a canvas, so the 24 values are
       selectable text, reachable by a screen reader through role="table", and printable.
       #cCred is therefore a <div>, not a <canvas>; it is no longer mounted as a chart.

       The plan also called for hatching thin cells, as the reference hatches n<200.
       Not implemented, because it is not measurable here: gold_hero_credentials_markup
       carries no per-cell provider count, only the ratio. Inventing a threshold would
       be a guardrail that asserts something nobody measured. */
    const cells = rows.flatMap(d => tiers.map(t => d[t]))
      .filter(v => v !== null && v !== undefined);
    const lo = Math.min(...cells), hi = Math.max(...cells);
    // Span the OBSERVED range, not zero to max: every value sits between 1.66x and
    // 2.84x, so a zero-based ramp would crush all 24 cells into the top two bins.
    const span = hi - lo || 1;
    const ramp = T().ramp;
    const cellBin = (v) => Math.max(0, Math.min(3, Math.floor((v - lo) / span * 4)));

    const head = `<div class="hmrow hmhead" role="row">`
      + `<span role="columnheader">Code</span>`
      + tiers.map(t => `<span role="columnheader">${esc(TIER_LABELS[t])}</span>`).join("")
      + `</div>`;
    const body = rows.map(d => `<div class="hmrow" role="row">`
      + `<span class="hmcode" role="rowheader" aria-label="${esc(d.hcpcs)} · ${esc(d.desc)}"`
      + ` data-tip-label="${esc(d.hcpcs)}" data-tip-value="${esc(d.desc)}">${esc(d.hcpcs)}</span>`
      + tiers.map(t => {
          const v = d[t];
          if (v === null || v === undefined) {
            return `<span class="hmcell hmna" role="cell">&mdash;</span>`;
          }
          const bin = cellBin(v);
          /* The heatmap is HTML, not SVG, so it is the one chart tipParts() cannot
             build. It carries the same three attributes by hand instead, and
             aria-label replaces the title it used to have: in HTML the title
             ATTRIBUTE is the native tooltip, so keeping it would draw the grey
             system box underneath the styled one. aria-label announces the same
             thing and renders nothing -- and it is the better announcement anyway,
             since the cell's own text is only "2.06x". */
          const label = `${esc(d.hcpcs)} · ${esc(TIER_LABELS[t])} · `
            + `${v.toFixed(2)}x allowed`;
          return `<span class="hmcell" role="cell" style="background:${ramp[bin]};`
            + `color:${rampInk(bin)}" aria-label="${label}" `
            + `data-tip-label="${esc(d.hcpcs)}" `
            + `data-tip-value="${v.toFixed(2)}x allowed" `
            + `data-tip-note="${esc(TIER_LABELS[t])}">`
            + `${v.toFixed(2)}x</span>`;
        }).join("")
      + `</div>`).join("");

    document.getElementById("cCred").innerHTML = rows.length
      ? `<div class="hm" role="table" aria-label="Markup ratio by HCPCS code and `
        + `credential tier" style="--hmcols:${tiers.length}">${head}${body}</div>`
        + `<div class="legend"><span class="lgroup">Submitted &divide; allowed</span>`
        + ramp.map((c, i) => `<span class="lk"><i style="background:${c}"></i>`
            + `${(lo + span * (i + 1) / 4).toFixed(2)}x</span>`).join("")
        + `</div>`
      : `<p class="empty">No shared code has coverage in more than one credential tier `
        + `under this filter, so there is no matrix to draw.</p>`;

    const th = ["Code", "Description"].concat(tiers.map(t => TIER_LABELS[t]));
    document.getElementById("tCred").innerHTML =
      `<thead><tr>${th.map((h, i) =>
        `<th class="${i < 2 ? "l" : ""}" style="cursor:default">${h}</th>`).join("")}</tr></thead>`
      + `<tbody>${rows.map(d => `<tr><td class="l">${d.hcpcs}</td>`
        + `<td class="l">${d.desc.slice(0, 58)}</td>`
        + tiers.map(t => `<td>${d[t] === null || d[t] === undefined
          ? "—" : d[t].toFixed(2) + "x"}</td>`).join("") + `</tr>`).join("")}</tbody>`;

    // Rank tiers by their mean markup across the shared codes, rather than assuming
    // a direction. The data runs opposite to the intuition that physicians bill
    // highest: PAs and NPs submit the larger multiples on identical codes.
    const means = tiers.map(t => {
      const vals = rows.map(d => d[t]).filter(v => v !== null && v !== undefined);
      return { t, mean: vals.reduce((a, b) => a + b, 0) / (vals.length || 1), n: vals.length };
    }).filter(m => m.n).sort((a, b) => b.mean - a.mean);

    // Widest spread on a single code, whichever tiers form it.
    let widest = null;
    for (const d of rows) {
      const vals = tiers.map(t => ({ t, v: d[t] })).filter(x => x.v !== null && x.v !== undefined);
      if (vals.length < 2) continue;
      vals.sort((a, b) => b.v - a.v);
      const spread = vals[0].v - vals[vals.length - 1].v;
      if (!widest || spread > widest.spread)
        widest = { spread, d, hi: vals[0], lo: vals[vals.length - 1] };
    }

    document.getElementById("h4read").textContent = (means.length >= 2 && widest)
      ? `Reading it: the order runs opposite to the intuition that physicians bill the most. `
        + `Averaged across these six codes, ${TIER_LABELS[means[0].t]} submit the highest `
        + `multiple of the allowed amount (${means[0].mean.toFixed(2)}x) and `
        + `${TIER_LABELS[means[means.length - 1].t]} the lowest `
        + `(${means[means.length - 1].mean.toFixed(2)}x), with `
        + `${TIER_LABELS[means.find(m => m.t === "md") ? "md" : means[1].t]} at `
        + `${(means.find(m => m.t === "md") || means[1]).mean.toFixed(2)}x. The widest single-code `
        + `spread is ${widest.d.hcpcs}, where ${TIER_LABELS[widest.hi.t]} submit `
        + `${widest.hi.v.toFixed(2)}x against ${TIER_LABELS[widest.lo.t]} at `
        + `${widest.lo.v.toFixed(2)}x — ${widest.spread.toFixed(2)}x apart for identical work. `
        + `Medicare's allowed amount barely moves between tiers, so the gap is in what gets `
        + `asked for, not what gets paid. Credentials are parsed from a free-text CMS field, so `
        + `tier assignment is approximate.`
      : "Not enough overlapping tier coverage on the shared codes to compare.";
  }

  /* ── HERO 5 ─────────────────────────────────────────────────────────────── */
  function renderHero5(view) {
    const rows = view.siteScatter.filter(d => d.f_pymt !== null && d.o_pymt !== null);
    const lim = Math.max(...rows.flatMap(d => [d.f_pymt, d.o_pymt])) * 1.05 || 1;
    const maxV = Math.max(...rows.map(d => d.f_svcs || 0)) || 1;
    const ss = view.siteStats;

    (() => {
      // Ruling V: read the host rather than hardcoding, same as cLorenz above.
      const host = document.getElementById("cSite");
      const S = V(), t = T();
      const W = Math.max(320, host.clientWidth || 520), H = 430;
      const padL = 62, padR = 12, padT = 10, padB = 44;
      const x = S.scaleLinear([0, lim], [padL, W - padR]);
      const y = S.scaleLinear([0, lim], [H - padB, padT]);
      let body = "";
      for (const tick of x.ticks(5)) {
        body += S.rule(padL, W - padR, y(tick), { stroke: t.grid });
      }
      body += S.pathLine([[x(0), y(0)], [x(lim), y(lim)]],
        { stroke: t.muted, width: 1, dash: "5 4" });
      for (const d of rows) {
        body += S.bubble(x(d.o_pymt), y(d.f_pymt),
          4 + 14 * Math.sqrt((d.f_svcs || 0) / maxV),
          { fill: t.series + "b0", stroke: t.series,
            tip: { label: d.hcpcs,
                   value: `facility ${money(d.f_pymt)} · office ${money(d.o_pymt)}`,
                   note: `${count(d.f_svcs)} facility services` } });
      }
      body += S.axisBottom(x, H - padB, moneyTick,
        { axis: t.axis, muted: t.muted });
      for (const tick of y.ticks(5)) {
        body += `<text x="${padL - 8}" y="${y(tick) + 3.5}" text-anchor="end" `
          + `font-size="10.5" fill="${t.muted}">${moneyTick(tick)}</text>`;
      }
      body += `<text x="${padL}" y="${H - 6}" font-size="10.5" fill="${t.muted}">`
        + `Office (non-facility) payment per service</text>`;
      host.innerHTML =
        `<h3 class="figtitle">The 60 highest-volume codes billed in both `
        + `settings</h3>`
        + S.frame(W, H, body,
            { aria: "Facility against office payment per service, bubble area is facility volume" });
    })();

    // Both directions on one signed axis -- showing only the positive tail is
    // how the original "savings" framing went wrong.
    const bar = view.siteBarNeg.slice(0, 8).concat(view.siteBarPos.slice(0, 8))
      .sort((a, b) => (b.savings || 0) - (a.savings || 0));
    mountSvg("cSiteBar", "Largest differentials, both directions", {
      rows: bar,
      label: (d) => d.hcpcs,
      value: (d) => d.savings,
      fmt: moneyTick,
      fmtValue: (v) => money(v),
      signed: true,
      axisTitle: "Facility premium (negative = office pays more)",
      aria: "Largest site-of-service differentials in both directions",
      tip: (d) => ({
        label: d.hcpcs,
        value: `${(d.savings || 0) >= 0 ? "facility costs more" : "office costs more"} `
          + `${money(Math.abs(d.savings || 0))}`,
        note: d.desc,
      }),
    });

    document.getElementById("h5read").textContent =
      `Reading it: of ${count(ss.n_codes)} codes billed in both settings, `
      + `${count(ss.o_gt_f)} pay the physician MORE in an office and only `
      + `${count(ss.f_gt_o)} pay more in a facility — median facility rate is `
      + `${ss.median_ratio}x the office rate. Netted out, facility billing is `
      + `${money(Math.abs(ss.net))} ${ss.net < 0 ? "cheaper" : "dearer"} on the professional `
      + `fee alone.`;
    document.getElementById("h5caveat").textContent =
      `Why this is not a savings estimate: this dataset holds only the physician's `
      + `professional fee. When a procedure moves into a facility, Medicare pays the hospital `
      + `separately under the Outpatient Prospective Payment System, which is a different `
      + `dataset entirely. So the ${money(Math.abs(ss.net))} is where payment MOVED, not money `
      + `saved — a genuine site-neutral estimate requires joining OPPS data. The `
      + `${money(ss.pos)} facility-premium tail is real, but it is outweighed by the `
      + `${money(Math.abs(ss.neg))} pointing the other way.`;
  }

  /* ── detail table ───────────────────────────────────────────────────────── */
  const PROV_COLS = [
    { k: "npi", t: "NPI", l: true },
    { k: "specialty", t: "Specialty", l: true },
    { k: "state", t: "State", l: true },
    { k: "drug_pymt", t: "Drug payment", f: money },
    { k: "total_pymt", t: "Total payment", f: money },
    { k: "share", t: "Drug share", f: v => pct(v, 1) },
  ];
  function provRows(view, filters, state) {
    return view.providers.filter(r =>
      (filters.state === "all" || r.state === filters.state) &&
      (filters.spec === "all" || r.specialty === filters.spec)
    ).sort((a, b) => {
      const x = a[state.sort], y = b[state.sort];
      if (typeof x === "string") return x.localeCompare(y) * state.dir;
      return ((x ?? -Infinity) - (y ?? -Infinity)) * state.dir;
    });
  }
  function renderProviders(view, filters, state) {
    const rows = provRows(view, filters, state);
    const pages = Math.max(1, Math.ceil(rows.length / state.size));
    state.page = Math.min(state.page, pages - 1);
    const slice = rows.slice(state.page * state.size, (state.page + 1) * state.size);

    document.getElementById("tProv").innerHTML =
      `<thead><tr>${PROV_COLS.map(c =>
        `<th class="${c.l ? "l" : ""}" data-k="${c.k}">${c.t}`
        + `${state.sort === c.k ? (state.dir < 0 ? " ▼" : " ▲") : ""}</th>`).join("")}</tr></thead>`
      + (slice.length
        ? `<tbody>${slice.map(r => `<tr>${PROV_COLS.map(c =>
            `<td class="${c.l ? "l" : ""}">${c.f ? c.f(r[c.k]) : r[c.k] || "—"}</td>`
          ).join("")}</tr>`).join("")}</tbody>`
        : `<tbody><tr><td colspan="${PROV_COLS.length}" class="empty">`
          + `No providers match this filter.</td></tr></tbody>`);

    document.querySelectorAll("#tProv th").forEach(th => th.onclick = () => {
      const k = th.dataset.k;
      if (state.sort === k) state.dir *= -1;
      // Live mode can return an empty cohort (a state x specialty nobody bills a
      // drug in); the static payload's 200 rows never could.
      else { state.dir = typeof (view.providers[0] || {})[k] === "string" ? 1 : -1;
             state.sort = k; }
      state.page = 0; renderProviders(view, filters, state);
    });

    document.getElementById("provPager").innerHTML = rows.length
      ? `<span>${count(rows.length)} providers · page ${state.page + 1} of ${pages}</span>`
        + `<button id="pPrev" ${state.page === 0 ? "disabled" : ""}>Previous</button>`
        + `<button id="pNext" ${state.page >= pages - 1 ? "disabled" : ""}>Next</button>`
      : "";
    const prev = document.getElementById("pPrev"), next = document.getElementById("pNext");
    if (prev) prev.onclick = () => { state.page--; renderProviders(view, filters, state); };
    if (next) next.onclick = () => { state.page++; renderProviders(view, filters, state); };
  }

  /* ── KPI ribbon, header, footer ─────────────────────────────────────────── */
  function renderStatics(payload) {
    const k = payload.kpi, m = payload.meta;
    const tiles = [
      ["Medicare paid", money(k.total_mdcr_pymt), `${m.data_year} professional fees`],
      ["Providers", count(k.n_providers), "distinct billing NPIs"],
      ["Procedure codes", count(k.n_hcpcs), "distinct HCPCS"],
      ["Drug-spend Gini", (k.gini ?? "—").toString(),
        `top 1% bill ${pct(k.lorenz_top1)} of it`],
      ["Non-participating", pct(k.nonpar_pct, 3),
        `${count(k.nonpar_providers)} of ${count(k.n_providers)} providers`],
      ["Facility pays less", `${count(payload.site_stats.o_gt_f)} / `
        + `${count(payload.site_stats.n_codes)}`, "codes, on the professional fee"],
    ];
    document.getElementById("kpis").innerHTML = tiles.map(([l, v, n]) =>
      `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div>`
      + `<div class="note">${n}</div></div>`).join("");

    document.getElementById("prov").innerHTML =
      `${count(m.source_rows)} claim rows · CMS ${m.data_year} · `
      + `<code>${m.cms_file}</code> · Gold layer rebuilt ${m.generated}`;
    document.getElementById("srcLink").href = m.cms_url;
    document.getElementById("foot").textContent =
      `Built by Zaid Shaikh. Pipeline: PySpark + Delta Lake (Bronze → Silver → Gold), `
      + `originally on Azure Databricks. Data rebuilt from the public CMS source on `
      + `${m.generated}.`;
  }

  root.MD = root.MD || {};
  root.MD.panels = {
    TIER_LABELS, binOf, pathBox, rampInk,
    renderKpis: renderStatics,   // alias: the ribbon and header render together
    renderHero1, renderHero2, renderHero3, renderHero4, renderHero5,
    renderProviders, renderStatics, geoByState, mountSvg,
    // Exported for docs/js/panels.test.js: these are the only DOM-free parts of
    // this module, and the 1- and 0-cohort prose is otherwise reachable only by a
    // human clicking through filters on a live page.
    readouts: { hero1Read, hero1Ramp, hero2Read, hero2Caveat, hero3Read },
  };
})(window);
