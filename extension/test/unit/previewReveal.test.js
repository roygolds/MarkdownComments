// Unit tests for the built-in preview scroll/dedup/retry core (Bug 2). The real
// logic runs inside the preview webview, so it is exercised here with an injected
// fake document, element, and scheduler — no jsdom required. Run with:
// npm run test:unit

const assert = require("assert");
const path = require("path");
const { createRevealController } = require(
  path.join(__dirname, "..", "..", "media", "previewReveal.js")
);

// Minimal fake DOM + scheduler. Timeouts and rAF callbacks are queued so the
// test can flush them deterministically and count scrollIntoView calls.
function makeHarness(initialNonce) {
  const timers = [];
  const rafs = [];
  let scrollCount = 0;
  const classes = new Set();

  const flashSibling = {
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c)
    }
  };

  const anchor = {
    _nonce: initialNonce,
    getAttribute: (name) =>
      name === "data-mdc-reveal-nonce" ? anchor._nonce : null,
    scrollIntoView: () => {
      scrollCount += 1;
    },
    nextElementSibling: flashSibling,
    parentElement: flashSibling
  };

  const controller = createRevealController({
    document: {
      querySelector: () => (anchor._present === false ? null : anchor)
    },
    requestAnimationFrame: (cb) => {
      rafs.push(cb);
      return rafs.length;
    },
    setTimeout: (cb, ms) => {
      timers.push({ cb, ms });
      return timers.length;
    },
    retryDelays: [50, 150, 350, 600]
  });

  return {
    controller,
    anchor,
    classes,
    scrollCount: () => scrollCount,
    flushRaf: () => {
      const pending = rafs.splice(0);
      pending.forEach((cb) => cb());
    },
    flushTimers: () => {
      const pending = timers.splice(0);
      pending.forEach((t) => t.cb());
    },
    timerCount: () => timers.length
  };
}

describe("createRevealController", () => {
  it("scrolls immediately and re-asserts across the retry window for a new nonce", () => {
    const h = makeHarness("n1");
    assert.strictEqual(h.controller.applyReveal(), true, "fresh nonce starts a reveal");
    assert.strictEqual(h.scrollCount(), 1, "scrolls immediately");

    h.flushRaf();
    assert.strictEqual(h.scrollCount(), 2, "re-asserts on the next animation frame");

    h.flushTimers();
    // 4 retry delays each re-assert (the 5th timer is the flash cleanup, no scroll).
    assert.strictEqual(h.scrollCount(), 6, "re-asserts at each retry offset");
  });

  it("dedupes the same nonce so it only scrolls for one click cycle", () => {
    const h = makeHarness("n1");
    h.controller.applyReveal();
    h.flushRaf();
    h.flushTimers();
    const after = h.scrollCount();

    assert.strictEqual(h.controller.applyReveal(), false, "same nonce is a no-op");
    h.flushRaf();
    h.flushTimers();
    assert.strictEqual(h.scrollCount(), after, "no extra scrolls for the same nonce");
  });

  it("scrolls again when a new nonce appears (re-click)", () => {
    const h = makeHarness("n1");
    h.controller.applyReveal();
    h.flushRaf();
    h.flushTimers();
    const after = h.scrollCount();

    h.anchor._nonce = "n2";
    assert.strictEqual(h.controller.applyReveal(), true, "new nonce starts a fresh reveal");
    assert.ok(h.scrollCount() > after, "scrolls again for the new nonce");
  });

  it("ignores stale re-asserts once a newer nonce takes over", () => {
    const h = makeHarness("n1");
    h.controller.applyReveal(); // queues n1 raf + retries
    const afterImmediate = h.scrollCount();

    // A newer click arrives before n1's deferred scrolls run.
    h.anchor._nonce = "n2";
    h.controller.applyReveal();
    const afterN2Immediate = h.scrollCount();

    // Flush everything: n1's deferred scrolls must be skipped (guarded by nonce),
    // only n2's deferred scrolls run.
    h.flushRaf();
    h.flushTimers();

    // n2 contributes: 1 raf + 4 retries = 5 deferred scrolls on top of its
    // immediate scroll. n1's deferred scrolls are all no-ops.
    assert.strictEqual(
      h.scrollCount(),
      afterN2Immediate + 5,
      "only the active nonce's re-asserts run"
    );
    assert.ok(afterN2Immediate > afterImmediate, "the newer nonce scrolled immediately");
  });

  it("does nothing when there is no anchor", () => {
    const h = makeHarness("n1");
    h.anchor._present = false;
    assert.strictEqual(h.controller.applyReveal(), false);
    assert.strictEqual(h.scrollCount(), 0);
  });

  it("flashes the anchored content", () => {
    const h = makeHarness("n1");
    h.controller.applyReveal();
    assert.ok(h.classes.has("mdc-reveal-flash"), "adds the flash class");
    h.flushTimers();
    assert.ok(!h.classes.has("mdc-reveal-flash"), "removes the flash class after the window");
  });
});
