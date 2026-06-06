// Enhancement script loaded into VS Code's built-in Markdown preview via the
// `markdown.previewScripts` contribution. The built-in preview has no supported
// channel to write edits back to this extension, so here we only provide
// read-only affordances: hide all comments, collapse all comment bodies, and
// per-thread collapse. Toggle state is kept in localStorage (we must not call
// acquireVsCodeApi here — the built-in preview already owns it).
(function () {
  "use strict";

  const HIDE_KEY = "markdownComments.preview.hide";
  const COLLAPSE_KEY = "markdownComments.preview.collapse";

  function readFlag(key) {
    try {
      return window.localStorage.getItem(key) === "1";
    } catch (e) {
      return false;
    }
  }

  function writeFlag(key, on) {
    try {
      window.localStorage.setItem(key, on ? "1" : "0");
    } catch (e) {
      /* ignore */
    }
  }

  function applyClasses() {
    document.body.classList.toggle("mdc-pv-hide", readFlag(HIDE_KEY));
    document.body.classList.toggle("mdc-pv-collapse", readFlag(COLLAPSE_KEY));
  }

  function buildToolbar() {
    if (document.getElementById("mdc-pv-toolbar")) {
      return;
    }
    const bar = document.createElement("div");
    bar.id = "mdc-pv-toolbar";
    bar.className = "mdc-pv-toolbar";

    const hideBtn = makeToggle("Hide comments", HIDE_KEY);
    const collapseBtn = makeToggle("Collapse comments", COLLAPSE_KEY);
    bar.appendChild(hideBtn);
    bar.appendChild(collapseBtn);
    document.body.appendChild(bar);
  }

  function makeToggle(label, key) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mdc-pv-toolbar__btn";
    btn.textContent = label;
    btn.setAttribute("aria-pressed", String(readFlag(key)));
    btn.addEventListener("click", () => {
      const next = !readFlag(key);
      writeFlag(key, next);
      btn.setAttribute("aria-pressed", String(next));
      applyClasses();
    });
    return btn;
  }

  // Per-thread collapse buttons are present in the server-rendered markup.
  document.addEventListener("click", (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) {
      return;
    }
    const btn = target.closest('.mdc-collapse[data-action="collapse"]');
    if (!btn) {
      return;
    }
    const thread = btn.closest(".mdc-thread");
    if (thread) {
      thread.classList.toggle("mdc-thread--collapsed");
    }
  });

  // Sidebar reveal bridge: a click in the comments sidebar stashes the target
  // thread in the extension and refreshes this preview, which re-renders with an
  // invisible `.mdc-reveal-anchor` carrying a fresh nonce next to the matching
  // fence. Scroll it into view once per nonce (VS Code gives extensions no API to
  // scroll the built-in preview, so we do it here from inside the preview DOM).
  // The robust scroll/dedup/retry core lives in previewReveal.js (a sibling
  // preview script) so it can be unit-tested without a webview.
  var revealApi = (typeof self !== "undefined" && self.MdcPreviewReveal) || null;
  var revealController = revealApi
    ? revealApi.createRevealController({
        document: document,
        requestAnimationFrame:
          typeof window !== "undefined" && window.requestAnimationFrame
            ? window.requestAnimationFrame.bind(window)
            : null,
        setTimeout:
          typeof window !== "undefined" && window.setTimeout
            ? window.setTimeout.bind(window)
            : null
      })
    : null;

  function applyReveal() {
    if (revealController) {
      revealController.applyReveal();
    }
  }

  function init() {
    buildToolbar();
    applyClasses();
    applyReveal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // The built-in preview morphs content on document change; body classes and
  // the toolbar survive, but re-assert them shortly after updates.
  const observer = new MutationObserver(() => {
    buildToolbar();
    applyClasses();
    applyReveal();
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
