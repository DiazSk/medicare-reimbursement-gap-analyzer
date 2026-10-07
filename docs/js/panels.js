/* Panel renderers for the dashboard. Each render* takes a plain view object
   shaped like the contract in index.html's viewFromPayload() -- never the
   global payload -- so a later task can plug in live SQL results unchanged. */
(function (root) {
  "use strict";

  const { money, count, pct, quantile } = root.MD.format;
  const { tokens, axisOpts, legendOpts, tooltipOpts, mount } = root.MD.charts;
  const { reliability, patternPitch } = root.MD.guardrails;
  const { hatch } = root.MD.charts;
  const T = () => tokens();

  /* A 1px --ink rule at x = 0 on the diverging bar charts. Sign is already carried by
     which side of zero a bar sits on; this just makes the datum visible, so the
     filled/hollow channel is confirmation rather than the only cue.
     Registered per-chart via `plugins: [ZERO_RULE]`, not globally: cLorenz and cSite
     have a meaningful x = 0 that is an axis end, not a midpoint. */
  const ZERO_RULE = {
    id: "zeroRule",
    afterDatasetsDraw(chart) {
      const x = chart.scales.x, y = chart.scales.y;
      if (!x || !y || x.min > 0 || x.max < 0) return;
      const px = x.getPixelForValue(0);
      const g = chart.ctx;
      g.save();
      g.beginPath();
      g.moveTo(px, y.top);
      g.lineTo(px, y.bottom);
      g.lineWidth = 1;
      g.strokeStyle = T().ink1;
      g.stroke();
      g.restore();
    },
  };

  /* The selected row's band, drawn BEHIND the bars. A beforeDatasetsDraw plugin rather
     than a ghost dataset: a dataset would appear in the legend, in the tooltip, and in
     the stacking, and it would also have to carry a value. This draws and nothing else,
     which is why selection can come off the bar's fill entirely.

     Takes a getter, not a value: mount() builds the config once per render, and the
     selected specialty changes between renders. */
  const SEAL_BAND = (getSelected) => ({
    id: "sealBand",
    beforeDatasetsDraw(chart) {
      const sel = getSelected();
      if (!sel) return;
      const y = chart.scales.y, x = chart.scales.x;
      if (!y || !x) return;
      const i = y.getLabels().indexOf(sel);
      if (i < 0) return;
      const h = Math.max(14, y.height / Math.max(1, y.getLabels().length));
      const cy = y.getPixelForTick(i);
      const g = chart.ctx;
      g.save();
      g.fillStyle = T().seal;
      g.fillRect(x.left, cy - h / 2, x.width, h);
      g.restore();
    },
  });

  /* ── choropleth support ─────────────────────────────────────────────────
     Geometry lives in us-states.js (us-atlas albers variant, pre-projected and
     pre-inset). Read it lazily, not at load time: panels.test.js loads this module
     with no window.US_STATES at all. */
  const GEOM = () => root.US_STATES || {};

  // The viewBox origin is NEGATIVE because the albers geometry starts at x = -58
  // (Alaska). A "0 0 975 610" box clips it; this cost a rebuild to find.
  const VIEWBOX = "-60 12 1085 595";
  const V = () => root.MD.svg;
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
     threshold. A single-threshold picker -- format.js's inkOn(), which this replaced
     and which is now deleted -- CANNOT express this mapping: r300's relative
     luminance is 0.3694, just under that 0.4 cutoff, so it chose white at 2.50:1
     where --ink gives 7.11:1. Measured against each fill:

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
        shapes.push(`<path d="${d}" fill="url(#h1nodata)" ${edge}${fade}>`
          + `<title>${esc(st)} · no data for this filter</title></path>`);
        continue;
      }
      const b = binOf(v, bound), up = v >= 0;
      shapes.push(`<path d="${d}" fill="${up ? ramp[b] : `url(#h1rule${b})`}" ${edge}${fade}>`
        + `<title>${esc(st)} · ${esc(money(v, 2))} per beneficiary-proxy · `
        + `${up ? "above" : "below"} standard</title></path>`);

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
      + `<defs>${defs}</defs>${shapes.join("")}${labels.join("")}</svg>`;
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
    pick.sort((a, b) => a.premium - b.premium);

    mount("cGeo", {
      type: "bar",
      plugins: [ZERO_RULE],
      data: {
        labels: pick.map(r => r.state),
        datasets: [{
          label: "Geographic premium",
          data: pick.map(r => r.premium),
          // Sign is position across the zero rule, reinforced by filled (above the
          // standardized amount) vs hollow (below). The old two-hue ramp was always
          // redundant with position, so this loses nothing and spends no second hue.
          backgroundColor: pick.map(r => r.premium >= 0 ? T().series : T().sheet),
          borderColor: T().series,
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: "y",
        plugins: {
          legend: legendOpts(false),
          title: { text: "Largest net senders and receivers" },
          tooltip: tooltipOpts({
            label: c => ` ${money(c.raw)} geographic premium`,
            afterLabel: c => {
              const r = pick[c.dataIndex];
              return `${money(r.pymt)} total Medicare paid`;
            },
          }),
        },
        scales: {
          x: axisOpts("Geographic premium (paid − standardized)", v => money(v, 0)),
          y: axisOpts(null, null, { grid: { display: false } }),
        },
      },
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
      .sort((a, b) => a.premium_pct - b.premium_pct);
    const forced = !!hi && view.nonpar.some(d => d.specialty === hi && !d.measurable);

    mount("cNonPar", {
      type: "bar",
      plugins: [ZERO_RULE, SEAL_BAND(() => hi)],
      data: {
        labels: ok.map(d => d.specialty),
        datasets: [{
          label: "Patient exposure vs. participating peers",
          data: ok.map(d => d.premium_pct),
          /* Three semantics were stacked on this one fill -- sign, reliability and
             selection -- and reliability was ALPHA, which put the two warning states at
             2.05:1 and 1.67:1. The bars this guardrail exists to flag were the least
             legible things on the page. Each semantic gets its own channel now:

               sign         position across the zero rule, --series fill above the
                            comparison and --whisker below. Whisker, not sheet: the
                            negative bars ARE the finding, and a sheet fill reads as
                            absence rather than as a result.
               reliability  hatch pitch inside the mark (guardrails.patternPitch).
               selection    off the mark entirely -- SEAL_BAND behind the row, plus the
                            y-tick going to full ink.

             The 1px --series border is the compliance mechanism: whatever the interior
             does, the silhouette stays 4.03:1. Orthopedic Surgery at n=11 keeps its
             full +2,223% bar, crisply outlined with a sparse interior -- warn, never
             hide, and now without making the warned number harder to read. */
          backgroundColor: (c) => {
            const d = ok[c.dataIndex];
            if (!d) return T().sheet;
            const base = d.premium_pct > 0 ? T().series : T().whisker;
            return hatch(c.chart && c.chart.ctx, base,
                         patternPitch(reliability(Number(d.n_n))));
          },
          borderColor: T().series,
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: "y",
        plugins: {
          legend: legendOpts(false),
          title: { text: `Specialties with at least ${st.min_nonpar_providers} `
                     + `non-participating providers`
                     + (forced ? ` · plus ${hi}, hatched as a thin sample` : "") },
          tooltip: tooltipOpts({
            label: c => ` ${pct(c.raw)} ${c.raw < 0 ? "lower" : "higher"} patient exposure`,
            afterLabel: c => {
              const d = ok[c.dataIndex];
              return [`Participating: ${money(d.exp_y)} per beneficiary (${count(d.n_y)} providers)`,
                      `Non-participating: ${money(d.exp_n)} per beneficiary (${count(d.n_n)} providers)`];
            },
          }),
        },
        scales: {
          x: axisOpts("Non-participating exposure vs. participating", v => pct(v, 0)),
          // Specialty names are content, not metadata, so this axis alone overrides the
          // mono default. extra.ticks replaces ticks wholesale (charts.test.js pins
          // that), which is why the family is set here rather than globally.
          y: axisOpts(null, null, { grid: { display: false },
               ticks: { color: T().ink2, font: { size: 10.5, family: T().sans } } }),
        },
      },
    });

    // The denominators ARE the story, so they get their own chart rather than a
    // second axis. Log scale: the two cohorts differ by three orders of magnitude.
    const cohort = view.nonpar.slice()
      .sort((a, b) => (b.n_n || 0) - (a.n_n || 0)).slice(0, 12);
    mount("cNonParAbs", {
      type: "bar",
      data: {
        labels: cohort.map(d => d.specialty),
        datasets: [
          { label: "Participating providers", data: cohort.map(d => d.n_y),
            // Two categories inside one hue: solid --series against a --whisker fill
            // behind the same --series border, so the smaller cohort reads lighter
            // without spending a second hue or dropping its outline below 4.03:1.
            backgroundColor: T().series, borderColor: T().series, borderWidth: 1 },
          { label: "Non-participating providers", data: cohort.map(d => d.n_n),
            backgroundColor: T().whisker, borderColor: T().series, borderWidth: 1 },
        ],
      },
      options: {
        indexAxis: "y",
        plugins: {
          legend: legendOpts(true),
                    title: { text: "Why the ratios are fragile: cohort sizes (log scale)" },
          tooltip: tooltipOpts({ label: c => ` ${c.dataset.label}: ${count(c.raw)}` }),
        },
        scales: {
          x: axisOpts("Distinct providers", v => count(v),
                      { type: "logarithmic", min: 1 }),
          // Specialty names are content, not metadata, so this axis alone overrides the
          // mono default. extra.ticks replaces ticks wholesale (charts.test.js pins
          // that), which is why the family is set here rather than globally.
          y: axisOpts(null, null, { grid: { display: false },
               ticks: { color: T().ink2, font: { size: 10.5, family: T().sans } } }),
        },
      },
    });

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
    mount("cLorenz", {
      type: "scatter",
      data: {
        datasets: [
          { label: "Actual distribution", data: pts, showLine: true, borderColor: T().series,
            backgroundColor: T().series, borderWidth: 2.2, pointRadius: 0, fill: false,
            tension: 0 },
          { label: "Perfect equality", data: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
            // A reference, not a series: 1px dashed --ink-3, which is 4.72:1 where
            // the old --ink-muted was 2.96:1 and failed.
            showLine: true, borderColor: T().muted, borderWidth: 1,
            borderDash: [5, 4], pointRadius: 0, fill: false },
        ],
      },
      options: {
        plugins: {
          legend: legendOpts(true),
                    title: { text: `Lorenz curve — Gini ${view.kpi.gini}` },
          tooltip: tooltipOpts({
            label: c => ` ${pct(c.parsed.x)} of prescribers → ${pct(c.parsed.y)} of drug spend`,
          }),
        },
        scales: {
          x: axisOpts("Share of drug-billing providers, poorest to richest", v => pct(v, 0),
                      { min: 0, max: 1 }),
          y: axisOpts("Cumulative share of drug spend", v => pct(v, 0), { min: 0, max: 1 }),
        },
      },
    });

    const j = view.jcodeTop.slice(0, 15);
    const jcodeHost = document.getElementById("cJcode");
    jcodeHost.innerHTML =
      `<h3 class="figtitle">Largest drug codes by Medicare payment</h3>`
      + V().dotPlot({
          t: T(),
          // The viewBox must match the rendered width or the whole SVG scales and the
          // labels shrink with it -- 760 into a 526px box rendered them at 7.3px.
          width: jcodeHost.clientWidth || 760,
          rows: j,
          label: (d) => d.hcpcs,
          value: (d) => d.pymt,
          fmt: (v) => money(v, 0),
          fmtValue: (v) => money(v),
          axisTitle: "Medicare payment",
          aria: "Largest drug codes by Medicare payment",
          tip: (d) => `${d.hcpcs} · ${money(d.pymt)} · ${count(d.providers)} providers`,
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
      + `<span class="hmcode" role="rowheader" title="${esc(d.desc)}">${esc(d.hcpcs)}</span>`
      + tiers.map(t => {
          const v = d[t];
          if (v === null || v === undefined) {
            return `<span class="hmcell hmna" role="cell">&mdash;</span>`;
          }
          const bin = cellBin(v);
          return `<span class="hmcell" role="cell" style="background:${ramp[bin]};`
            + `color:${rampInk(bin)}" `
            + `title="${esc(d.hcpcs)} · ${esc(TIER_LABELS[t])} · ${v.toFixed(2)}x allowed">`
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

    mount("cSite", {
      type: "bubble",
      data: {
        datasets: [
          { label: "Procedure code (bubble = facility volume)",
            data: rows.map(d => ({ x: d.o_pymt, y: d.f_pymt,
              r: 4 + 14 * Math.sqrt((d.f_svcs || 0) / maxV) })),
            backgroundColor: T().series + "b0", borderColor: T().series, borderWidth: 1 },
          { label: "Equal payment in both settings", type: "line",
            data: [{ x: 0, y: 0 }, { x: lim, y: lim }],
            borderColor: T().muted, borderWidth: 1, borderDash: [5, 4],
            pointRadius: 0, fill: false },
        ],
      },
      options: {
        plugins: {
          legend: legendOpts(true),
                    title: { text: "The 60 highest-volume codes billed in both settings" },
          tooltip: tooltipOpts({
            title: c => c[0].datasetIndex === 0 ? rows[c[0].dataIndex].hcpcs : "",
            label: c => {
              if (c.datasetIndex !== 0) return "";
              const d = rows[c.dataIndex];
              return [` Facility: ${money(d.f_pymt)} per service`,
                      ` Office: ${money(d.o_pymt)} per service`,
                      ` Facility pays ${d.ratio === null ? "—"
                          : d.ratio.toFixed(2) + "x"} the office rate`,
                      ` ${count(d.f_svcs)} facility services`];
            },
            afterBody: c => c[0].datasetIndex === 0
              ? rows[c[0].dataIndex].desc.slice(0, 70) : "",
          }),
        },
        scales: {
          x: axisOpts("Office (non-facility) payment per service", v => money(v, 0),
                      { min: 0, max: lim }),
          y: axisOpts("Facility payment per service", v => money(v, 0), { min: 0, max: lim }),
        },
      },
    });

    // Both directions on one diverging axis -- showing only the positive tail is
    // how the original "savings" framing went wrong.
    const bar = view.siteBarNeg.slice(0, 8).concat(view.siteBarPos.slice(0, 8))
      .sort((a, b) => (a.savings || 0) - (b.savings || 0));
    mount("cSiteBar", {
      type: "bar",
      plugins: [ZERO_RULE],
      data: {
        labels: bar.map(d => d.hcpcs),
        datasets: [{
          label: "Facility minus office, times facility volume",
          data: bar.map(d => d.savings),
          backgroundColor: bar.map(d => (d.savings || 0) >= 0 ? T().series : T().sheet),
          borderColor: T().series,
          borderWidth: 1,
        }],
      },
      options: {
        indexAxis: "y",
        plugins: {
          legend: legendOpts(false),
                    title: { text: "Largest differentials, both directions" },
          tooltip: tooltipOpts({
            title: c => bar[c[0].dataIndex].hcpcs,
            label: c => ` ${c.raw >= 0 ? "Facility costs more: " : "Office costs more: "}`
              + `${money(Math.abs(c.raw))}`,
            afterLabel: c => bar[c.dataIndex].desc.slice(0, 70),
          }),
        },
        scales: {
          x: axisOpts("Facility premium (negative = office pays more)", v => money(v, 0)),
          y: axisOpts(null, null, { grid: { display: false } }),
        },
      },
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
    renderProviders, renderStatics, geoByState,
    // Exported for docs/js/panels.test.js: these are the only DOM-free parts of
    // this module, and the 1- and 0-cohort prose is otherwise reachable only by a
    // human clicking through filters on a live page.
    readouts: { hero1Read, hero1Ramp, hero2Read, hero2Caveat, hero3Read },
  };
})(window);
