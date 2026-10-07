/* Markup contract. The restyle's highest-risk surface -- element ids, the class names
   JS writes, and the payload sentinels -- had zero test coverage, and two of its failure
   modes are silent:

     - Renaming an id leaves no JS error. getElementById returns null and the next
       property access throws inside a render function, which detach() swallows into a
       console.warn (index.html:268). The page renders its KPI ribbon and nothing else.
     - Renaming a class JS writes (panels.js emits "kpi", "l", "empty"; explore.js emits
       "toggle") leaves the element unstyled with no error at all.
     - explore.test.js stubs document.getElementById to return an object for ANY id, so
       it passes while production is broken. This file is the one that won't.

   The id list is derived from the source, not hardcoded: add a getElementById and this
   test demands the markup. */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const DOCS = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(DOCS, p), "utf8");

const index = read("index.html");
const explore = read("explore.html");
const css = read("css/dash.css");
const js = fs
  .readdirSync(path.join(DOCS, "js"))
  .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js") && f !== "chart.umd.min.js")
  .map((f) => read("js/" + f))
  .join("\n");

// Created at runtime inside #provPager, so they must NOT be in the static markup.
const RUNTIME_IDS = new Set(["pPrev", "pNext"]);

function referencedIds() {
  const ids = new Set();
  for (const src of [js, index]) {
    for (const m of src.matchAll(/getElementById\("([^"]+)"\)/g)) ids.add(m[1]);
    for (const m of src.matchAll(/\bmount\("([^"]+)"/g)) ids.add(m[1]);
  }
  return [...ids].sort();
}

const countId = (html, id) => (html.match(new RegExp(`id="${id}"`, "g")) || []).length;

test("every id the JS reads exists exactly once, in exactly one page", () => {
  const ids = referencedIds().filter((id) => !RUNTIME_IDS.has(id));
  assert.ok(ids.length > 40, `expected the full id contract, found only ${ids.length}`);
  for (const id of ids) {
    const a = countId(index, id);
    const b = countId(explore, id);
    assert.ok(a + b > 0, `id="${id}" is read by JS but present in neither page`);
    assert.ok(a <= 1, `id="${id}" appears ${a}x in index.html`);
    assert.ok(b <= 1, `id="${id}" appears ${b}x in explore.html`);
  }
});

test("ids created at runtime are not also in the static markup", () => {
  for (const id of RUNTIME_IDS) {
    assert.equal(countId(index, id), 0, `id="${id}" is written by JS; markup must not declare it`);
  }
});

test("ids used as CSS selectors in querySelectorAll still exist", () => {
  // panels.js:654 does querySelectorAll("#tProv th"); explore.js:404 the same for
  // "#sqlExamples button". These need the id AND the descendant element type.
  assert.equal(countId(index, "tProv"), 1);
  assert.match(index, /<table[^>]*id="tProv"/, "#tProv must stay a <table> -- the selector is '#tProv th'");
  assert.equal(countId(explore, "sqlExamples"), 1);
});

test("every class name JS writes has a rule in the stylesheet", () => {
  // panels.js emits kpi/label/value/note/l/empty/tile/sel/dim; explore.js emits toggle
  // and l. badge-reliability is static markup -- guardrails.js only toggles an attribute,
  // so a rename breaks it with no JS error whatsoever.
  for (const cls of ["toggle", "l", "empty", "kpi", "label", "value", "note",
                     "tile", "sel", "dim", "badge-reliability"]) {
    // Boundary-aware: a bare substring check passes for `.emptyX`, so renaming the rule
    // would slip through. (Found by mutation-testing this very assertion.)
    const rule = new RegExp("\\." + cls + "(?![\\w-])");
    assert.match(css, rule, `JS writes class "${cls}" but dash.css has no rule for it`);
  }
});

test("the reliability badge has no unqualified display declaration", () => {
  // guardrails.js:41 hides the badge with el.hidden, which relies on the UA
  // [hidden]{display:none} rule. Any `display` on the bare class outranks it and an
  // empty badge renders on every unfiltered load. Qualify it: :not([hidden]).
  const bare = css.match(/\.badge-reliability\s*\{[^}]*\}/g) || [];
  for (const rule of bare) {
    assert.ok(!/display\s*:/.test(rule),
      "`.badge-reliability` declares display, which defeats [hidden]; use .badge-reliability:not([hidden])");
  }
});

test("the payload sentinels are intact and correctly ordered", () => {
  // publish_dashboard.py splices between the FIRST DATA_START and the FIRST DATA_END,
  // so the payload <script> must stay above the boot script's own .replace() calls.
  assert.equal((index.match(/\/\*DATA_START\*\//g) || []).length, 2);
  assert.equal((index.match(/\/\*DATA_END\*\//g) || []).length, 2);
  const s1 = index.indexOf("/*DATA_START*/");
  const e1 = index.indexOf("/*DATA_END*/");
  const s2 = index.indexOf("/*DATA_START*/", s1 + 1);
  assert.ok(s1 < e1 && e1 < s2, "payload script must precede the boot script's sentinel copies");
});

test("the payload stays on one unreflowed line", () => {
  // A formatter reflowing this line breaks the publish step. Asserting a length would
  // be a false tripwire -- publish_dashboard.py legitimately changes it -- so assert
  // the shape instead: exactly one very long line, and it is the payload tag.
  const long = index.split("\n").filter((l) => l.length > 50000);
  assert.equal(long.length, 1, `expected 1 payload line, found ${long.length}`);
  assert.match(long[0], /^<script id="payload"/, "the long line must be the payload script tag");
});

test("every token declared on :root is consumed somewhere", () => {
  // Dead token config is how a palette drifts out of sync with the page: a renamed
  // token leaves its old declaration behind, still looking authoritative. This also
  // catches the inverse of the `missing token` case -- a var() whose declaration was
  // deleted resolves to nothing and the property silently falls back.
  const root = css.slice(css.indexOf(":root {"), css.indexOf("* { box-sizing"));
  const declared = [...root.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);
  assert.ok(declared.length > 15, `expected the full token block, found ${declared.length}`);

  const all = [index, explore, css, js].join("\n");
  for (const t of declared) {
    assert.ok(all.includes(`var(${t})`) || all.includes(`css("${t}")`),
      `token ${t} is declared on :root but nothing reads it`);
  }
});

test("every token read by JS is declared", () => {
  const read = [...js.matchAll(/css\("(--[a-z0-9-]+)"\)/g)].map((m) => m[1]);
  assert.ok(read.length > 10, `expected the readTokens() set, found ${read.length}`);
  for (const t of read) {
    assert.match(css, new RegExp("\\" + t + "\\s*:"),
      `charts.js reads ${t} but dash.css never declares it -- getPropertyValue returns ""`);
  }
});

test("the colour tokens JS reads are 6-digit hex literals", () => {
  // format.js's hex2rgb parses 3- or 6-digit hex only, and panels.js concatenates an
  // alpha suffix onto --series as a string. An oklch(), rgb() or 8-digit value yields
  // rgb(NaN,NaN,NaN), which throws inside renderHero1, which detach() swallows into a
  // console.warn -- leaving the KPI ribbon rendered and every panel below it blank,
  // with nothing on screen saying so.
  const read = [...js.matchAll(/css\("(--[a-z0-9-]+)"\)/g)].map((m) => m[1])
    .filter((t) => !t.startsWith("--font-"));
  for (const t of read) {
    const m = css.match(new RegExp("\\" + t + "\\s*:\\s*([^;]+);"));
    assert.ok(m, `${t} is not declared`);
    assert.match(m[1].trim(), /^#[0-9a-fA-F]{6}$/,
      `${t} is "${m[1].trim()}" -- must stay a 6-digit hex literal or every panel below the KPI ribbon blanks silently`);
  }
});

test("no `background` shorthand on .plate", () => {
  // The four registration crosshairs are background-image LAYERS. The shorthand resets
  // background-image, so one `background:` in any .plate rule wipes all four with no
  // error -- which is why background-color is a longhand there.
  for (const m of css.matchAll(/\.plate[^{]*\{([^}]*)\}/g)) {
    assert.ok(!/(^|;)\s*background\s*:/.test(m[1]),
      "a `background` shorthand in a .plate rule wipes the registration crosshairs; use longhands");
  }
});
