/* Chart.js scaffolding shared by both pages. Reads theme values from CSS custom
   properties so one theme toggle repaints every chart. */
(function (root) {
  "use strict";

  Chart.defaults.animation = false;          // many charts on one page
  Chart.defaults.maintainAspectRatio = false;

  const css = (k) =>
    getComputedStyle(document.documentElement).getPropertyValue(k).trim();

  let T = {};

  function readTokens() {
    // The family is set here, not at load time, because it now comes from a CSS
    // custom property: charts.test.js loads this module with no document at all, so a
    // load-time getComputedStyle would kill its three tests. Guarded on a non-empty
    // read -- assigning "" would leave Chart.js with no family to measure with.
    const fam = css("--font-sans");
    if (fam) Chart.defaults.font.family = fam;

    // The OUTPUT keys are a stable interface -- about forty call sites across panels.js,
    // live.js and explore.js read them -- so only the right-hand sides move here.
    // `critical` is gone: it was read on every repaint and consumed by nothing.
    // `grid` and `axis` now resolve to the same hairline; both keys stay because
    // axisOpts uses them in different slots.
    T = {
      ink1: css("--ink"), ink2: css("--ink-2"), muted: css("--ink-3"),
      grid: css("--hair"), axis: css("--hair"), surface: css("--sheet"),
      s1: css("--series"), s2: css("--series-2"),
      s3: css("--series-3"), s4: css("--series-4"),
      div: [css("--div-neg2"), css("--div-neg1"), css("--div-mid"),
            css("--div-pos1"), css("--div-pos2")],
    };
    return T;
  }

  const tokens = () => T;

  function axisOpts(title, fmt, extra) {
    // `callback: fmt` with fmt === null does NOT fall back to Chart.js's own
    // tick formatter -- it explicitly overrides it with null, Chart.js's
    // callCallback(null, ...) returns undefined for every tick, and the axis
    // draws no labels at all. Category axes (state codes, HCPCS codes, ...)
    // pass no formatter on purpose and need Chart.js's default; only set the
    // key when a formatter is actually supplied.
    const ticks = { color: T.muted, font: { size: 11 } };
    if (fmt) ticks.callback = fmt;
    return Object.assign({
      title: title
        ? { display: true, text: title, color: T.ink2, font: { size: 11.5 } }
        : undefined,
      grid: { color: T.grid, drawTicks: false },
      border: { color: T.axis },
      ticks,
    }, extra || {});
  }

  const legendOpts = (show) => ({
    display: !!show, position: "top", align: "end",
    labels: {
      color: T.ink2, boxWidth: 11, boxHeight: 11, usePointStyle: true,
      pointStyle: "rectRounded", font: { size: 12 },
    },
  });

  const tooltipOpts = (cb) => ({
    backgroundColor: T.surface, titleColor: T.ink1, bodyColor: T.ink2,
    borderColor: T.axis, borderWidth: 1, padding: 10, displayColors: true,
    callbacks: cb || {},
  });

  const charts = {};

  function mount(id, cfg) {
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(document.getElementById(id), cfg);
    return charts[id];
  }

  root.MD = root.MD || {};
  root.MD.charts = { readTokens, tokens, axisOpts, legendOpts, tooltipOpts, mount, charts };
})(window);
