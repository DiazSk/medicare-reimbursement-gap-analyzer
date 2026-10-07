#!/usr/bin/env python3
"""Stamp docs/*.html asset tags with a content hash, so a stale cached file cannot
pair with a fresh one.

The dashboard is a set of classic scripts sharing one global (window.MD), and each
module destructures names the others export. That makes a half-updated cache fatal
rather than merely stale: a browser holding yesterday's format.js beside today's
explore.js throws "F(...).moneyTick is not a function" and renders nothing. GitHub
Pages serves these with Cache-Control: max-age=600, so any visit straddling a deploy
can land in that window.

The fix is a content hash in the query string -- js/format.js?v=a1b2c3d4 -- which
changes exactly when the file changes, so the browser refetches then and only then.

Classic scripts are deliberate here (ES modules are CORS-blocked over file://, and
docs/index.html must keep opening straight from disk), and a query string does not
interfere with that: verified in Chrome that a file:// page loads js/x.js?v=abc.

Run after editing anything under docs/js/ or docs/css/:

    python3 pipeline/stamp_assets.py

It is idempotent, and `--check` exits non-zero instead of writing, which is what
docs/js/contract.test.js uses to fail the suite when a stamp has gone stale.
"""
from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

DOCS = Path(__file__).resolve().parent.parent / "docs"
PAGES = ("index.html", "explore.html")

# Only tags whose target ships from this repo. An absolute URL or a bare anchor is
# left alone, and the opening of each tag is matched literally so the regex can
# never wander into the inlined JSON payload, which lives on one very long line.
TAG = re.compile(
    r'(?P<head><(?:script\s+src|link\s+rel="stylesheet"\s+href)=")'
    r"(?P<path>(?:js|css)/[A-Za-z0-9._-]+)"
    r'(?:\?v=[0-9a-f]+)?"'
)

HASH_CHARS = 8


def stamp(path: str) -> str:
    """The first HASH_CHARS of the file's sha256. Short is fine: this is a cache key,
    not a security boundary -- it only has to differ when the bytes differ."""
    return hashlib.sha256((DOCS / path).read_bytes()).hexdigest()[:HASH_CHARS]


def restamp(html: str, page: str) -> tuple[str, list[str]]:
    """Return the rewritten HTML and the list of assets whose stamp moved."""
    moved: list[str] = []

    def sub(m: re.Match[str]) -> str:
        path = m.group("path")
        target = DOCS / path
        if not target.exists():
            # A tag pointing at a file that is not there is a real defect, not
            # something to paper over with a hash of nothing.
            raise SystemExit(f"{page}: <{m.group(0)}> references {path}, which does not exist")
        want = stamp(path)
        if m.group(0) != f'{m.group("head")}{path}?v={want}"':
            moved.append(path)
        return f'{m.group("head")}{path}?v={want}"'

    return TAG.sub(sub, html), moved


def main(argv: list[str]) -> int:
    check = "--check" in argv[1:]
    stale: list[str] = []

    for page in PAGES:
        src = DOCS / page
        html = src.read_text()
        out, moved = restamp(html, page)
        stale += [f"{page}: {p}" for p in moved]
        if out != html and not check:
            # Writing the whole string back preserves the inlined payload line
            # exactly; contract.test.js asserts it stays unreflowed.
            src.write_text(out)

    if check:
        if stale:
            print("Asset stamps are stale:")
            for s in stale:
                print(f"  {s}")
            print("\nRun: python3 pipeline/stamp_assets.py")
            return 1
        print(f"All asset stamps current across {len(PAGES)} pages.")
        return 0

    if stale:
        print(f"Restamped {len(stale)} asset(s):")
        for s in stale:
            print(f"  {s}")
    else:
        print("All asset stamps already current.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
