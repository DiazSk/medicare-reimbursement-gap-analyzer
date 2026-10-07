// Run: node --test docs/js/*.test.js
/* Render tests for the two charts that build their own SVG inline: cLorenz (hero 3)
   and cSite (hero 5). They take no spec object, so nothing else in the suite executes
   them -- and a transposed axis here does not draw a broken chart, it draws a clean
   one asserting the OPPOSITE of the finding under it: bubbles reflected across the
   diagonal, a Lorenz curve bowing above equality, or y plotted against y (a perfect
   diagonal, the picture of Gini 0, under a headline about extreme concentration).

   Run through the real panels.js against the real docs/data.json, with only the DOM
   stubbed: getElementById hands back a recorder with a clientWidth, and
   getComputedStyle supplies the tokens. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const hosts = {};
const host = (id) => hosts[id] || (hosts[id] = { id, clientWidth: 606, innerHTML: "", textContent: "" });
global.document = { getElementById: host, documentElement: {} };
const TOK = { "--series": "#2a78d6", "--ink-3": "#6b6d72", "--hair": "#c9c7c4", "--sheet": "#f5f4f6" };
global.getComputedStyle = () => ({ getPropertyValue: (k) => TOK[k] || "#000000" });
global.window = {};
global.Chart = { defaults: { font: {}, animation: false, maintainAspectRatio: false,
                             plugins: { title: {} } } };
for (const f of ["format.js", "guardrails.js", "charts.js", "svg.js", "panels.js"]) {
  eval(fs.readFileSync(path.join(__dirname, f), "utf8"));
}
global.window.MD.charts.readTokens();
const P = global.window.MD.panels;
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data.json"), "utf8"));
const view = {
  geo: DATA.geo, nonpar: DATA.nonpar, nonparStats: DATA.nonpar_stats, lorenz: DATA.lorenz,
  jcodeTop: DATA.jcode_top, credentials: DATA.credentials,
  credentialTiers: DATA.credential_tiers, siteScatter: DATA.site_scatter,
  siteBarPos: DATA.site_bar_pos, siteBarNeg: DATA.site_bar_neg, siteStats: DATA.site_stats,
  providers: DATA.providers, kpi: DATA.kpi,
};
P.renderHero3(view);
P.renderHero5(view);
const lorenz = hosts.cLorenz.innerHTML;
const site = hosts.cSite.innerHTML;

const num = (s, k) => Number(new RegExp(`\\b${k}="([^"]+)"`).exec(s)[1]);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) <= 0.011, `${msg}: ${a} vs ${b}`);

// Geometry from the task brief; the host is 606px wide.
const W = 606;
const L = { H: 360, padL: 54, padR: 10, padT: 10, padB: 42 };
const lx = (v) => L.padL + v * (W - L.padR - L.padL);
const ly = (v) => (L.H - L.padB) - v * (L.H - L.padB - L.padT);
const S5 = { H: 430, padL: 62, padR: 12, padT: 10, padB: 44 };

const site5 = (() => {
  const rows = view.siteScatter.filter((d) => d.f_pymt !== null && d.o_pymt !== null);
  const lim = Math.max(...rows.flatMap((d) => [d.f_pymt, d.o_pymt])) * 1.05;
  return {
    rows,
    maxV: Math.max(...rows.map((d) => d.f_svcs || 0)),
    sx: (v) => S5.padL + (v / lim) * (W - S5.padR - S5.padL),
    sy: (v) => (S5.H - S5.padB) - (v / lim) * (S5.H - S5.padB - S5.padT),
  };
})();

function paths(html) {
  return [...html.matchAll(/<path d="([^"]+)"[^>]*>/g)].map((m) => ({
    tag: m[0],
    pts: m[1].match(/[ML]-?[\d.]+,-?[\d.]+/g).map((p) => p.slice(1).split(",").map(Number)),
  }));
}

test("cLorenz draws the real payload's curve, ascending, from the lower-left corner", () => {
  assert.match(lorenz, /viewBox="0 0 606 360"/);
  const [curve] = paths(lorenz).filter((p) => !p.tag.includes("stroke-dasharray"));
  assert.equal(curve.pts.length, DATA.lorenz.length);
  DATA.lorenz.forEach((p, i) => {
    near(curve.pts[i][0], lx(p.x), `point ${i} x`);
    near(curve.pts[i][1], ly(p.y), `point ${i} y`);
  });
  // Endpoints are the corners: (0,0) at the bottom-left, (1,1) at the top-right.
  near(curve.pts[0][1], ly(0), "curve starts on the baseline");
  near(curve.pts[curve.pts.length - 1][0], lx(1), "curve ends at the right edge");
  near(curve.pts[curve.pts.length - 1][1], ly(1), "curve ends at the top");
});

test("cLorenz stays at or below the equality diagonal, and well below it mid-curve", () => {
  const [curve] = paths(lorenz).filter((p) => !p.tag.includes("stroke-dasharray"));
  // SVG y grows downward, so "below the diagonal" is a LARGER y than the diagonal's.
  const diag = (px) => ly((px - lx(0)) / (lx(1) - lx(0)));
  for (const [px, py] of curve.pts) {
    assert.ok(py >= diag(px) - 0.011, `curve above the diagonal at x=${px}: ${py} < ${diag(px)}`);
  }
  // Gini 0.906: at the median the poorest half holds almost nothing. A curve plotted
  // against itself would sit ON the diagonal and pass the loop above.
  const mid = curve.pts.reduce((b, p) => Math.abs(p[0] - lx(0.5)) < Math.abs(b[0] - lx(0.5)) ? p : b);
  assert.ok(mid[1] - diag(mid[0]) > 100, `the curve is not bowed below the diagonal: ${mid[1] - diag(mid[0])}`);
});

test("cLorenz's reference diagonal is dashed, 1px, and corner to corner", () => {
  const dashed = paths(lorenz).filter((p) => p.tag.includes("stroke-dasharray"));
  assert.equal(dashed.length, 1);
  assert.match(dashed[0].tag, /stroke-width="1"/);
  assert.deepEqual(dashed[0].pts.map((p) => p.map(Math.round)),
                   [[lx(0), ly(0)], [lx(1), ly(1)]].map((p) => p.map(Math.round)));
});

test("cLorenz puts its x axis on the baseline, below the plot", () => {
  const m = /<text x="([\d.]+)" y="([\d.]+)" text-anchor="middle"[^>]*>0%</.exec(lorenz);
  assert.ok(m, "no x-axis 0% label");
  near(Number(m[2]), ly(0) + 14, "x tick labels sit 14px under the baseline");
});

test("cLorenz floors a collapsed host at 320px", () => {
  const h = host("cLorenz");
  h.clientWidth = 0;
  P.renderHero3(view);
  assert.match(h.innerHTML, /viewBox="0 0 520 360"/, "a 0-width host falls back to 520");
  h.clientWidth = 100;
  P.renderHero3(view);
  assert.match(h.innerHTML, /viewBox="0 0 320 360"/, "a narrow host floors at 320");
  h.clientWidth = 606;
  P.renderHero3(view);
});

test("cSite puts office payment on x and facility payment on y, sized by facility volume", () => {
  assert.match(site, /viewBox="0 0 606 430"/);
  const { rows, maxV, sx, sy } = site5;
  const circles = [...site.matchAll(/<circle [^>]*>/g)].map((m) => m[0]);
  assert.equal(circles.length, rows.length);
  assert.ok(rows.some((d) => Math.abs(d.f_pymt - d.o_pymt) > 1),
            "payload has no asymmetric row, so a transposed axis would be invisible");
  rows.forEach((d, i) => {
    near(num(circles[i], "cx"), sx(d.o_pymt), `${d.hcpcs} cx (office payment)`);
    near(num(circles[i], "cy"), sy(d.f_pymt), `${d.hcpcs} cy (facility payment)`);
    near(num(circles[i], "r"), 4 + 14 * Math.sqrt((d.f_svcs || 0) / maxV), `${d.hcpcs} radius`);
    assert.match(circles[i], /stroke="#2a78d6"/, `${d.hcpcs} lost its 1px border`);
  });
});

test("cSite's grid rules are horizontal and its diagonal runs corner to corner", () => {
  const lines = [...site.matchAll(/<line [^>]*>/g)].map((m) => m[0]);
  assert.ok(lines.length >= 3);
  for (const l of lines) assert.equal(num(l, "y1"), num(l, "y2"), `non-horizontal rule: ${l}`);
  // A rule at x(tick) is still horizontal, so also pin WHERE: one per y tick ($0, $200,
  // $400), plus the x axis on the baseline.
  const ys = [...new Set(lines.map((l) => num(l, "y1")))].sort((a, b) => b - a);
  assert.equal(ys.length, 3, `expected rules at 3 distinct heights, got ${ys}`);
  [0, 200, 400].forEach((v, i) => near(ys[i], site5.sy(v), `rule for $${v}`));
  const [diag] = paths(site);
  near(diag.pts[0][0], S5.padL, "diagonal starts at x = 0");
  near(diag.pts[0][1], S5.H - S5.padB, "diagonal starts at y = 0");
  near(diag.pts[1][0], W - S5.padR, "diagonal ends at x = lim");
  near(diag.pts[1][1], S5.padT, "diagonal ends at y = lim");
});

test("cSite's y tick labels are the y scale's own values", () => {
  // Dollar labels on the left gutter, in order, matching the x axis' dollars.
  const y = [...site.matchAll(/<text x="54" [^>]*text-anchor="end"[^>]*>([^<]+)</g)].map((m) => m[1]);
  const x = [...site.matchAll(/text-anchor="middle"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(y, x);
  assert.deepEqual(y, ["$0", "$200", "$400"]);
});

test("neither inline chart leaks NaN, Infinity or undefined into the markup", () => {
  for (const [name, html] of [["cLorenz", lorenz], ["cSite", site]]) {
    for (const bad of ["NaN", "Infinity", "undefined"]) {
      assert.ok(!html.includes(bad), `${name} contains ${bad}`);
    }
  }
});
