// Unit tests for the pure comments-sidebar target decision. Run with:
// npm run test:unit

const assert = require("assert");
const path = require("path");
const { chooseSidebarTarget } = require(
  path.join(__dirname, "..", "..", "src", "preview", "sidebarTarget.js")
);

const BASE = {
  activeMarkdownEditorUri: null,
  panelSourceUri: null,
  builtInPreviewActive: false,
  openMarkdownUris: [],
  previewTabLabel: null,
  currentTargetUri: null
};

function decide(overrides) {
  return chooseSidebarTarget(Object.assign({}, BASE, overrides));
}

describe("chooseSidebarTarget", () => {
  it("populates the sidebar from the loaded doc when only the built-in preview is open (the bug)", () => {
    // Built-in preview opened/active before the source editor was ever focused:
    // no active markdown editor, no panel source, no prior target — but the
    // backing Markdown document is still loaded in workspace.textDocuments.
    assert.strictEqual(
      decide({
        builtInPreviewActive: true,
        openMarkdownUris: ["file:///a.md"]
      }),
      "file:///a.md"
    );
  });

  it("targets the active markdown editor over everything else", () => {
    assert.strictEqual(
      decide({
        activeMarkdownEditorUri: "file:///editor.md",
        panelSourceUri: "file:///panel.md",
        builtInPreviewActive: true,
        openMarkdownUris: ["file:///other.md"],
        previewTabLabel: "Preview other.md",
        currentTargetUri: "file:///prev.md"
      }),
      "file:///editor.md"
    );
  });

  it("targets the panel source when no markdown editor is active", () => {
    assert.strictEqual(
      decide({
        panelSourceUri: "file:///panel.md",
        builtInPreviewActive: true,
        openMarkdownUris: ["file:///other.md"]
      }),
      "file:///panel.md"
    );
  });

  it("keeps the current target during built-in preview to avoid churn", () => {
    assert.strictEqual(
      decide({
        builtInPreviewActive: true,
        currentTargetUri: "file:///a.md",
        openMarkdownUris: ["file:///a.md", "file:///b.md"]
      }),
      "file:///a.md"
    );
  });

  it("disambiguates multiple loaded docs via the preview tab label basename", () => {
    assert.strictEqual(
      decide({
        builtInPreviewActive: true,
        openMarkdownUris: ["file:///docs/a.md", "file:///docs/b.md"],
        previewTabLabel: "Preview b.md"
      }),
      "file:///docs/b.md"
    );
  });

  it("decodes percent-encoded basenames when matching the label", () => {
    assert.strictEqual(
      decide({
        builtInPreviewActive: true,
        openMarkdownUris: ["file:///docs/my%20notes.md", "file:///docs/other.md"],
        previewTabLabel: "Preview my notes.md"
      }),
      "file:///docs/my%20notes.md"
    );
  });

  it("returns null for ambiguous or empty labels with multiple loaded docs", () => {
    // Empty/missing label, multiple candidates.
    assert.strictEqual(
      decide({
        builtInPreviewActive: true,
        openMarkdownUris: ["file:///a.md", "file:///b.md"]
      }),
      null
    );
    // A label that names neither basename.
    assert.strictEqual(
      decide({
        builtInPreviewActive: true,
        openMarkdownUris: ["file:///a.md", "file:///b.md"],
        previewTabLabel: "Preview c.md"
      }),
      null
    );
    // A label that matches both basenames is ambiguous → null.
    assert.strictEqual(
      decide({
        builtInPreviewActive: true,
        openMarkdownUris: ["file:///a.md", "file:///a.md.bak.md"],
        previewTabLabel: "a.md and a.md.bak.md"
      }),
      null
    );
  });

  it("returns null (keep current) when nothing is active and no preview", () => {
    assert.strictEqual(decide(BASE), null);
    // A prior target plus an unrelated non-markdown tab must not blank the sidebar.
    assert.strictEqual(decide({ currentTargetUri: "file:///a.md" }), null);
  });

  it("returns null during built-in preview when no markdown docs are loaded", () => {
    assert.strictEqual(decide({ builtInPreviewActive: true, openMarkdownUris: [] }), null);
  });

  it("replaces a stale current target that is no longer loaded (does not pin a closed doc)", () => {
    // Churn-avoidance must only keep the current target when it is STILL loaded.
    // A previously-targeted doc that was closed (absent from openMarkdownUris)
    // must not be re-asserted; the function falls through to resolve the doc that
    // is actually loaded, so the sidebar can't get stuck on a dead document.
    assert.strictEqual(
      decide({
        builtInPreviewActive: true,
        currentTargetUri: "file:///closed.md",
        openMarkdownUris: ["file:///a.md"]
      }),
      "file:///a.md"
    );
  });

  it("keeps the loaded current target over a label naming another doc (anti-churn beats label)", () => {
    // Documented priority: keep-current-loaded-target outranks tab-label
    // disambiguation. With the current target still loaded, a label pointing at a
    // different open doc must not steal the target.
    assert.strictEqual(
      decide({
        builtInPreviewActive: true,
        currentTargetUri: "file:///a.md",
        openMarkdownUris: ["file:///a.md", "file:///b.md"],
        previewTabLabel: "Preview b.md"
      }),
      "file:///a.md"
    );
  });

  it("disambiguates via a bare-filename preview label (no \"Preview \" prefix)", () => {
    // VS Code's preview tab label varies by version: sometimes "Preview name.md",
    // sometimes just "name.md". The basename-substring match must handle both.
    assert.strictEqual(
      decide({
        builtInPreviewActive: true,
        openMarkdownUris: ["file:///docs/a.md", "file:///docs/b.md"],
        previewTabLabel: "b.md"
      }),
      "file:///docs/b.md"
    );
  });

  it("does not mis-target when one basename is a suffix of another (safe-fail to keep current)", () => {
    // "a.md" is a substring of "ba.md", so a label naming "ba.md" matches BOTH
    // candidates. The function must treat this as ambiguous and return null
    // (keep current) rather than silently guessing the wrong document.
    assert.strictEqual(
      decide({
        builtInPreviewActive: true,
        openMarkdownUris: ["file:///a.md", "file:///ba.md"],
        previewTabLabel: "Preview ba.md"
      }),
      null
    );
  });
});
