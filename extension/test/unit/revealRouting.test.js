// Unit tests for the pure sidebar-click routing decision (Bug 1a). Run with:
// npm run test:unit

const assert = require("assert");
const path = require("path");
const { chooseRevealTarget } = require(
  path.join(__dirname, "..", "..", "src", "preview", "revealRouting.js")
);

const BASE = {
  panelHandled: false,
  builtInPreviewActive: false,
  sourceEditorActive: false,
  builtInPreviewOpen: false
};

function decide(overrides) {
  return chooseRevealTarget(Object.assign({}, BASE, overrides));
}

describe("chooseRevealTarget", () => {
  it("routes to the interactive panel when it handled the reveal", () => {
    assert.strictEqual(decide({ panelHandled: true }), "panel");
    // Panel wins regardless of other surfaces.
    assert.strictEqual(
      decide({ panelHandled: true, builtInPreviewActive: true, builtInPreviewOpen: true }),
      "panel"
    );
  });

  it("routes to the built-in preview when it is the active tab", () => {
    assert.strictEqual(decide({ builtInPreviewActive: true }), "preview");
    assert.strictEqual(
      decide({ builtInPreviewActive: true, builtInPreviewOpen: true }),
      "preview"
    );
  });

  it("routes to the source when the source editor is active", () => {
    assert.strictEqual(decide({ sourceEditorActive: true }), "source");
  });

  it("prefers source over a lingering built-in preview in another group (Bug 1a)", () => {
    // The user is editing the raw Markdown but a leftover preview tab exists.
    // The old code mis-routed this to the preview-refresh path; it must be source.
    assert.strictEqual(
      decide({ sourceEditorActive: true, builtInPreviewOpen: true }),
      "source"
    );
  });

  it("falls back to the preview when one is open but nothing is focused", () => {
    // e.g. the click came from the sidebar view, with a preview open elsewhere.
    assert.strictEqual(decide({ builtInPreviewOpen: true }), "preview");
  });

  it("falls back to the source when nothing else applies", () => {
    assert.strictEqual(decide(BASE), "source");
  });
});
