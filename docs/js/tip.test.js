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

/* ---- the keyboard cursor ---- */

function fakeDoc() {
  const listeners = {};
  const mark = (label) => ({
    _attrs: { "data-tip-label": label, "data-tip-value": "v" + label },
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    setAttribute(k, v) { this._attrs[k] = v; },
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 8, height: 8 }),
  });
  const marks = [mark("A"), mark("B"), mark("C")];
  const host = {
    _attrs: {}, _blurred: false,
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; },
    setAttribute(k, v) { this._attrs[k] = v; },
    querySelectorAll: () => marks,
    querySelector: () => null,
    blur() { this._blurred = true; },
    closest: () => host,
  };
  return {
    host, marks, listeners,
    querySelectorAll: () => [host],
    querySelector: () => null,
    addEventListener: (t, fn) => { (listeners[t] || (listeners[t] = [])).push(fn); },
    documentElement: { clientWidth: 1000, clientHeight: 800 },
  };
}

test("initCursor makes each chart ONE tab stop, not one per mark", () => {
  /* ~400 marks on this page. Tabbing through 60 scatter bubbles to reach the
     footer would be hostile, which is why the host takes the tabindex. */
  const d = fakeDoc();
  const n = global.window.MD.tip.initCursor(d);
  assert.equal(n, 1, "expected one host wired");
  assert.equal(d.host.getAttribute("tabindex"), "0");
  assert.equal(d.host.getAttribute("role"), "group");
  for (const m of d.marks) {
    assert.equal(m.getAttribute("tabindex"), null, "a mark must not be its own tab stop");
  }
});

test("the host announces which keys do what", () => {
  // A focus ring that says nothing leaves a keyboard user guessing.
  const d = fakeDoc();
  global.window.MD.tip.initCursor(d);
  assert.match(d.host.getAttribute("aria-description") || "", /arrow key/i);
  assert.ok(d.host.getAttribute("aria-label"), "the host needs a name as well as a hint");
});

test("arrow keys are handled and other keys are left alone", () => {
  const d = fakeDoc();
  global.window.MD.tip.initCursor(d);
  const onKey = d.listeners.keydown[0];
  const press = (key) => {
    let prevented = false;
    onKey({ key, target: d.host, preventDefault: () => { prevented = true; } });
    return prevented;
  };
  for (const k of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End", "Escape"]) {
    assert.equal(press(k), true, `${k} should be handled`);
  }
  for (const k of ["Tab", "a", "/", "Enter"]) {
    assert.equal(press(k), false, `${k} must keep its normal behaviour`);
  }
});

test("Escape releases the chart", () => {
  const d = fakeDoc();
  global.window.MD.tip.initCursor(d);
  const onKey = d.listeners.keydown[0];
  onKey({ key: "ArrowRight", target: d.host, preventDefault() {} });
  onKey({ key: "Escape", target: d.host, preventDefault() {} });
  assert.equal(d.host._blurred, true, "Escape must hand focus back to the page");
});

test("marksOf reads the marks live, never from a cached list", () => {
  /* Panels re-render on every filter change and on resize, replacing the svg
     wholesale. A list captured at wiring time would describe deleted nodes. */
  const d = fakeDoc();
  assert.equal(global.window.MD.tip.marksOf(d.host).length, 3);
  d.marks.push({ getAttribute: () => "D", getBoundingClientRect: () => ({}) });
  assert.equal(global.window.MD.tip.marksOf(d.host).length, 4);
});

