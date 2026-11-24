/* Run: node --test docs/js/*.test.js

   The scroll-spy's geometry needs a real viewport, so it is verified in the
   browser. mark() is the part that decides what the nav CLAIMS, and it is pure
   enough to pin here. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

global.window = {};
eval(fs.readFileSync(path.join(__dirname, "nav.js"), "utf8"));
const N = global.window.MD.nav;

const link = () => {
  const attrs = {};
  return {
    attrs,
    setAttribute: (k, v) => { attrs[k] = v; },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
  };
};

test("mark leaves exactly one link current", () => {
  const links = [link(), link(), link()];
  N.mark(links, links[1]);
  assert.deepEqual(links.map((a) => a.getAttribute("aria-current")),
    ["false", "true", "false"]);
});

test("marking a second link releases the first", () => {
  // The bug this file exists for: aria-current="true" was hardcoded on Geography
  // and nothing ever moved it, so the nav reported the wrong section forever.
  const links = [link(), link(), link()];
  N.mark(links, links[0]);
  N.mark(links, links[2]);
  const current = links.filter((a) => a.getAttribute("aria-current") === "true");
  assert.equal(current.length, 1, "two links claimed to be current at once");
  assert.equal(current[0], links[2]);
});

test("every link carries the attribute explicitly, never absent", () => {
  /* dash.css matches [aria-current="true"], so "false" is inert. Setting it
     explicitly on the others says a value was considered; leaving the attribute
     off would also work but reads as an oversight. */
  const links = [link(), link()];
  N.mark(links, links[0]);
  for (const a of links) assert.ok(a.getAttribute("aria-current") !== null);
});

test("the stylesheet matches the VALUE, not the attribute's presence", () => {
  /* A bare [aria-current] selector paints aria-current="false" as the active
     section -- every link dark at once. The rule must name "true". */
  const css = fs.readFileSync(path.join(__dirname, "..", "css", "dash.css"), "utf8");
  const navRules = css.split("\n").filter((l) => /\.nav a\[aria-current/.test(l));
  assert.ok(navRules.length, "no .nav aria-current rule found at all");
  for (const r of navRules) {
    assert.match(r, /aria-current="true"/,
      `a presence selector would style inactive links as current: ${r.trim()}`);
  }
});
