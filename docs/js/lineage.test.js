/* Every plate's caption claims a source: a Gold mart and the notebook cell that builds
   it, or an explorer artifact and the script that writes it. Nothing in the build
   asserts that mapping, so these claims would rot silently -- a cell inserted into
   04_gold_hero_marts.ipynb shifts every index below it, and the captions would go on
   naming the old numbers with no error anywhere.

   That failure mode is exactly why pipeline/build_explorer_data.py carries a
   builder_sha256 freshness gate: an un-asserted claim about provenance is worse than no
   claim, because it reads as verified. This file is that gate for the captions.

   Run: node --test docs/js/*.test.js */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const PAGES = ["docs/index.html", "docs/explore.html"];

/* A caption looks like:
     <span class="src">Source <code>gold_hero_geo_arbitrage</code> &middot;
     04_gold_hero_marts.ipynb cell 3</span>                                   */
function captions() {
  const out = [];
  for (const page of PAGES) {
    const html = read(page);
    for (const m of html.matchAll(/<span>Pl\. ([IVX]+) &middot; (.*?)<\/span><span class="src">Source (.*?)<\/span>/g)) {
      const [, numeral, left, src] = m;
      out.push({
        page,
        numeral,
        left,
        src,
        codes: [...src.matchAll(/<code>(.*?)<\/code>/g)].map((c) => c[1]),
        // Tags are stripped first: the notebook name is wrapped in <code> so
        // text-transform: uppercase does not render ".IPYNB" as if that were
        // the filename.
        cell: (src.replace(/<[^>]+>/g, "").match(/([\w.]+\.ipynb) cell (\d+)/) || []).slice(1),
      });
    }
  }
  return out;
}

const CAPS = captions();

test("every plate carries exactly one caption", () => {
  for (const page of PAGES) {
    const plates = (read(page).match(/<section class="plate"/g) || []).length;
    const caps = CAPS.filter((c) => c.page === page).length;
    assert.ok(plates > 0, `${page} has no plates`);
    assert.equal(caps, plates, `${page}: ${plates} plates but ${caps} captions`);
  }
});

test("plate numerals are unique and cover I..VIII with no gaps", () => {
  const ORDER = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];
  const got = CAPS.map((c) => c.numeral);
  assert.deepEqual(got, ORDER.slice(0, got.length),
    "plate numbers are literal text, so a reordered or duplicated plate shows up here");
});

test("every caption names a unit", () => {
  for (const c of CAPS) {
    assert.match(c.left, /&middot; Unit: \S/,
      `Pl. ${c.numeral} caption does not name its unit of analysis: "${c.left}"`);
  }
});

test("every Gold mart named in a caption is actually loaded by the publisher", () => {
  const pub = read("pipeline/publish_dashboard.py");
  const marts = CAPS.flatMap((c) => c.codes).filter((n) => n.startsWith("gold_hero_"));
  assert.ok(marts.length >= 5, `expected the five hero marts, found ${marts.length}`);
  for (const mart of new Set(marts)) {
    assert.ok(pub.includes(mart),
      `caption names mart "${mart}" but publish_dashboard.py never loads it`);
  }
});

test("every notebook cell a caption cites exists and builds the mart it is cited for", () => {
  const cited = CAPS.filter((c) => c.cell.length === 2);
  assert.ok(cited.length >= 6, `expected a cell citation per hero plate, found ${cited.length}`);

  for (const c of cited) {
    const [nbName, idxStr] = c.cell;
    const nbPath = path.join("notebooks", nbName);
    assert.ok(fs.existsSync(path.join(ROOT, nbPath)),
      `Pl. ${c.numeral} cites ${nbPath}, which does not exist`);

    const cells = JSON.parse(read(nbPath)).cells;
    const idx = Number(idxStr);
    assert.ok(idx >= 0 && idx < cells.length,
      `Pl. ${c.numeral} cites ${nbName} cell ${idx}, but it has ${cells.length} cells`);

    const cell = cells[idx];
    assert.equal(cell.cell_type, "code",
      `Pl. ${c.numeral} cites ${nbName} cell ${idx}, which is a ${cell.cell_type} cell, not code`);

    const src = cell.source.join("");
    const mart = c.codes.find((n) => n.startsWith("gold_hero_"));
    assert.ok(src.includes(mart),
      `Pl. ${c.numeral} cites ${nbName} cell ${idx} as the source of "${mart}", ` +
      `but that cell never mentions it -- a cell was probably inserted above it`);
  }
});

test("every explorer artifact named in a caption is one the builder writes", () => {
  const builder = read("pipeline/build_explorer_data.py");
  const arts = CAPS.flatMap((c) => c.codes).filter((n) => n.endsWith(".parquet"));
  assert.ok(arts.length >= 2, `expected the explorer artifacts, found ${arts.length}`);
  for (const art of new Set(arts)) {
    const stem = art.replace(/\.parquet$/, "");
    assert.ok(new RegExp(`"${stem}"`).test(builder),
      `caption names "${art}" but build_explorer_data.py does not write it`);
    assert.ok(fs.existsSync(path.join(ROOT, "docs/data", art)),
      `caption names "${art}" but docs/data/${art} is not present`);
  }
});
