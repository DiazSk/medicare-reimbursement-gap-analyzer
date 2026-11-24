/* The JS -> CSS colour seam shared by both pages. Reads theme values from CSS custom
   properties, so one theme toggle repaints every chart. Draws nothing itself; the
   marks come from svg.js. */
(function (root) {
  "use strict";

  const css = (k) =>
    getComputedStyle(document.documentElement).getPropertyValue(k).trim();

  let T = {};

  function readTokens() {
    // The OUTPUT keys are a stable interface -- about forty call sites across panels.js,
    // live.js and explore.js read them -- so only the right-hand sides move here.
    // Every colour must stay a 6-digit hex literal: panels.js appends alpha suffixes to
    // them as strings, and contract.test.js asserts it.
    T = {
      ink1: css("--ink"), ink2: css("--ink-2"), muted: css("--ink-3"),
      grid: css("--hair"), axis: css("--hair"), hair: css("--hair"),
      sheet: css("--sheet"), surface: css("--sheet"), sans: css("--font-sans"),
      series: css("--series"), whisker: css("--whisker"), seal: css("--seal"),
      ramp: [css("--r100"), css("--r300"), css("--r500"), css("--r700")],
    };
    return T;
  }

  const tokens = () => T;

  root.MD = root.MD || {};
  root.MD.charts = { readTokens, tokens };
})(window);
