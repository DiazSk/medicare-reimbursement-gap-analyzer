/* The one shared hover tip.

   Every mark on both pages carries data-tip-label / -value / -note (svg.js's
   tipParts, and the choropleth's own <path>s). Nothing read them until now: the
   attributes shipped, the consumer did not, so hovering a chart fell through to the
   browser's native <title> tooltip -- slow, unstyled, and easy to read as "no data".

   One listener on the document, not one per mark: panels re-render on every filter
   change, and per-mark listeners would be re-attached on each pass and leak the old
   ones. Delegation also means a chart drawn later needs no registration at all.

   No mark carries a <title> any more. They were removed once it was clear they
   reached no screen reader -- frame() marks every chart role="img", which makes
   descendants presentational -- while still drawing the browser's own tooltip
   underneath this one.

   So this layer is pointer-only AND it is the only tip. The marks are not
   focusable, so there is no keyboard path to one, and the figures a sighted
   reader gets on hover are not available to assistive tech outside hero 4's
   SHOW TABLE. Making ~400 marks tabbable is a larger change than this one, and a
   half-done version would add tab stops that announce nothing. The gap is real
   and open.

   Classic script, like everything else here: ES modules are CORS-blocked over
   file://, and docs/index.html must keep opening straight from disk. */
(function (root) {
  "use strict";

  const SEL = "[data-tip-label], [data-tip-value]";
  const OFFSET = 14;   // clear of the cursor, close enough to read as attached
  const EDGE = 8;      // never flush against the viewport

  /* Pure, so the clamp is testable without a DOM. Prefers below-right of the
     cursor, flips to the other side when the tip would overflow rather than
     sliding along the edge -- sliding leaves the tip covering the mark it
     describes, which is the one thing it must not hide. */
  function place(x, y, w, h, vw, vh) {
    let left = x + OFFSET;
    if (left + w > vw - EDGE) left = x - OFFSET - w;
    if (left < EDGE) left = EDGE;

    let top = y + OFFSET;
    if (top + h > vh - EDGE) top = y - OFFSET - h;
    if (top < EDGE) top = EDGE;

    return { left, top };
  }

  function parts(el) {
    return {
      label: el.getAttribute("data-tip-label"),
      value: el.getAttribute("data-tip-value"),
      note: el.getAttribute("data-tip-note"),
    };
  }

  let box = null;      // the one tip element
  let live = null;     // the polite live region the keyboard cursor announces into
  let shown = null;

  function hide() {
    if (!shown) return;
    shown = null;
    if (box) box.classList.remove("on");
  }

  /* Fill the tip for a mark and place it at a point. Shared by the pointer path
     and the keyboard cursor, so the two cannot drift into different tips. */
  function showAt(el, x, y, d) {
    if (!box) return;
    if (el !== shown) {
      const p = parts(el);
      box.innerHTML =
        (p.label ? `<span class="mono">${esc(p.label)}</span>` : "")
        + (p.value ? `<b>${esc(p.value)}</b>` : "")
        + (p.note ? `<span class="note">${esc(p.note)}</span>` : "");
      shown = el;
      box.classList.add("on");
    }
    const r = box.getBoundingClientRect();
    const vw = root.innerWidth || d.documentElement.clientWidth;
    const vh = root.innerHeight || d.documentElement.clientHeight;
    const pos = place(x, y, r.width, r.height, vw, vh);
    box.style.left = pos.left + "px";
    box.style.top = pos.top + "px";
  }

  // What a screen reader hears when the cursor lands on a mark.
  function announce(el) {
    if (!live) return;
    const p = parts(el);
    live.textContent = [p.label, p.value, p.note].filter(Boolean).join(" \u00b7 ");
  }

  function init(doc) {
    const d = doc || document;
    if (d.querySelector(".tip")) return;           // idempotent: one tip per page
    box = d.createElement("div");
    box.className = "tip";
    // Hidden from the accessibility tree: it mirrors a mark the tree does not
    // expose, and announcing it on pointer move would interrupt without context.
    // The keyboard cursor announces through `live` instead, which is deliberate.
    box.setAttribute("aria-hidden", "true");
    d.body.appendChild(box);

    live = d.createElement("div");
    live.className = "vh";
    live.setAttribute("aria-live", "polite");
    d.body.appendChild(live);

    d.addEventListener("pointermove", (ev) => {
      // Touch and pen get nothing: a tip that follows a finger sits under it, and
      // tap-to-show needs a dismiss affordance this layer does not have. There is no
      // native <title> behind it any more, so this is a bail-out, not a fallback.
      if (ev.pointerType && ev.pointerType !== "mouse") return hide();

      const el = ev.target && ev.target.closest ? ev.target.closest(SEL) : null;
      if (!el) return hide();

      showAt(el, ev.clientX, ev.clientY, d);
    });

    /* A scroll moves the marks out from under a fixed-position tip, which would
       otherwise keep describing whatever used to be there -- so the pointer tip
       hides. The KEYBOARD tip must not: focusing a chart scrolls it into view,
       which fired this handler and blanked the tip the arrow key had just opened.
       Its mark is still the focused one, so it follows instead. */
    d.addEventListener("scroll", () => {
      if (kbHost && cursors.has(kbHost)) moveTo(kbHost, cursors.get(kbHost), d);
      else hide();
    }, true);
    d.addEventListener("pointerleave", hide);
  }


  /* ── keyboard cursor ──────────────────────────────────────────────────────

     frame() marks every chart role="img", so its marks are presentational and a
     screen reader gets one sentence for the figure. The SHOW TABLE toggles carry
     the numbers as text; this carries the CHART, so a keyboard user can explore
     it the way a mouse user does.

     One tab stop per chart, not one per mark. There are ~400 marks on this page
     and tabbing through 60 scatter bubbles to reach the footer would be hostile.
     Arrow keys move a cursor inside the focused chart, which is the pattern the
     reference dashboard uses.

     The tabindex lives on the HOST, never on the <svg>: panels re-render on every
     filter change and on resize, replacing the svg wholesale. An attribute set on
     the svg would vanish the first time anyone touched a filter -- and silently,
     because nothing watches for it. The host div survives. */

  const HOST_SEL = ".chartbox, #tilemap, #cCred";
  const cursors = new WeakMap();   // host -> index of the focused mark
  let kbHost = null;               // the host whose cursor is currently showing

  function marksOf(host) {
    return [...host.querySelectorAll(SEL)];
  }

  function moveTo(host, i, d) {
    const marks = marksOf(host);
    if (!marks.length) return;
    const n = Math.max(0, Math.min(marks.length - 1, i));
    cursors.set(host, n);
    kbHost = host;
    const el = marks[n];
    const r = el.getBoundingClientRect();
    showAt(el, r.left + r.width / 2, r.top + r.height / 2, d);
    announce(el);
  }

  function initCursor(doc) {
    const d = doc || document;
    const hosts = [...d.querySelectorAll(HOST_SEL)];
    if (!hosts.length) return 0;

    for (const host of hosts) {
      host.setAttribute("tabindex", "0");
      /* A plain img role is not focusable in the a11y sense. group + a label says
         "there is something in here to step through", and the description names
         the keys rather than leaving the reader to guess. */
      host.setAttribute("role", "group");
      if (!host.getAttribute("aria-label")) {
        const fig = host.querySelector(".figtitle, h3");
        const svg = host.querySelector("svg[aria-label]");
        host.setAttribute("aria-label",
          (fig && fig.textContent.trim())
          || (svg && svg.getAttribute("aria-label"))
          || "Chart");
      }
      host.setAttribute("aria-description",
        "Use the left and right arrow keys to step through the values.");
    }

    d.addEventListener("keydown", (ev) => {
      const host = ev.target && ev.target.closest ? ev.target.closest(HOST_SEL) : null;
      if (!host) return;

      const marks = marksOf(host);
      if (!marks.length) return;
      const at = cursors.has(host) ? cursors.get(host) : -1;

      switch (ev.key) {
        case "ArrowRight": case "ArrowDown": moveTo(host, at + 1, d); break;
        case "ArrowLeft":  case "ArrowUp":   moveTo(host, at <= 0 ? 0 : at - 1, d); break;
        case "Home":                         moveTo(host, 0, d); break;
        case "End":                          moveTo(host, marks.length - 1, d); break;
        case "Escape":
          cursors.delete(host);
          kbHost = null;
          hide();
          if (live) live.textContent = "";
          host.blur();
          break;
        default: return;      // every other key keeps its normal behaviour
      }
      // Only for keys actually handled, so Tab still leaves and / still finds.
      ev.preventDefault();
    });

    /* Leaving the chart clears the cursor: a tip still showing over a chart the
       reader has tabbed away from describes nothing they are looking at. */
    d.addEventListener("focusout", (ev) => {
      const host = ev.target && ev.target.closest ? ev.target.closest(HOST_SEL) : null;
      if (!host) return;
      cursors.delete(host);
      if (kbHost === host) kbHost = null;
      hide();
    });

    return hosts.length;
  }

  function esc(t) {
    return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  root.MD = root.MD || {};
  root.MD.tip = { init, initCursor, place, marksOf };

  if (typeof document !== "undefined") {
    const start = () => { init(); initCursor(); };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start);
    } else {
      start();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
