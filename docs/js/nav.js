/* Section nav: keep aria-current on the section you are actually looking at.

   The markup ships aria-current="true" on the first link and nothing ever moved
   it, so the highlight sat on Geography however far you scrolled or whichever
   link you clicked. A nav that looks navigable and reports the wrong place is
   worse than one with no highlight at all.

   IntersectionObserver rather than a scroll handler: it fires only on boundary
   crossings instead of on every frame of a scroll, and it needs no debounce.

   The sticky bar covers the top of the viewport, so a section is "current" from
   the moment it clears that bar. --stick carries the measured height of the
   sticky stack (index.html's boot script writes it and keeps it current on
   resize), which is why the margin is read at observe time rather than hardcoded.

   Classic script: ES modules are CORS-blocked over file:// and index.html must
   keep opening from disk. */
(function (root) {
  "use strict";

  /* aria-current is set to "false" on the others rather than removed. Both are
     valid ARIA; the explicit form says a value was considered, and dash.css
     matches [aria-current="true"] so a "false" cannot paint a link active. */
  function mark(links, current) {
    for (const a of links) {
      if (a === current) a.setAttribute("aria-current", "true");
      else a.setAttribute("aria-current", "false");
    }
  }

  function init(doc) {
    const d = doc || document;
    const nav = d.querySelector(".nav");
    if (!nav) return;

    const links = [...nav.querySelectorAll("a[href^='#']")];
    const byId = new Map();
    for (const a of links) {
      const el = d.getElementById(a.getAttribute("href").slice(1));
      if (el) byId.set(el, a);
    }
    if (!byId.size) return;

    /* A click should land before the smooth scroll finishes. Without this the
       highlight lags the whole way down the page, which reads as a dead nav. */
    nav.addEventListener("click", (ev) => {
      const a = ev.target.closest && ev.target.closest("a[href^='#']");
      if (a && links.includes(a)) mark(links, a);
    });

    const stick = () => {
      const v = getComputedStyle(d.documentElement).getPropertyValue("--stick");
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : 120;
    };

    /* The current section is the LAST one whose top has crossed below the sticky
       bar -- sections in document order, so the last match is the one you are in.

       An earlier version asked an IntersectionObserver which sections were visible
       and took the topmost. That is wrong for a tall section: once scrolled past,
       its top is far negative while its body still intersects, so it kept winning
       and the highlight stuck. Measuring the crossing directly has no such state. */
    const sections = [...byId.keys()];
    const pick = () => {
      const line = stick() + 24;
      let best = sections[0];
      for (const el of sections) {
        if (el.getBoundingClientRect().top <= line) best = el;
      }
      /* At the very bottom the last section may be too short to reach the line;
         if the page is scrolled to the end, it is what you are looking at. */
      if (root.innerHeight + root.scrollY >= d.documentElement.scrollHeight - 2) {
        best = sections[sections.length - 1];
      }
      return best;
    };

    /* rAF-throttled rather than an observer: six getBoundingClientRect calls at
       most once per frame is cheap, and it gives one answer that cannot disagree
       with itself. Six boundary-crossing callbacks could, and did. */
    let queued = false;
    const update = () => {
      queued = false;
      const a = byId.get(pick());
      if (a) mark(links, a);
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      (root.requestAnimationFrame || setTimeout)(update);
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    root.addEventListener("resize", onScroll, { passive: true });
    update();
  }

  root.MD = root.MD || {};
  root.MD.nav = { init, mark };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => init());
    } else {
      init();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
