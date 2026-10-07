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

test("dot(filled:false) is a sheet interior inside a series stroke", () => {
  // This is the contrast mechanism: a hollow mark's outline carries 4.03:1
  // whatever sits behind its interior, which is what makes hollow/filled a legal
  // encoding channel where a second hue would not be.
  const hollow = S.dot(10, 20, 4, { filled: false, series: "#2a78d6", sheet: "#f5f4f6" });
  assert.match(hollow, /fill="#f5f4f6"/);
  assert.match(hollow, /stroke="#2a78d6"/);
  const solid = S.dot(10, 20, 4, { filled: true, series: "#2a78d6", sheet: "#f5f4f6" });
  assert.match(solid, /fill="#2a78d6"/);
});

test("dot carries its tooltip text as both data-tip and a <title>", () => {
  // data-tip drives the shared hover tip; <title> is the screen-reader and
  // touch fallback, which is what the choropleth already relies on.
  const d = S.dot(1, 2, 3, { filled: true, series: "#000", sheet: "#fff",
                             tip: "Obstetrics & Gynecology" });
  assert.match(d, /data-tip="Obstetrics &amp; Gynecology"/);
  assert.match(d, /<title>Obstetrics &amp; Gynecology<\/title>/);
});

test("an absent, null or empty tip emits no attributes at all", () => {
  // An empty <title> is an empty announcement, which is worse than none.
  for (const tip of [undefined, null, ""]) {
    const d = S.dot(1, 2, 3, { filled: true, series: "#000", sheet: "#fff", tip });
    assert.ok(!d.includes("data-tip"), `tip=${JSON.stringify(tip)} produced data-tip`);
    assert.ok(!d.includes("<title>"), `tip=${JSON.stringify(tip)} produced a <title>`);
  }
});

test("rule draws a horizontal hairline at the given y", () => {
  const r = S.rule(0, 300, 40, { stroke: "#c9c7c4" });
  assert.match(r, /x1="0"/);
  assert.match(r, /x2="300"/);
  assert.match(r, /y1="40"/);
  assert.match(r, /y2="40"/);
});

test("dumbbell puts --whisker on the B end inside a --series stroke", () => {
  /* The compliance mechanism: the lighter cohort reads lighter WITHOUT a second hue,
     because its --whisker fill sits inside the same --series stroke. Greping for the
     whisker colour anywhere in the string passes with the mechanism dismantled --
     three separate mutations proved that. Pin which END carries which fill. */
  const d = S.dumbbell(10, 90, 50, { series: "#2a78d6", sheet: "#f5f4f6",
                                     whisker: "#86b6ef" });
  const circles = [...d.matchAll(/<circle[^>]*\/>/g)].map((m) => m[0]);
  assert.equal(circles.length, 2, "exactly two dots");
  const bEnd = circles.find((c) => /cx="90"/.test(c));
  const aEnd = circles.find((c) => /cx="10"/.test(c));
  assert.ok(bEnd && aEnd, `both ends must be drawn: ${circles.join(" ")}`);
  assert.match(bEnd, /fill="#86b6ef"/, "B is the smaller cohort: --whisker fill");
  assert.match(bEnd, /stroke="#2a78d6"/, "and it keeps the --series stroke");
  assert.match(aEnd, /fill="#2a78d6"/, "A is solid --series");
  const line = d.match(/<line[^>]*\/>/)[0];
  assert.match(line, /stroke="#2a78d6"/, "the connector is --series");
  assert.ok(!/#86b6ef/.test(line), "the connector must not carry the whisker colour");
});

test("pathLine emits one move and the rest lineto, and nothing for empty input", () => {
  const p = S.pathLine([[0, 0], [10, 5], [20, 2]], { stroke: "#2a78d6" });
  assert.match(p, /d="M0,0L10,5L20,2"/);
  assert.equal(S.pathLine([], { stroke: "#000" }), "",
    "no points means no path element at all, not an empty d=''");
});

test("pathLine takes an explicit dash for a reference line", () => {
  const p = S.pathLine([[0, 0], [1, 1]], { stroke: "#6b6d72", dash: "5 4" });
  assert.match(p, /stroke-dasharray="5 4"/);
});

test("bubble keeps an explicit stroke, which is its compliance mechanism", () => {
  // hero 5's fill is --series at 69% alpha, which is 2.53:1 on its own. The 1px
  // border is what makes the mark legal, so it is not optional.
  const b = S.bubble(5, 6, 12, { fill: "#2a78d6b0", stroke: "#2a78d6" });
  assert.match(b, /r="12"/);
  assert.match(b, /stroke="#2a78d6"/);
  assert.match(b, /stroke-width="1"/);
});

test("bubble and dumbbell carry their tip the same way dot does", () => {
  const b = S.bubble(1, 2, 3, { fill: "#000", stroke: "#000", tip: "B & C" });
  assert.match(b, /data-tip="B &amp; C"/);
  assert.match(b, /<title>B &amp; C<\/title>/);
  const d = S.dumbbell(1, 9, 5,
    { series: "#000", sheet: "#fff", whisker: "#888", tip: "D & E" });
  assert.match(d, /data-tip="D &amp; E"/);
  assert.match(d, /<title>D &amp; E<\/title>/);
});

test("every mark rounds its coordinates and honours its size options", () => {
  const long = /\d\.\d{3,}/;
  const o = { series: "#000", sheet: "#fff", whisker: "#888", filled: true,
              fill: "#000", stroke: "#000" };
  assert.ok(!long.test(S.dot(10.123456, 20.987654, 4, o)), "dot");
  assert.ok(!long.test(S.rule(1.123456, 9.987654, 5.555555, { stroke: "#000" })), "rule");
  assert.ok(!long.test(S.bubble(1.123456, 2.987654, 3.555555, o)), "bubble");
  assert.ok(!long.test(S.pathLine([[1.123456, 2.987654]], { stroke: "#000" })), "pathLine");
  assert.ok(!long.test(S.dumbbell(1.123456, 9.987654, 5.555555, o)), "dumbbell");
  // The size options must actually reach the markup, not be silently dropped.
  assert.match(S.dumbbell(1, 9, 5, Object.assign({}, o, { r: 7 })), /r="7"/);
  assert.match(S.rule(0, 10, 5, { stroke: "#000", width: 3 }), /stroke-width="3"/);
  assert.match(S.pathLine([[0, 0], [1, 1]], { stroke: "#000", width: 2.5 }),
    /stroke-width="2.5"/);
});

test("axisBottom labels every tick the scale reaches", () => {
  const x = S.scaleLinear([0, 100], [0, 400]);
  const a = S.axisBottom(x, 200, (v) => v + "%", { axis: "#c9c7c4", muted: "#6b6d72" });
  for (const t of [0, 50, 100]) {
    assert.ok(a.includes(">" + t + "%<"), `tick ${t} missing from the axis`);
  }
});

test("axisBottom skips any tick whose pixel falls outside the drawing", () => {
  /* The old Chart.js axis-label bug in its new form. A scale's own ticks() never
     leaves its domain, so this guard is unreachable through niceTicks -- the test has
     to hand it out-of-range ticks directly. Verified: without that, deleting the
     guard left the entire suite green. */
  const x = S.scaleLinear([0, 100], [0, 400]);
  x.ticks = () => [-50, 0, 50, 500];
  const a = S.axisBottom(x, 200, String, { axis: "#c9c7c4", muted: "#6b6d72" });
  assert.ok(a.includes(">0<"), "an in-range tick must be labelled");
  assert.ok(a.includes(">50<"), "an in-range tick must be labelled");
  assert.ok(!a.includes(">-50<"), "a tick below the range must be skipped");
  assert.ok(!a.includes(">500<"), "a tick above the range must be skipped");
});

test("zeroRule draws when the domain spans zero", () => {
  const x = S.scaleLinear([-50, 100], [0, 300]);
  const z = S.zeroRule(x, 0, 200, { ink: "#16181a" });
  assert.match(z, /<line/);
  assert.match(z, /stroke="#16181a"/);
});

test("zeroRule draws NOTHING when zero is outside the domain", () => {
  // Review Focus 3. An all-positive filter has no zero to mark. Clamping the rule
  // to the axis edge would draw a datum line where no datum exists.
  const pos = S.scaleLinear([10, 100], [0, 300]);
  assert.equal(S.zeroRule(pos, 0, 200, { ink: "#16181a" }), "");
  const neg = S.scaleLinear([-100, -10], [0, 300]);
  assert.equal(S.zeroRule(neg, 0, 200, { ink: "#16181a" }), "");
});

test("labelWidth reserves room from the LONGEST label, wherever it sits", () => {
  // With the long label last, a use-the-last-label mutation also passes. Put it in
  // the middle so only a real max works.
  const narrow = S.labelWidth(["AK", "CA", "NY"], 10.5);
  const wide = S.labelWidth(["AK", "Physical Therapist in Private Practice", "NY"], 10.5);
  assert.ok(wide > narrow * 3, `the long label must dominate: ${narrow} vs ${wide}`);
  assert.equal(S.labelWidth(["AK", undefined, "NY"], 10.5),
               S.labelWidth(["AK", "NY"], 10.5),
               'undefined must count as empty, not as the 9 characters of "undefined"');
});

test("axisLeft escapes free-text category labels", () => {
  const band = S.scaleBand(["Obstetrics & Gynecology"], [0, 100], 0);
  const a = S.axisLeft(["Obstetrics & Gynecology"], band, 120, { muted: "#6b6d72" });
  assert.match(a, /Obstetrics &amp; Gynecology/);
  assert.ok(!/Obstetrics & Gyn/.test(a), "a raw ampersand would stop the parser");
});

test("axisLeft emphasises the matching label and only that one", () => {
  // Checking that both inks appear somewhere passes with the predicate inverted.
  const labels = ["a", "b"];
  const band = S.scaleBand(labels, [0, 100], 0);
  const a = S.axisLeft(labels, band, 50, {
    muted: "#6b6d72", ink: "#16181a", emphasis: (l) => l === "b",
  });
  assert.match(a, /fill="#16181a">b</, "the matching label takes full ink");
  assert.match(a, /fill="#6b6d72">a</, "every other label stays muted");
});

test("frame wraps a viewBox with a role and an aria-label", () => {
  const f = S.frame(400, 200, "<circle/>", { aria: "Payments by drug code" });
  assert.match(f, /viewBox="0 0 400 200"/);
  assert.match(f, /role="img"/);
  assert.match(f, /aria-label="Payments by drug code"/);
  assert.match(f, /<circle\/>/);
});

test("frame returns an empty string for an empty body", () => {
  // Review Focus 1: a zero-row cohort must not produce a labelled empty frame
  // that reads as "no data here" when the honest answer belongs in prose.
  assert.equal(S.frame(400, 200, "", { aria: "x" }), "");
});

test("frame escapes its aria-label, which carries free-text specialty names", () => {
  const f = S.frame(100, 50, "<circle/>", { aria: 'Obstetrics & Gynecology "x"' });
  assert.match(f, /aria-label="Obstetrics &amp; Gynecology &quot;x&quot;"/);
});

/* ── dotPlot ─────────────────────────────────────────────────────────────────
   The shared renderer behind six of the eight converted charts. A pure string
   builder: tokens arrive in spec.t, so there is nothing to stub. */
const TK = { hair: "#c9c7c4", series: "#2a78d6", sheet: "#f5f4f6", ink1: "#16181a",
             ink2: "#4f5156", muted: "#6b6d72", axis: "#c9c7c4", seal: "#dcddf3",
             whisker: "#86b6ef", sans: "sans-serif" };

test("dotPlot draws one dot and one hairline per row", () => {
  const rows = [{ k: "J0178", v: 100 }, { k: "J9271", v: 50 }];
  const out = S.dotPlot({
    t: TK, rows, label: (r) => r.k, value: (r) => r.v,
    fmt: (v) => "$" + v, axisTitle: "Payment", aria: "test", tip: (r) => r.k,
  });
  assert.equal((out.match(/<circle/g) || []).length, 2, "one dot per row");
  assert.ok((out.match(/<line/g) || []).length >= 2, "one hairline per row");
  assert.match(out, /J0178/);
  assert.match(out, /J9271/);
});

test("dotPlot renders prose, not an empty chart, for a zero-row cohort", () => {
  // Review Focus 1. An axis with no marks looks like a broken chart; a sentence
  // saying nothing matched is the honest version.
  const out = S.dotPlot({
    t: TK, rows: [], label: (r) => r.k, value: (r) => r.v,
    fmt: String, axisTitle: "x", aria: "y", tip: String,
  });
  assert.ok(!out.includes("<svg"), "no frame should be drawn at all");
  assert.match(out, /class="empty"/, "an explained empty state is required");
});

test("dotPlot survives a single row without NaN coordinates", () => {
  // Review Focus 2: a one-cohort filter gives a zero-width value domain.
  const out = S.dotPlot({
    t: TK, rows: [{ k: "only", v: 42 }], label: (r) => r.k, value: (r) => r.v,
    fmt: String, axisTitle: "x", aria: "y", tip: (r) => r.k,
  });
  assert.ok(!out.includes("NaN"), `NaN leaked into the markup: ${out.slice(0, 200)}`);
  assert.equal((out.match(/<circle/g) || []).length, 1);
});

test("dotPlot with signed:true draws a zero rule and hollows the negatives", () => {
  const rows = [{ k: "up", v: 10 }, { k: "down", v: -10 }];
  const out = S.dotPlot({
    t: TK, rows, label: (r) => r.k, value: (r) => r.v, signed: true,
    fmt: String, axisTitle: "x", aria: "y", tip: (r) => r.k,
  });
  assert.match(out, /fill="#f5f4f6"/, "the negative row should be hollow");
  assert.match(out, /fill="#2a78d6"/, "the positive row should be filled");
});

test("dotPlot's filled predicate overrides the sign default", () => {
  // Hero 2 needs filled/hollow for RELIABILITY, not sign -- position across the
  // zero rule already carries sign, so the channel is free.
  const rows = [{ k: "thin", v: 10, ok: false }];
  const out = S.dotPlot({
    t: TK, rows, label: (r) => r.k, value: (r) => r.v, signed: true,
    filled: (r) => r.ok,
    fmt: String, axisTitle: "x", aria: "y", tip: (r) => r.k,
  });
  assert.ok(/fill="#f5f4f6"/.test(out),
    "a positive but unreliable row must still be hollow");
});

test("dotPlot escapes free-text labels and tips", () => {
  // Review Focus 5.
  const out = S.dotPlot({
    t: TK, rows: [{ k: "Obstetrics & Gynecology", v: 1 }],
    label: (r) => r.k, value: (r) => r.v,
    fmt: String, axisTitle: "x", aria: "y", tip: (r) => r.k,
  });
  assert.match(out, /Obstetrics &amp; Gynecology/);
  assert.ok(!/Obstetrics & Gyn/.test(out));
});

test("dotPlot draws rows top-to-bottom in the order given", () => {
  // Chart.js's indexAxis:"y" drew index 0 at the BOTTOM; scaleBand puts it at the
  // TOP. Every array inherited from Chart.js is therefore upside down until it is
  // re-sorted, and no other assertion can see it -- the markup is valid either way.
  const rows = [{ k: "top", v: 100 }, { k: "mid", v: 50 }, { k: "bot", v: 10 }];
  const out = S.dotPlot({
    t: TK, rows, label: (r) => r.k, value: (r) => r.v,
    fmt: String, axisTitle: "x", aria: "y", tip: (r) => r.k,
  });
  const ys = ["top", "mid", "bot"].map((k) => {
    const m = out.match(new RegExp(`<text x="[\\d.-]+" y="([\\d.-]+)"[^>]*>${k}<`));
    assert.ok(m, `label ${k} was not drawn`);
    return Number(m[1]);
  });
  assert.ok(ys[0] < ys[1] && ys[1] < ys[2],
    `rows must descend the page in array order, got y=${ys.join(", ")}`);
});

test("dotPlot clamps a zero or absurd width instead of collapsing", () => {
  // A host that is detached or display:none reports clientWidth 0. The frame must
  // still be drawable rather than collapsing to a zero-width viewBox.
  for (const width of [0, undefined, -50, 10]) {
    const out = S.dotPlot({
      t: TK, width, rows: [{ k: "a", v: 1 }],
      label: (r) => r.k, value: (r) => r.v,
      fmt: String, axisTitle: "x", aria: "y", tip: (r) => r.k,
    });
    const vb = out.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    assert.ok(vb, `no frame drawn for width=${width}`);
    assert.ok(Number(vb[1]) >= 320, `width=${width} gave viewBox width ${vb && vb[1]}`);
    assert.ok(!out.includes("NaN"), `width=${width} leaked NaN`);
  }
});

test("dotPlot's value column can be more precise than its axis ticks", () => {
  // money(v, 0) renders 2.35e9 and 1.86e9 both as "$2B". The dot's position carries
  // magnitude; this column is the only place the exact figure appears, so it must be
  // able to disagree with the tick format.
  const rows = [{ k: "a", v: 2354722302.4 }, { k: "b", v: 1860000000 }];
  const out = S.dotPlot({
    t: TK, rows, label: (r) => r.k, value: (r) => r.v,
    fmt: (v) => "$" + Math.round(v / 1e9) + "B",
    fmtValue: (v) => "$" + (v / 1e9).toFixed(2) + "B",
    axisTitle: "x", aria: "y", tip: (r) => r.k,
  });
  assert.ok(out.includes(">$2.35B<"), "the precise value must appear");
  assert.ok(out.includes(">$1.86B<"), "both rows must be distinguishable");
});

test("dotPlot falls back to fmt when no fmtValue is given", () => {
  const out = S.dotPlot({
    t: TK, rows: [{ k: "a", v: 5 }], label: (r) => r.k, value: (r) => r.v,
    fmt: (v) => v + "u", axisTitle: "x", aria: "y", tip: (r) => r.k,
  });
  assert.ok(out.includes(">5u<"), "fmt must still drive the value column by default");
});
