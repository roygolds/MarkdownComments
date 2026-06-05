const assert = require("assert");
const path = require("path");
const vscode = require("vscode");

const EXT_ID = "markdowncomments.markdowncomments";
const fixtures = path.resolve(__dirname, "..", "fixtures");

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openMarkdown(file) {
  const uri = vscode.Uri.file(path.join(fixtures, file));
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
  return doc;
}

describe("MarkdownComments extension", () => {
  it("activates and exposes the Markdown-it plugin", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, "extension should be installed");
    const api = await ext.activate();
    assert.strictEqual(typeof api.extendMarkdownIt, "function");
  });

  it("registers its commands", async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      "markdownComments.addComment",
      "markdownComments.reply",
      "markdownComments.resolve",
      "markdownComments.reattach",
      "markdownComments.toggleResolved",
      "markdownComments.openPreview"
    ]) {
      assert.ok(commands.includes(id), `missing command ${id}`);
    }
  });

  it("publishes diagnostics for invalid YAML", async () => {
    const doc = await openMarkdown("invalid.md");
    let diags = [];
    for (let i = 0; i < 30; i++) {
      diags = vscode.languages
        .getDiagnostics(doc.uri)
        .filter((d) => d.source === "MarkdownComments");
      if (diags.length > 0) {
        break;
      }
      await wait(200);
    }
    assert.ok(
      diags.some((d) => d.code === "invalidYaml"),
      "expected an invalidYaml diagnostic"
    );
  });

  it("renders a comment fence as HTML in the preview plugin", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    // markdown-it is a devDependency, so this must resolve in CI; failing to
    // load it should fail the test loudly rather than silently skip coverage.
    const MarkdownIt = require("markdown-it");
    const md = new MarkdownIt();
    api.extendMarkdownIt(md);
    const src =
      "```MarkdownComments\n- id: mc-001\n  comments:\n    - by: A\n      at: \"2026-06-05T08:03:51Z\"\n      text: hello preview\n```\nParagraph.\n";
    const html = md.render(src);
    assert.ok(html.includes("hello preview"), "preview should render comment text");
    assert.ok(html.includes("markdown-comments"), "preview should wrap comments in a container");
  });

  it("HTML-escapes hostile comment content in the preview plugin", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    const MarkdownIt = require("markdown-it");
    const md = new MarkdownIt();
    api.extendMarkdownIt(md);
    const src =
      "```MarkdownComments\n" +
      "- id: mc-001\n" +
      '  quote: "\\"><img src=x onerror=alert(1)>"\n' +
      "  comments:\n" +
      "    - by: A\n" +
      '      at: "2026-06-05T08:03:51Z"\n' +
      '      text: "<script>alert(1)</script>"\n' +
      "```\nParagraph.\n";
    const html = md.render(src);
    assert.ok(
      html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"),
      "comment text must be HTML-escaped"
    );
    assert.ok(!html.includes("<script>alert(1)</script>"), "raw <script> must not appear");
    assert.ok(!html.includes("<img src=x onerror"), "raw <img> from quote must not appear");
  });

  it("renders interactive cards with action buttons and data attributes", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    assert.strictEqual(typeof api.applyMarkdownCommentsPlugin, "function");
    const MarkdownIt = require("markdown-it");
    const md = new MarkdownIt({ html: false });
    api.applyMarkdownCommentsPlugin(md, { interactive: true });
    const src =
      "```MarkdownComments\n- id: mc-001\n  comments:\n    - by: A\n      at: \"2026-06-05T08:03:51Z\"\n      text: needs work\n```\nParagraph.\n";
    const html = md.render(src);
    assert.ok(html.includes('data-thread-id="mc-001"'), "thread id data attribute");
    assert.ok(html.includes('data-comment-index="0"'), "comment index data attribute");
    assert.ok(html.includes('data-action="reply"'), "reply button present");
    assert.ok(html.includes('data-action="edit"'), "edit button present");
    assert.ok(html.includes('data-action="resolve"'), "resolve button present");
    assert.ok(html.includes('data-action="delete-thread"'), "delete-thread button present");
  });

  it("does not emit action buttons in the read-only built-in preview", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    const MarkdownIt = require("markdown-it");
    const md = new MarkdownIt();
    api.extendMarkdownIt(md);
    const src =
      "```MarkdownComments\n- id: mc-001\n  comments:\n    - by: A\n      at: \"2026-06-05T08:03:51Z\"\n      text: read only\n```\nParagraph.\n";
    const html = md.render(src);
    assert.ok(!html.includes('data-action="reply"'), "no reply button in built-in preview");
    assert.ok(!html.includes('data-action="edit"'), "no edit button in built-in preview");
  });

  it("opens the interactive comments preview panel", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    await ext.activate();
    await openMarkdown("sample.md");
    await vscode.commands.executeCommand("markdownComments.openPreview");
    let found = false;
    for (let i = 0; i < 25; i++) {
      found = vscode.window.tabGroups.all.some((group) =>
        group.tabs.some(
          (tab) =>
            tab.input instanceof vscode.TabInputWebview &&
            String(tab.label).startsWith("Comments:")
        )
      );
      if (found) {
        break;
      }
      await wait(150);
    }
    assert.ok(found, "a Comments preview webview tab should be open");
  });

  // --- Pure message-pipeline logic (validation, stale-guard, arg wiring) -----

  function msg(extra) {
    return Object.assign(
      { threadId: "mc-001", docVersion: 3, uri: "file:///doc.md" },
      extra
    );
  }

  it("validates inbound webview messages and rejects hostile input", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    const v = api.validateInboundMessage;

    assert.ok(v(msg({ type: "resolve" })), "valid resolve accepted");
    assert.ok(v(msg({ type: "reply", body: "hi" })), "valid reply accepted");
    assert.ok(
      v(msg({ type: "edit", commentIndex: 0, newText: "x" })),
      "valid edit accepted"
    );

    assert.strictEqual(v(null), undefined, "null rejected");
    assert.strictEqual(v(msg({ type: "nope" })), undefined, "unknown type rejected");
    assert.strictEqual(
      v({ type: "resolve", threadId: "mc-001", uri: "file:///doc.md" }),
      undefined,
      "missing docVersion rejected"
    );
    assert.strictEqual(
      v(msg({ type: "resolve", docVersion: 1.5 })),
      undefined,
      "non-integer docVersion rejected"
    );
    assert.strictEqual(
      v(msg({ type: "resolve", uri: "" })),
      undefined,
      "empty uri rejected"
    );
    assert.strictEqual(
      v(msg({ type: "resolve", threadId: "x".repeat(201) })),
      undefined,
      "oversized threadId rejected"
    );
    assert.strictEqual(
      v(msg({ type: "reply", body: "x".repeat(100001) })),
      undefined,
      "oversized body rejected"
    );
    assert.strictEqual(
      v(msg({ type: "reply", body: "" })),
      undefined,
      "empty body rejected"
    );
    assert.strictEqual(
      v(msg({ type: "edit", commentIndex: -1, newText: "x" })),
      undefined,
      "negative comment index rejected"
    );
    assert.strictEqual(
      v(msg({ type: "deleteComment", commentIndex: 2.2 })),
      undefined,
      "non-integer comment index rejected"
    );
  });

  it("guards edits by uri and document version", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    const g = api.evaluateLiveGuard;
    const panelUri = "file:///doc.md";

    assert.strictEqual(
      g({ msgUri: panelUri, panelUri, doc: { version: 3 }, msgVersion: 3 }),
      "ok"
    );
    assert.strictEqual(
      g({ msgUri: "file:///other.md", panelUri, doc: { version: 3 }, msgVersion: 3 }),
      "wrongUri"
    );
    assert.strictEqual(
      g({ msgUri: panelUri, panelUri, doc: undefined, msgVersion: 3 }),
      "noDocument"
    );
    assert.strictEqual(
      g({ msgUri: panelUri, panelUri, doc: { version: 4 }, msgVersion: 3 }),
      "staleVersion"
    );
  });

  it("computes correct core edits for each panel operation", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    const computeEdit = api.computeEdit;
    const core = require(path.join(__dirname, "..", "..", "native", "mdc", "mdc_wasm.js"));

    const baseDoc =
      "```MarkdownComments\n" +
      "- id: mc-001\n" +
      "  comments:\n" +
      "    - by: A\n" +
      '      at: "2026-06-05T08:03:51Z"\n' +
      "      text: First note.\n" +
      "```\n" +
      "Target paragraph.\n";
    const id = { by: "Reviewer", at: "2026-06-05T09:00:00Z" };
    const m = (extra) =>
      Object.assign({ threadId: "mc-001", docVersion: 0, uri: "file:///doc.md" }, extra);

    const replied = applyCoreEdits(
      baseDoc,
      computeEdit(core, baseDoc, m({ type: "reply", body: "A reply." }), id)
    );
    assert.ok(replied.includes("A reply."), "reply text added");
    assert.ok(replied.includes("Reviewer"), "reply author recorded");

    const edited = applyCoreEdits(
      baseDoc,
      computeEdit(core, baseDoc, m({ type: "edit", commentIndex: 0, newText: "Updated." }), {})
    );
    assert.ok(edited.includes("Updated."), "comment text updated");
    assert.ok(!edited.includes("First note."), "old comment text replaced");

    const resolved = applyCoreEdits(
      baseDoc,
      computeEdit(core, baseDoc, m({ type: "resolve" }), id)
    );
    assert.ok(/status:\s*resolved/.test(resolved), "thread marked resolved");

    const reopened = applyCoreEdits(
      resolved,
      computeEdit(core, resolved, m({ type: "reopen" }), {})
    );
    assert.ok(!/status:\s*resolved/.test(reopened), "thread reopened");

    const threadGone = applyCoreEdits(
      baseDoc,
      computeEdit(core, baseDoc, m({ type: "deleteThread" }), {})
    );
    assert.ok(!threadGone.includes("MarkdownComments"), "fence removed with the only thread");
  });

  it("escapes hostile content (text, author, and ids) in interactive cards", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    const MarkdownIt = require("markdown-it");
    const md = new MarkdownIt({ html: false });
    api.applyMarkdownCommentsPlugin(md, { interactive: true });
    const src =
      "```MarkdownComments\n" +
      '- id: "mc-001"\n' +
      '  quote: "\\"><img src=x onerror=alert(1)>"\n' +
      "  comments:\n" +
      '    - by: "<b>evil</b>"\n' +
      '      at: "2026-06-05T08:03:51Z"\n' +
      '      text: "<script>alert(1)</script>"\n' +
      "```\nParagraph.\n";
    const html = md.render(src);
    assert.ok(!html.includes("<script>alert(1)</script>"), "raw <script> must not appear");
    assert.ok(!html.includes("<img src=x onerror"), "raw <img> from quote must not appear");
    assert.ok(!html.includes("<b>evil</b>"), "raw author markup must not appear");
    assert.ok(html.includes("&lt;b&gt;evil&lt;/b&gt;"), "author markup escaped");
  });

  it("renders invalid fence payloads as escaped raw text, never dropped", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    const MarkdownIt = require("markdown-it");
    const md = new MarkdownIt({ html: false });
    api.applyMarkdownCommentsPlugin(md, { interactive: true });
    const src = "```MarkdownComments\n: not: valid: yaml: <script>x</script>\n```\nP.\n";
    const html = md.render(src);
    assert.ok(html.includes("markdown-comments--invalid"), "invalid block rendered");
    assert.ok(!html.includes("<script>x</script>"), "raw payload escaped");
  });

  it("renders resolved threads with a resolved badge and Reopen action", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    const MarkdownIt = require("markdown-it");
    const md = new MarkdownIt({ html: false });
    api.applyMarkdownCommentsPlugin(md, { interactive: true });
    const src =
      "```MarkdownComments\n" +
      "- id: mc-001\n" +
      "  status: resolved\n" +
      "  comments:\n" +
      "    - by: A\n" +
      '      at: "2026-06-05T08:03:51Z"\n' +
      "      text: done\n" +
      "```\nParagraph.\n";
    const html = md.render(src);
    assert.ok(html.includes('data-status="resolved"'), "thread marked resolved in markup");
    assert.ok(html.includes("mdc-badge--resolved"), "resolved badge present");
    assert.ok(html.includes('data-action="reopen"'), "reopen action present");
    assert.ok(!html.includes('data-action="resolve"'), "resolve action absent when resolved");
  });

  it("assigns per-comment indices across a multi-comment thread", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    const MarkdownIt = require("markdown-it");
    const md = new MarkdownIt({ html: false });
    api.applyMarkdownCommentsPlugin(md, { interactive: true });
    const src =
      "```MarkdownComments\n" +
      "- id: mc-001\n" +
      "  comments:\n" +
      "    - by: A\n" +
      '      at: "2026-06-05T08:03:51Z"\n' +
      "      text: one\n" +
      "    - by: B\n" +
      '      at: "2026-06-05T08:04:00Z"\n' +
      "      text: two\n" +
      "```\nParagraph.\n";
    const html = md.render(src);
    assert.ok(html.includes('data-comment-index="0"'), "first comment index");
    assert.ok(html.includes('data-comment-index="1"'), "second comment index");
  });
});

// Apply a core EditResult's text edits to a string (offsets from LSP positions,
// applied right-to-left so earlier ranges stay valid).
function applyCoreEdits(text, result) {
  assert.ok(result.ok, "edit result should be ok: " + (result.rejected || ""));
  const offsetAt = (pos) => {
    const lines = text.split("\n");
    let off = 0;
    for (let i = 0; i < pos.line; i++) {
      off += lines[i].length + 1;
    }
    return off + pos.character;
  };
  const edits = result.edits
    .map((e) => ({ s: offsetAt(e.range.start), e: offsetAt(e.range.end), t: e.newText }))
    .sort((a, b) => b.s - a.s);
  let out = text;
  for (const ed of edits) {
    out = out.slice(0, ed.s) + ed.t + out.slice(ed.e);
  }
  return out;
}
