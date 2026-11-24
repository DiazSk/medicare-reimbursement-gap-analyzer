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

  function init(doc) {
    const d = doc || document;
    if (d.querySelector(".tip")) return;           // idempotent: one tip per page
    const box = d.createElement("div");
    box.className = "tip";
    // Hidden from the accessibility tree: it mirrors a mark the tree does not
    // expose, and announcing it on pointer move would interrupt without context.
    box.setAttribute("aria-hidden", "true");
    d.body.appendChild(box);

    let shown = null;

    const hide = () => {
      if (!shown) return;
      shown = null;
      box.classList.remove("on");
    };

    d.addEventListener("pointermove", (ev) => {
      // Touch and pen get nothing: a tip that follows a finger sits under it, and
      // tap-to-show needs a dismiss affordance this layer does not have. There is no
      // native <title> behind it any more, so this is a bail-out, not a fallback.
      if (ev.pointerType && ev.pointerType !== "mouse") return hide();

      const el = ev.target && ev.target.closest ? ev.target.closest(SEL) : null;
      if (!el) return hide();

      if (el !== shown) {
        const p = parts(el);
        box.innerHTML =
          (p.label ? `<span class="mono">${esc(p.label)}</span>` : "")
          + (p.value ? `<b>${esc(p.value)}</b>` : "")
          + (p.note ? `<span class="note">${esc(p.note)}</span>` : "");
        shown = el;
        box.classList.add("on");
      }

      // Measured after the content is set, so the flip uses this tip's real size.
      const r = box.getBoundingClientRect();
      const vw = root.innerWidth || d.documentElement.clientWidth;
      const vh = root.innerHeight || d.documentElement.clientHeight;
      const pos = place(ev.clientX, ev.clientY, r.width, r.height, vw, vh);
      box.style.left = pos.left + "px";
      box.style.top = pos.top + "px";
    });

    // A scroll moves the marks out from under a fixed-position tip, which would
    // otherwise keep describing whatever used to be there.
    d.addEventListener("scroll", hide, true);
    d.addEventListener("pointerleave", hide);
  }

  function esc(t) {
    return String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  root.MD = root.MD || {};
  root.MD.tip = { init, place };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => init());
    } else {
      init();
    }
  }
})(typeof window !== "undefined" ? window : globalThis);
