/* Run: node --test docs/js/*.test.js

   place() is the part worth pinning without a browser: it decides whether the tip
   covers the mark it describes. The listener wiring is verified in the browser,
   because that is the only place it can be -- the suite cannot see a missing
   handler, which is exactly how this layer shipped half-built in the first place. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

global.window = {};
eval(fs.readFileSync(path.join(__dirname, "tip.js"), "utf8"));
const place = global.window.MD.tip.place;

const VW = 1000, VH = 800;
const TIP = { w: 200, h: 80 };

test("the tip sits below-right of the cursor when there is room", () => {
  const p = place(100, 100, TIP.w, TIP.h, VW, VH);
  assert.equal(p.left, 114, "14px clear of the cursor");
  assert.equal(p.top, 114);
});

test("near the right edge the tip flips to the cursor's left, never off-screen", () => {
  const p = place(950, 100, TIP.w, TIP.h, VW, VH);
  // Sliding along the edge would park the tip on top of the mark it describes.
  assert.equal(p.left, 950 - 14 - TIP.w, "flipped, not slid");
  assert.ok(p.left + TIP.w <= VW, "stays inside the viewport");
});

test("near the bottom edge the tip flips above the cursor", () => {
  const p = place(100, 780, TIP.w, TIP.h, VW, VH);
  assert.equal(p.top, 780 - 14 - TIP.h);
  assert.ok(p.top + TIP.h <= VH);
});

test("in a corner the tip flips on both axes at once", () => {
  const p = place(980, 790, TIP.w, TIP.h, VW, VH);
  assert.ok(p.left + TIP.w <= VW && p.top + TIP.h <= VH,
    `corner tip escaped the viewport: ${JSON.stringify(p)}`);
  assert.ok(p.left < 980 && p.top < 790, "flipped to the up-left quadrant");
});

test("a tip too large to flip is clamped inside the viewport, not pushed negative", () => {
  // A long note on a narrow phone: both the preferred and the flipped position
  // overflow. A negative left would clip the label, which is the only part that
  // says what you are looking at.
  const p = place(20, 20, 380, 300, 400, 320);
  assert.ok(p.left >= 8 && p.top >= 8, `clamped to the edge gutter: ${JSON.stringify(p)}`);
});

test("place is pure -- the same inputs give the same answer", () => {
  const a = place(300, 300, TIP.w, TIP.h, VW, VH);
  const b = place(300, 300, TIP.w, TIP.h, VW, VH);
  assert.deepEqual(a, b);
});

test("tip.js exports init and place, and defines exactly one tip element class", () => {
  // init is what index.html and explore.html rely on being present; place is tested
  // above. A rename of either is a silent no-op at runtime.
  assert.equal(typeof global.window.MD.tip.init, "function");
  assert.equal(typeof place, "function");
  const src = fs.readFileSync(path.join(__dirname, "tip.js"), "utf8");
  assert.match(src, /className = "tip"/, "the CSS in dash.css styles .tip");
});
