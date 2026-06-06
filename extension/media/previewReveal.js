// Robust scroll-into-view core for the built-in Markdown preview's sidebar
// reveal. Authored as a UMD module so it works both as a browser global (loaded
// into the preview webview via `markdown.previewScripts`, where media/preview.js
// consumes `self.MdcPreviewReveal`) and as a CommonJS module the fast unit tests
// can require with a fake document/scheduler.
//
// Why retries: `markdown.preview.refresh` reloads the preview, which first
// restores the preview's remembered scroll position and may shift layout as
// images/content load. A single early scrollIntoView then lands at the wrong
// place or is overridden. So when a NEW reveal nonce appears we scroll
// immediately and RE-ASSERT a few times across a short window, winning over the
// preview's own scroll restoration and post-layout shifts. The nonce dedup keeps
// the SAME click cycle to one reveal while letting a re-click (fresh nonce)
// scroll again.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.MdcPreviewReveal = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var ANCHOR_SELECTOR = ".mdc-reveal-anchor[data-mdc-reveal-nonce]";
  // Re-assert offsets (ms) chosen to straddle the preview's scroll restoration
  // and typical post-layout shifts after a refresh.
  var DEFAULT_RETRY_DELAYS = [50, 150, 350, 600];
  var FLASH_MS = 1200;

  /**
   * Create a reveal controller. Dependencies are injected so the same logic runs
   * unchanged in the webview and under test.
   *
   * @param {{
   *   document: { querySelector: (s: string) => any },
   *   requestAnimationFrame?: (cb: () => void) => any,
   *   setTimeout?: (cb: () => void, ms: number) => any,
   *   retryDelays?: number[]
   * }} env
   */
  function createRevealController(env) {
    var doc = env.document;
    var timer =
      env.setTimeout ||
      (typeof setTimeout !== "undefined" ? setTimeout : function () {});
    var raf =
      env.requestAnimationFrame ||
      function (cb) {
        return timer(cb, 0);
      };
    var retryDelays = env.retryDelays || DEFAULT_RETRY_DELAYS;
    var lastNonce = null;

    function scrollToAnchor(anchor) {
      // Use instant alignment (not smooth) so repeated re-asserts converge on the
      // same final position instead of fighting an in-flight smooth animation.
      try {
        anchor.scrollIntoView({ block: "start", behavior: "auto" });
      } catch (e) {
        try {
          anchor.scrollIntoView();
        } catch (e2) {
          /* ignore */
        }
      }
    }

    function flashAround(anchor) {
      var flash = anchor.nextElementSibling || anchor.parentElement;
      if (flash && flash.classList) {
        flash.classList.add("mdc-reveal-flash");
        timer(function () {
          flash.classList.remove("mdc-reveal-flash");
        }, FLASH_MS);
      }
    }

    /**
     * Scroll to the pending reveal anchor if it carries a not-yet-handled nonce.
     * Returns true when a fresh reveal was started, false when there was nothing
     * new to do (no anchor, or the same nonce already handled).
     */
    function applyReveal() {
      var anchor = doc.querySelector(ANCHOR_SELECTOR);
      if (!anchor) {
        return false;
      }
      var nonce = anchor.getAttribute("data-mdc-reveal-nonce");
      if (!nonce || nonce === lastNonce) {
        return false;
      }
      lastNonce = nonce;

      scrollToAnchor(anchor);
      raf(function () {
        // Guard every deferred scroll so a newer click (newer nonce) wins and
        // stale re-asserts from a previous cycle become no-ops.
        if (lastNonce === nonce) {
          scrollToAnchor(anchor);
        }
      });
      for (var i = 0; i < retryDelays.length; i++) {
        timer(
          (function (delayNonce) {
            return function () {
              if (lastNonce === delayNonce) {
                scrollToAnchor(anchor);
              }
            };
          })(nonce),
          retryDelays[i]
        );
      }

      flashAround(anchor);
      return true;
    }

    return { applyReveal: applyReveal };
  }

  return { createRevealController: createRevealController };
});
