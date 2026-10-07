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
const crypto = require("node:crypto");

const DOCS = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(DOCS, p), "utf8");

const index = read("index.html");
const explore = read("explore.html");
const css = read("css/dash.css");
const js = fs
  .readdirSync(path.join(DOCS, "js"))
  .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js"))
  .map((f) => read("js/" + f))
  .join("\n");

// Created at runtime inside #provPager, so they must NOT be in the static markup.
const RUNTIME_IDS = new Set(["pPrev", "pNext"]);

function referencedIds() {
  const ids = new Set();
  for (const src of [js, index]) {
    for (const m of src.matchAll(/getElementById\("([^"]+)"\)/g)) ids.add(m[1]);
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
  // tile/sel/dim went with the tile grid: the choropleth encodes selection on the SVG
  // path's own stroke, so no class is written for it. lk/lgroup are the legend keys.
  for (const cls of ["toggle", "l", "empty", "kpi", "label", "value", "note",
                     "lk", "lgroup", "badge-reliability", "figtitle"]) {
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
  // panels.js concatenates an alpha suffix onto --series as a STRING for hero 5's
  // bubbles (T().series + "b0"), and composes the choropleth's hatch patterns and the
  // heatmap's cell fills from these literals. A 3-digit, 8-digit, oklch() or rgb()
  // value produces something the SVG attribute cannot parse: the mark silently disappears, or
  // the throw lands inside a render function where detach() swallows it into a
  // console.warn, leaving the KPI ribbon up and every panel below it blank.
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

test("every name a module destructures from window.MD is actually exported", () => {
  /* This is the test that was missing when it mattered. panels.js referenced
     guardrails.patternPitch and charts.hatch while neither existed, and the whole suite
     passed 107/107 -- panels.test.js only exercises the DOM-free readouts, never a chart
     config. On the page it showed as the KPI ribbon rendering and every panel below it
     blank, because the TypeError landed inside a render function where detach() swallows
     it into a console.warn. Nothing on screen said anything was wrong.

     A static check is enough: the destructuring is top-level and literal in every
     module, and the export objects are literal too. */
  const files = fs.readdirSync(path.join(DOCS, "js"))
    .filter((f) => f.endsWith(".js") && !f.endsWith(".test.js")
                   && f !== "us-states.js");

  // module name -> the keys it puts on window.MD
  const exported = {};
  for (const f of files) {
    const src = read("js/" + f);
    const m = src.match(/root\.MD\.(\w+)\s*=\s*\{([^}]*)\}/);
    if (!m) continue;
    exported[m[1]] = m[2].split(",")
      .map((s) => s.split(":")[0].trim())
      .filter(Boolean);
  }
  assert.ok(Object.keys(exported).length >= 4,
    `expected several MD modules, found ${Object.keys(exported).join(", ")}`);

  let checked = 0;
  for (const f of files) {
    const src = read("js/" + f);
    // const { a, b } = root.MD.format;   /  = window.MD.charts;
    for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*(?:root|window)\.MD\.(\w+)\s*;/g)) {
      const [, names, mod] = m;
      assert.ok(exported[mod], `${f} destructures window.MD.${mod}, which no module exports`);
      for (const raw of names.split(",")) {
        const name = raw.split(":")[0].trim();
        if (!name) continue;
        checked++;
        assert.ok(exported[mod].includes(name),
          `${f} destructures "${name}" from MD.${mod}, which exports only: ${exported[mod].join(", ")}`);
      }
    }
  }
  assert.ok(checked > 5, `expected to check several imports, checked ${checked}`);
});

/* Every money( call whose LAST top-level argument is the literal 0 or 1. Written as a
   paren-balanced scan rather than a regex: the first argument can be any expression --
   money(Math.round(v), 0), money(d.pymt, 0), money(a[i] / 2, 1) -- and a regex that
   tries to match it either misses those or over-matches across calls. */
function zeroOrOneDigitMoney(src) {
  const hits = [];
  for (const m of src.matchAll(/\bmoney\(/g)) {
    let depth = 1, i = m.index + m[0].length, lastComma = -1;
    for (; i < src.length && depth > 0; i++) {
      const c = src[i];
      if (c === "(" || c === "[" || c === "{") depth++;
      else if (c === ")" || c === "]" || c === "}") depth--;
      else if (c === "," && depth === 1) lastComma = i;
    }
    if (lastComma < 0) continue;
    if (/^\s*[01]\s*$/.test(src.slice(lastComma + 1, i - 1))) hits.push(src.slice(m.index, i));
  }
  return hits;
}

test("no money() call in panels.js or explore.js passes a literal 0 or 1 digit count", () => {
  /* money(1.5e9, 0) renders "$2B" -- wrong by half a billion, and distinct from
     "$1B", so axisBottom's duplicate-label fallback never fires on it. Axes use
     moneyTick. Currency passes 2 (cents) or nothing, so 0 and 1 are never legitimate
     in either file (explore.js draws its own axis now). Only a source check notices a call site that was missed or reverted,
     which is why the token and sentinel guards above read the source too. */
  for (const f of ["js/panels.js", "js/explore.js"]) {
    assert.deepEqual(zeroOrOneDigitMoney(read(f)), [], f);
  }
});

test("the money-digits guard catches every spelling it exists for", () => {
  // The first version of this guard used /money\(\w+, *0\)/ and missed the last three.
  for (const bad of ["money(v, 0)", "money(tick, 0)", "money(Math.round(v), 0)",
                     "money(d.pymt, 0)", "money(a[i] / 2, 1)", "money( v ,0 )"]) {
    assert.equal(zeroOrOneDigitMoney(`x = ${bad};`).length, 1, bad);
  }
  for (const ok of ["money(v)", "money(v, 2)", "money(Math.abs(d.x), 2)", "money(f(0), 2)",
                    "moneyTick(v)"]) {
    assert.deepEqual(zeroOrOneDigitMoney(`x = ${ok};`), [], ok);
  }
});

test("every mountSvg chart is a <div> host, and no page draws on a <canvas>", () => {
  /* Derived from panels.js, not hardcoded: add a mountSvg call and this demands a
     <div> for it. Without this, putting the id back on a <canvas> passed the whole
     suite -- host.innerHTML on a canvas sets its never-rendered fallback content, so
     the panel is a blank box with no console error. */
  const ids = [...read("js/panels.js").matchAll(/\bmountSvg\("([^"]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 5, `expected the mountSvg ids, found ${ids.length}`);
  for (const id of new Set([...ids, "cLorenz", "cSite"])) {
    assert.match(index, new RegExp(`<div[^>]*\\bid="${id}"`), `#${id} must be a <div> in index.html`);
  }
  assert.equal(index.match(/<canvas/g), null, "index.html must have no <canvas");
  assert.equal(explore.match(/<canvas/g), null, "explore.html must have no <canvas");
  assert.match(explore, /<div[^>]*\bid="pChart"/, "#pChart must be a <div> in explore.html");
});

test("no page loads a charting library, and none is vendored", () => {
  // The other half of the canvas guard above. A leftover <script> for Chart.js would
  // still load and nothing would draw with it; a vendored copy would ship 200 KB dead.
  for (const [name, html] of [["index.html", index], ["explore.html", explore]]) {
    assert.ok(!/chart\.umd|chart\.min|\bChart\.js\b|cdn\.jsdelivr\.net\/npm\/chart/i.test(html),
      `${name} still references a charting library`);
  }
  const stray = fs.readdirSync(path.join(DOCS, "js")).filter((f) => /^chart[.-].*\.js$/i.test(f));
  assert.deepEqual(stray, [], "a chart*.js library is still vendored in docs/js");
});

/* Every <script src> and <link rel=stylesheet> that ships from this repo carries
   ?v=<first 8 of the file's sha256>. pipeline/stamp_assets.py writes them; this
   asserts they are current.

   Why it matters more here than on a typical static site: these are classic scripts
   sharing one global, and each module destructures names the others export. A browser
   holding a stale format.js beside a fresh explore.js does not degrade -- it throws
   "F(...).moneyTick is not a function" and renders nothing. GitHub Pages serves
   max-age=600, so a visit straddling a deploy lands in exactly that window.

   A hash nobody re-stamps is worse than no hash, because the tag then asserts a
   freshness that is not true. This test is what makes forgetting loud. */
const STAMPED = /<(?:script\s+src|link\s+rel="stylesheet"\s+href)="((?:js|css)\/[A-Za-z0-9._-]+)(\?v=([0-9a-f]+))?"/g;

test("every shipped asset tag carries a current content hash", () => {
  let checked = 0;
  for (const [name, html] of [["index.html", index], ["explore.html", explore]]) {
    for (const m of html.matchAll(STAMPED)) {
      const [, asset, query, got] = m;
      assert.ok(query, `${name}: <${asset}> has no ?v= stamp -- run python3 pipeline/stamp_assets.py`);
      const want = crypto.createHash("sha256")
        .update(fs.readFileSync(path.join(DOCS, asset))).digest("hex").slice(0, got.length);
      assert.equal(got, want,
        `${name}: ${asset} is stamped ?v=${got} but its content hashes to ${want}. ` +
        "The file changed without a re-stamp -- run: python3 pipeline/stamp_assets.py");
      checked++;
    }
  }
  assert.ok(checked >= 15, `expected both pages' asset tags, only found ${checked}`);
});

test("the same asset gets the same stamp on both pages", () => {
  // index.html and explore.html share format.js, charts.js, svg.js, engine.js,
  // permalink.js and dash.css. Two different stamps for one file would mean one page
  // was restamped and the other was not, which is the half-updated state this guards.
  const seen = new Map();
  for (const [name, html] of [["index.html", index], ["explore.html", explore]]) {
    for (const [, asset, , got] of html.matchAll(STAMPED)) {
      const prev = seen.get(asset);
      if (prev) assert.equal(got, prev.got, `${asset} is ?v=${prev.got} in ${prev.name} but ?v=${got} in ${name}`);
      else seen.set(asset, { got, name });
    }
  }
});

test("the hover tip is loaded on every page that draws marks", () => {
  /* svg.js has emitted data-tip since the SVG conversion, but nothing read it: the
     attributes shipped and the consumer did not, so hovering fell through to the
     browser's native <title> -- slow, unstyled, and read by the owner as "no data".
     A page that draws marks and does not load tip.js is back in that state, and
     nothing else in this suite can tell. */
  for (const [name, html] of [["index.html", index], ["explore.html", explore]]) {
    assert.match(html, /<script src="js\/tip\.js(\?v=[0-9a-f]+)?"><\/script>/,
      `${name} draws marks but never loads js/tip.js`);
  }
});

test("tip.js is the only thing that styles .tip, and dash.css actually does", () => {
  // The module adds class="tip"; without the stylesheet it is an unstyled div of
  // text dropped at the cursor, which looks like a rendering bug rather than a tip.
  assert.match(css, /\.tip\s*\{/, "dash.css has no .tip rule");
  assert.match(css, /\.tip\.on\s*\{/, "dash.css never reveals the tip");
  assert.match(css, /pointer-events:\s*none/, ".tip must not eat its own hover");
});

