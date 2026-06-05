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

  it("contributes the comments sidebar view", () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const contributes = ext.packageJSON.contributes;
    const containers = contributes.viewsContainers.activitybar;
    assert.ok(
      containers.some((c) => c.id === "markdownComments"),
      "activity-bar container contributed"
    );
    const views = contributes.views.markdownComments;
    assert.ok(views, "views registered under the markdownComments container");
    const view = views.find((v) => v.id === "markdownComments.sidebar");
    assert.ok(view, "sidebar view contributed");
    assert.strictEqual(view.type, "webview", "sidebar is a webview view");
  });

  it("exposes renderDocumentComments that renders only interactive cards", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    assert.strictEqual(typeof api.renderDocumentComments, "function");
    const src =
      "# Title\n\n" +
      "```MarkdownComments\n" +
      "- id: mc-001\n" +
      "  comments:\n" +
      "    - by: A\n" +
      '      at: "2026-06-05T08:03:51Z"\n' +
      "      text: hello\n" +
      "```\nBody paragraph.\n";
    const html = api.renderDocumentComments(src);
    assert.ok(html.includes('data-thread-id="mc-001"'), "thread card rendered");
    assert.ok(html.includes('data-action="reply"'), "interactive reply action present");
    assert.ok(!html.includes("markdown-comments__label"), "no per-fence label in sidebar");
    assert.ok(!html.includes("Body paragraph."), "markdown body not rendered in sidebar");
  });

  it("renders an empty-state message when a document has no comments", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    const html = api.renderDocumentComments("# Just a heading\n\nNo comments here.\n");
    assert.ok(html.includes("mdc-sidebar__empty"), "empty-state element present");
    assert.ok(html.includes("No comments"), "empty-state message present");
  });

  it("HTML-escapes hostile content in sidebar cards", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    const src =
      "```MarkdownComments\n" +
      '- id: "mc-001"\n' +
      '  comments:\n' +
      '    - by: "<b>evil</b>"\n' +
      '      at: "2026-06-05T08:03:51Z"\n' +
      '      text: "<script>alert(1)</script>"\n' +
      "```\nParagraph.\n";
    const html = api.renderDocumentComments(src);
    assert.ok(!html.includes("<script>alert(1)</script>"), "raw <script> must not appear");
    assert.ok(!html.includes("<b>evil</b>"), "raw author markup must not appear");
  });

  it("sidebar renders an invalid fence as escaped raw text, never dropped", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    const src =
      "```MarkdownComments\n: not: valid: <script>x</script>\n```\nParagraph.\n";
    const html = api.renderDocumentComments(src);
    assert.ok(html.includes("markdown-comments--invalid"), "invalid block rendered");
    assert.ok(!html.includes("<script>x</script>"), "raw payload escaped");
    assert.ok(html.includes("&lt;script&gt;x&lt;/script&gt;"), "payload text preserved, escaped");
  });

  it("sidebar renders resolved threads with a resolved badge and Reopen, not Resolve", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    const src =
      "```MarkdownComments\n" +
      "- id: mc-001\n" +
      "  status: resolved\n" +
      "  comments:\n" +
      "    - by: A\n" +
      '      at: "2026-06-05T08:03:51Z"\n' +
      "      text: done\n" +
      "```\nParagraph.\n";
    const html = api.renderDocumentComments(src);
    assert.ok(html.includes('data-status="resolved"'), "thread marked resolved");
    assert.ok(html.includes("mdc-badge--resolved"), "resolved badge present");
    assert.ok(html.includes('data-action="reopen"'), "reopen action present");
    assert.ok(!html.includes('data-action="resolve"'), "resolve action absent when resolved");
  });

  it("sidebar renders every fence in a multi-fence document with no per-fence label", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    const src =
      "```MarkdownComments\n" +
      "- id: mc-001\n" +
      "  comments:\n" +
      "    - by: A\n" +
      '      at: "2026-06-05T08:03:51Z"\n' +
      "      text: first\n" +
      "```\nFirst paragraph.\n\n" +
      "```MarkdownComments\n" +
      "- id: mc-002\n" +
      "  comments:\n" +
      "    - by: B\n" +
      '      at: "2026-06-05T08:04:00Z"\n' +
      "      text: second\n" +
      "```\nSecond paragraph.\n";
    const html = api.renderDocumentComments(src);
    assert.ok(html.includes('data-thread-id="mc-001"'), "first fence rendered");
    assert.ok(html.includes('data-thread-id="mc-002"'), "second fence rendered");
    assert.ok(!html.includes("markdown-comments__label"), "no per-fence label in sidebar");
  });

  it("sidebar assigns per-comment indices across a multi-comment thread", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
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
    const html = api.renderDocumentComments(src);
    assert.ok(html.includes('data-comment-index="0"'), "first comment index");
    assert.ok(html.includes('data-comment-index="1"'), "second comment index");
  });

  it("sidebar renderDocumentComments preserves CRLF documents", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    const lf =
      "```MarkdownComments\n" +
      "- id: mc-001\n" +
      "  comments:\n" +
      "    - by: A\n" +
      '      at: "2026-06-05T08:03:51Z"\n' +
      "      text: hello\n" +
      "```\nParagraph.\n";
    const crlf = lf.replace(/\n/g, "\r\n");
    const html = api.renderDocumentComments(crlf);
    assert.ok(html.includes('data-thread-id="mc-001"'), "thread rendered for CRLF doc");
    assert.ok(html.includes('data-action="reply"'), "interactive actions rendered for CRLF doc");
  });

  it("selectSidebarBody returns the three provider states", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    assert.strictEqual(typeof api.selectSidebarBody, "function");

    const noTarget = api.selectSidebarBody(false, undefined);
    assert.ok(noTarget.includes("mdc-sidebar__empty"), "no-target is an empty state");
    assert.ok(noTarget.includes("Open a Markdown file"), "no-target message");

    const noDoc = api.selectSidebarBody(true, undefined);
    assert.ok(noDoc.includes("mdc-sidebar__empty"), "no-document is an empty state");
    assert.ok(noDoc.includes("Open the document in an editor"), "no-document message");

    const withDoc = api.selectSidebarBody(
      true,
      "```MarkdownComments\n- id: mc-001\n  comments:\n    - by: A\n      at: \"2026-06-05T08:03:51Z\"\n      text: hi\n```\nP.\n"
    );
    assert.ok(withDoc.includes('data-thread-id="mc-001"'), "with-document renders cards");
  });

  it("findThreadRange resolves a thread's anchored block and rejects unknown ids", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    assert.strictEqual(typeof api.findThreadRange, "function");
    const src =
      "```MarkdownComments\n" +
      "- id: mc-001\n" +
      "  comments:\n" +
      "    - by: A\n" +
      '      at: "2026-06-05T08:03:51Z"\n' +
      "      text: hi\n" +
      "```\n" +
      "Anchored paragraph.\n";
    const range = api.findThreadRange(src, "mc-001");
    assert.ok(range, "range found for known thread");
    assert.strictEqual(typeof range.start.line, "number", "range has a numeric start line");
    // The anchored content is the paragraph that follows the 7-line fence.
    assert.ok(range.start.line >= 6, "range points at or past the anchored block");
    assert.strictEqual(api.findThreadRange(src, "mc-404"), undefined, "unknown id yields undefined");
  });

  it("parseRevealMessage accepts valid reveal messages and rejects hostile input", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    assert.deepStrictEqual(
      api.parseRevealMessage({ type: "reveal", threadId: "mc-001", uri: "file:///a.md" }),
      { type: "reveal", threadId: "mc-001", uri: "file:///a.md" }
    );
    assert.strictEqual(
      api.parseRevealMessage({ type: "reply", threadId: "mc-001", uri: "file:///a.md" }),
      undefined
    );
    assert.strictEqual(api.parseRevealMessage({ type: "reveal", uri: "file:///a.md" }), undefined);
    assert.strictEqual(api.parseRevealMessage({ type: "reveal", threadId: "mc-001" }), undefined);
    assert.strictEqual(
      api.parseRevealMessage({ type: "reveal", threadId: "", uri: "file:///a.md" }),
      undefined
    );
    assert.strictEqual(
      api.parseRevealMessage({ type: "reveal", threadId: "x".repeat(201), uri: "file:///a.md" }),
      undefined
    );
    assert.strictEqual(api.parseRevealMessage(null), undefined);
  });

  it("built-in preview suppresses inline comment cards while the sidebar is visible", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    const MarkdownIt = require("markdown-it");
    const md = new MarkdownIt();
    api.extendMarkdownIt(md);
    const src =
      "```MarkdownComments\n- id: mc-001\n  comments:\n    - by: A\n      at: \"2026-06-05T08:03:51Z\"\n      text: hi\n```\nParagraph.\n";
    try {
      assert.ok(md.render(src).includes('data-thread-id="mc-001"'), "cards shown when sidebar hidden");
      api.setSidebarVisible(true);
      assert.ok(api.isSidebarVisible(), "sidebar reported visible");
      const hidden = md.render(src);
      assert.ok(!hidden.includes('data-thread-id="mc-001"'), "cards hidden when sidebar visible");
      assert.ok(hidden.includes("Paragraph."), "the anchored Markdown body still renders");
    } finally {
      api.setSidebarVisible(false);
    }
    assert.ok(md.render(src).includes('data-thread-id="mc-001"'), "cards return when sidebar hidden again");
  });

  it("interactive panel keeps comment cards even while the sidebar is visible", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    const MarkdownIt = require("markdown-it");
    const md = new MarkdownIt({ html: false });
    api.applyMarkdownCommentsPlugin(md, { interactive: true });
    const src =
      "```MarkdownComments\n- id: mc-001\n  comments:\n    - by: A\n      at: \"2026-06-05T08:03:51Z\"\n      text: hi\n```\nParagraph.\n";
    try {
      api.setSidebarVisible(true);
      const html = md.render(src);
      assert.ok(html.includes('data-thread-id="mc-001"'), "panel still shows cards");
      assert.ok(html.includes('data-action="reply"'), "panel stays interactive");
    } finally {
      api.setSidebarVisible(false);
    }
  });

  it("routes a sidebar reveal to the open preview panel and reports a miss otherwise", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();
    const doc = await openMarkdown("sample.md");
    await vscode.commands.executeCommand("markdownComments.openPreview");
    let routed = false;
    for (let i = 0; i < 25; i++) {
      if (api.revealThreadInPanel(doc.uri, "mc-001")) {
        routed = true;
        break;
      }
      await wait(150);
    }
    assert.ok(routed, "reveal routed to the open preview panel for the document");
    const other = vscode.Uri.file("/no/such/document.md");
    assert.strictEqual(
      api.revealThreadInPanel(other, "mc-001"),
      false,
      "reveal reports a miss when no panel shows that document"
    );
  });

  it("revealThread scrolls the source editor to bring the anchored line into view", async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const api = await ext.activate();

    // A long document so the anchored content sits well below the first
    // viewport: revealing it must actually scroll the editor, which is exactly
    // what drives the built-in preview's scroll-sync.
    const filler = Array.from({ length: 200 }, (_, i) => `Filler line ${i + 1}.`).join("\n");
    const fence =
      "```MarkdownComments\n" +
      "- id: mc-deep\n" +
      '  quote: "anchor target phrase"\n' +
      "  comments:\n" +
      "    - by: Tester\n" +
      '      at: "2026-06-05T08:03:51Z"\n' +
      "      text: deep comment\n" +
      "```\n";
    const content = `${filler}\n${fence}This paragraph mentions the anchor target phrase here.\n`;

    const doc = await vscode.workspace.openTextDocument({ content, language: "markdown" });
    const editor = await vscode.window.showTextDocument(doc);

    const targetLine = api.findThreadRange(doc.getText(), "mc-deep").start.line;
    assert.ok(targetLine > 100, "the anchored line should be deep in the document");

    // Park the editor at the very top so a no-op reveal would be detectable.
    editor.revealRange(new vscode.Range(0, 0, 0, 0), vscode.TextEditorRevealType.AtTop);
    await wait(150);

    await api.revealThread(doc.uri, "mc-deep");

    let visible = false;
    for (let i = 0; i < 20; i++) {
      visible = editor.visibleRanges.some(
        (r) => r.start.line <= targetLine && targetLine <= r.end.line
      );
      if (visible) {
        break;
      }
      await wait(150);
    }
    assert.ok(visible, "the anchored line should be scrolled into the editor's viewport");
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
