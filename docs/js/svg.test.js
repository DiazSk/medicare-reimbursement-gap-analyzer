// Run: node --test docs/js/
// Classic script, not a module, so load it by evaluating into a fake global.
// svg.js is deliberately DOM-free: there is no `document` here at all, and that
// is the property that makes a hand-rolled chart layer testable.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

global.window = {};
eval(fs.readFileSync(path.join(__dirname, "svg.js"), "utf8"));
const S = global.window.MD.svg;

test("scaleLinear maps domain ends to range ends exactly", () => {
  const x = S.scaleLinear([0, 100], [0, 500]);
  assert.equal(x(0), 0);
  assert.equal(x(100), 500);
  assert.equal(x(50), 250);
});

test("scaleLinear on a zero-width domain returns the range midpoint, never NaN", () => {
  // Live mode reaches this by filtering to one state, or to a
  // cohort where every row carries the same value. A NaN here does not throw --
  // it produces d="MNaN,NaN" and the chart silently renders nothing at all.
  const x = S.scaleLinear([5, 5], [0, 100]);
  assert.equal(x(5), 50);
  assert.equal(x(0), 50);
  assert.equal(x(999), 50);
  assert.ok(Number.isFinite(x(5)), "a zero-width domain must still yield a finite px");
});

test("scaleLinear honours an inverted domain instead of silently swapping it", () => {
  const x = S.scaleLinear([10, 0], [0, 100]);
  assert.equal(x(10), 0);
  assert.equal(x(0), 100);
});

test("scaleLinear extrapolates outside the domain predictably", () => {
  // The choropleth's p95 bound depends on this: ~5% of states exceed it by
  // construction and must land past the end of the range, not clamp to it.
  const x = S.scaleLinear([0, 10], [0, 100]);
  assert.equal(x(20), 200);
  assert.equal(x(-5), -50);
});

test("scaleLog floors a non-positive domain at 1", () => {
  // log(0) is -Infinity and a cohort with zero non-participating providers is
  // ordinary data, so the floor is load-bearing. Asserted on .domain, because a
  // finiteness check alone passes with the floor removed.
  const x = S.scaleLog([0, 1000], [0, 300]);
  assert.equal(x.domain[0], 1, "a non-positive lower bound must be floored to 1");
  assert.equal(x(0), x(1), "0 and 1 must land on the same pixel");
  assert.equal(x(-5), x(1), "a negative count must land there too");
  assert.equal(Math.round(x(1)), 0);
  assert.equal(Math.round(x(1000)), 300);
  assert.equal(Math.round(x(10)), 100);
});

test("scaleLog on a zero-width domain returns the midpoint, like scaleLinear", () => {
  for (const d of [[0, 0], [5, 5]]) {
    const x = S.scaleLog(d, [0, 300]);
    assert.equal(x(d[0]), 150, `scaleLog([${d}]) must centre, not pin to the range start`);
    assert.equal(x(999), 150);
  }
  assert.deepEqual(S.scaleLog([5, 5], [0, 300]).ticks(), [5],
    "a flat log domain has one tick, not two indistinguishable ones");
});

test("scaleBand centres each band and reports a matching step", () => {
  const y = S.scaleBand(["a", "b", "c", "d"], [0, 400], 0);
  assert.equal(y.step, 100);
  assert.equal(y("a"), 50);
  assert.equal(y("d"), 350);
});

test("scaleBand handles a single label without dividing by zero", () => {
  // A one-row cohort.
  const y = S.scaleBand(["only"], [0, 200], 0);
  assert.equal(y.step, 200);
  assert.equal(y("only"), 100);
});

test("scaleBand returns the range midpoint for an unknown label", () => {
  const y = S.scaleBand(["a", "b"], [0, 100], 0);
  assert.ok(Number.isFinite(y("missing")), "an unknown label must not yield NaN");
});

test("niceTicks covers the domain without exceeding it", () => {
  const t = S.niceTicks(0, 100, 5);
  assert.ok(t.length >= 2, `expected at least 2 ticks, got ${t.length}`);
  assert.ok(t[0] >= 0 && t[t.length - 1] <= 100,
    `ticks ${t} must stay inside [0, 100]`);
  assert.deepEqual(t, [0, 50, 100]);
});

test("niceTicks returns at least two ticks even when the step overshoots", () => {
  // The 1-2-5 step can exceed the span: (0,3] with n=1 gives step 5, which
  // produces a single tick at 0 and an axis with one label.
  const t = S.niceTicks(0, 3, 1);
  assert.ok(t.length >= 2, `expected a fallback to the domain ends, got ${t}`);
});

test("niceTicks handles a degenerate and a reversed domain", () => {
  assert.deepEqual(S.niceTicks(7, 7, 5), [7]);
  assert.deepEqual(S.niceTicks(100, 0, 5), S.niceTicks(0, 100, 5));
  assert.deepEqual(S.niceTicks(NaN, 10, 5), []);
});

test("niceTicks yields an exact zero rather than a float residue", () => {
  // Verified to accumulate -5.551115123125783e-17 at the zero crossing without
  // the precision rounding, which money() renders as "-$0.00".
  const t = S.niceTicks(-0.7, 0.3, 10);
  const zero = t.find((v) => v === 0);
  assert.ok(Object.is(zero, 0), `expected an exact 0 among ${t}`);
  assert.ok(!t.some((v) => v !== 0 && Math.abs(v) < 1e-9), "no near-zero artefacts");
});

test("niceTicks carries no float accumulation artefacts", () => {
  for (const [lo, hi, n] of [[0, 1, 10], [2.06, 2.84, 5], [-0.7, 0.3, 10]]) {
    for (const v of S.niceTicks(lo, hi, n)) {
      assert.ok(!/\.\d{12,}/.test(String(v)),
        `tick ${v} from (${lo},${hi},${n}) carries accumulated error`);
    }
  }
});

test("esc neutralises the SVG-breaking characters in CMS free text", () => {
  // `desc` and `specialty` are free-text CMS fields and land in
  // <text> and <title>. One ampersand corrupts the whole document.
  assert.equal(S.esc("Obstetrics & Gynecology"), "Obstetrics &amp; Gynecology");
  assert.equal(S.esc('a<b>"c"'), "a&lt;b&gt;&quot;c&quot;");
  assert.equal(S.esc(null), "");
  assert.equal(S.esc(42), "42");
});
