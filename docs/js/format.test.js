// Run: node --test docs/js/
// Classic script, not a module, so load it by evaluating into a fake global.
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

global.window = {};
eval(fs.readFileSync(path.join(__dirname, "format.js"), "utf8"));
const F = global.window.MD.format;

test("money abbreviates by magnitude", () => {
  assert.equal(F.money(1234), "$1.2K");
  assert.equal(F.money(1234567), "$1.2M");
  assert.equal(F.money(93719556238.83), "$93.72B");
  assert.equal(F.money(-2901607401), "-$2.90B");
  assert.equal(F.money(12.5), "$12.50");
});

test("money renders an em dash for absent values", () => {
  assert.equal(F.money(null), "—");
  assert.equal(F.money(undefined), "—");
  assert.equal(F.money(NaN), "—");
  assert.equal(F.money(Infinity), "—");
});

test("count groups thousands and drops decimals", () => {
  assert.equal(F.count(1175213), "1,175,213");
  assert.equal(F.count(0), "0");
  assert.equal(F.count(null), "—");
});

test("pct scales by 100 with configurable precision", () => {
  assert.equal(F.pct(0.489), "48.9%");
  assert.equal(F.pct(0.000962, 3), "0.096%");
  assert.equal(F.pct(null), "—");
});

test("quantile indexes a pre-sorted array and clamps at the ends", () => {
  const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(F.quantile(xs, 0), 1);
  assert.equal(F.quantile(xs, 1), 10);
  assert.equal(F.quantile([], 0.5), 0);
});

test("money honours its digits argument below 1000, not just above", () => {
  // The final branch used to hardcode toFixed(2), so an axis passing 0 still got
  // "$200.00". That reached three axes before anyone noticed.
  assert.equal(F.money(200, 0), "$200");
  assert.equal(F.money(0, 0), "$0");
  assert.equal(F.money(503.53, 0), "$504");
  assert.equal(F.money(12.5, 1), "$12.5");
  // The default is unchanged.
  assert.equal(F.money(12.5), "$12.50");
});
