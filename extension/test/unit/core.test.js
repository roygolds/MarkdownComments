// Node unit tests for the mdc-wasm core, exercised directly without VS Code.
// Run with: npm run test:unit

const assert = require("assert");
const path = require("path");
const core = require(path.join(__dirname, "..", "..", "native", "mdc", "mdc_wasm.js"));

function doc(...lines) {
  return lines.join("\n") + "\n";
}

const SINGLE = doc(
  "```MarkdownComments",
  "- id: mc-001",
  '  quote: "world"',
  "  comments:",
  "    - by: Yulia",
  '      at: "2026-06-05T08:03:51Z"',
  "      text: First note.",
  "```",
  "Hello world here."
);

describe("mdc-wasm core", () => {
  it("reports a version", () => {
    assert.match(core.version(), /^\d+\.\d+\.\d+$/);
  });

  it("parses a fence and resolves a quoted anchor", () => {
    const r = core.parse(SINGLE);
    assert.strictEqual(r.fences.length, 1);
    assert.strictEqual(r.fences[0].threads.length, 1);
    const thread = r.fences[0].threads[0];
    assert.strictEqual(thread.id, "mc-001");
    assert.strictEqual(thread.anchor.kind, "quoted");
    assert.strictEqual(thread.anchor.range.start.line, 8);
    assert.strictEqual(thread.anchor.range.start.character, 6);
    assert.strictEqual(r.diagnostics.length, 0);
  });

  it("computes the next thread id", () => {
    assert.strictEqual(core.nextThreadId(SINGLE), "mc-002");
    assert.strictEqual(core.nextThreadId("plain text\n"), "mc-001");
  });

  it("creates a thread, inserting a new fence", () => {
    const src = "Just a paragraph here.\n";
    const r = core.createThread(src, 0, 5, "paragraph", "Anna", "2026-06-05T11:00:00Z", "New.");
    assert.ok(r.ok);
    assert.strictEqual(r.newThreadId, "mc-001");
    assert.strictEqual(r.edits.length, 1);
  });

  it("adds a reply", () => {
    const r = core.addReply(SINGLE, "mc-001", "Mark", "2026-06-05T09:00:00Z", "A reply.");
    assert.ok(r.ok);
    const after = applyEdits(SINGLE, r.edits);
    const parsed = core.parse(after);
    assert.strictEqual(parsed.fences[0].threads[0].comments.length, 2);
  });

  it("resolves and reopens a thread", () => {
    let r = core.setThreadStatus(SINGLE, "mc-001", true, "Sam", "2026-06-05T10:00:00Z");
    let after = applyEdits(SINGLE, r.edits);
    assert.strictEqual(core.parse(after).fences[0].threads[0].status, "resolved");
    r = core.setThreadStatus(after, "mc-001", false, undefined, undefined);
    after = applyEdits(after, r.edits);
    assert.strictEqual(core.parse(after).fences[0].threads[0].status, "open");
  });

  it("edits a comment", () => {
    const r = core.editComment(SINGLE, "mc-001", 0, "Edited.");
    const after = applyEdits(SINGLE, r.edits);
    assert.strictEqual(core.parse(after).fences[0].threads[0].comments[0].text, "Edited.");
  });

  it("deletes the last comment and removes the fence", () => {
    const r = core.deleteComment(SINGLE, "mc-001", 0);
    const after = applyEdits(SINGLE, r.edits);
    assert.ok(!after.includes("MarkdownComments"));
  });

  it("rejects edits to unknown threads", () => {
    const r = core.addReply(SINGLE, "mc-999", "X", "2026-06-05T09:00:00Z", "hi");
    assert.strictEqual(r.ok, false);
    assert.ok(r.rejected);
  });

  it("flags duplicate ids", () => {
    const dup = SINGLE + "\n" + SINGLE;
    const diags = core.validate(dup);
    assert.ok(diags.some((d) => d.code === "duplicateId"));
  });

  it("flags invalid yaml", () => {
    const bad = doc("```MarkdownComments", "- id: [broken", "```", "Para.");
    const diags = core.validate(bad);
    assert.ok(diags.some((d) => d.code === "invalidYaml"));
  });

  it("flags git conflict markers", () => {
    const conflicted = doc(
      "<<<<<<< ours",
      "```MarkdownComments",
      "- id: mc-001",
      "  comments: []",
      "```",
      "=======",
      "x",
      ">>>>>>> theirs",
      "Para."
    );
    const diags = core.validate(conflicted);
    assert.ok(diags.some((d) => d.code === "conflictMarkers"));
  });

  it("surfaces needs-reattach when a quote is missing", () => {
    const missing = doc(
      "```MarkdownComments",
      "- id: mc-001",
      '  quote: "absent text"',
      "  comments:",
      "    - by: A",
      '      at: "2026-06-05T08:03:51Z"',
      "      text: hi",
      "```",
      "Hello world here."
    );
    const r = core.parse(missing);
    assert.strictEqual(r.fences[0].threads[0].anchor.kind, "needsReattach");
  });
});

// Apply EditResult edits (LSP ranges) to a string for assertions. JS strings are
// UTF-16, matching the core's character units.
function applyEdits(src, edits) {
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "\n") {
      lineStarts.push(i + 1);
    }
  }
  const offset = (pos) => lineStarts[pos.line] + pos.character;
  const sorted = [...edits].sort((a, b) => offset(b.range.start) - offset(a.range.start));
  let out = src;
  for (const e of sorted) {
    out = out.slice(0, offset(e.range.start)) + e.newText + out.slice(offset(e.range.end));
  }
  return out;
}
