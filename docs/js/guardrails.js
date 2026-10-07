/* Small-sample guardrails.

   Free slicing can manufacture the artifacts the static panels were rewritten to
   remove -- filter hero 2 to Orthopedic Surgery and the "+2,223% premium" (n=11)
   reappears. The approved behaviour is warn, never hide: the number always
   renders, wearing a badge that names its cohort size. */
(function (root) {
  "use strict";

  // Matches MIN_NONPAR_PROVIDERS in pipeline/publish_dashboard.py. If you change
  // one, change both, or the static and live surfaces will disagree.
  const RELIABLE = 30;
  // CMS suppresses provider-service rows under 11 beneficiaries; borrowing the
  // same floor keeps the language familiar to anyone who knows the dataset.
  const WEAK = 11;

  function reliability(n) {
    if (!Number.isFinite(n)) return "very-thin";
    if (n >= RELIABLE) return "ok";
    if (n >= WEAK) return "thin";
    return "very-thin";
  }

  function badgeText(n) {
    const level = reliability(n);
    if (level === "ok") return "";
    const shown = Number.isFinite(n) ? n : 0;
    return level === "thin"
      ? `n=${shown} · thin sample`
      : `n=${shown} · below CMS's suppression floor`;
  }

  /* Reliability used to ride on OPACITY -- 1 / 0.55 / 0.4 over a coloured bar. That put
     the two warning states at 2.05:1 and 1.67:1 against the sheet, so the bars this
     guardrail exists to flag were the least legible things on the page. Exactly backwards.

     It is a HATCH PITCH now: 0 means solid, otherwise the tile size in px, so a thinner
     cohort gets a sparser interior. The mark keeps a 1px --series border in every state,
     which holds the silhouette at 4.03:1 however sparse the fill -- so the warning reads
     as a warning without making the warned number harder to see. */
  const PATTERN_PITCH = { ok: 0, thin: 7, "very-thin": 12 };
  const patternPitch = (level) => PATTERN_PITCH[level] ?? 0;

  /* The dot plot's filled/hollow channel needs a boolean, not a pitch. Kept as a
     separate function rather than overloading patternPitch, so each is named for
     the one channel it drives: pitch for the choropleth's hatch, this for a dot. */
  const isReliable = (level) => level === "ok";

  function applyBadge(el, n) {
    if (!el) return;
    const level = reliability(n);
    el.textContent = badgeText(n);
    el.setAttribute("data-reliability", level);
    el.hidden = level === "ok";
  }

  root.MD = root.MD || {};
  root.MD.guardrails = { RELIABLE, WEAK, reliability, badgeText, patternPitch,
                         isReliable, applyBadge };
})(typeof window !== "undefined" ? window : globalThis);
