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
      "markdownComments.toggleResolved"
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
    let md;
    try {
      const MarkdownIt = require("markdown-it");
      md = new MarkdownIt();
    } catch {
      return; // markdown-it isn't a runtime dependency; skip when unavailable.
    }
    api.extendMarkdownIt(md);
    const src =
      "```MarkdownComments\n- id: mc-001\n  comments:\n    - by: A\n      at: \"2026-06-05T08:03:51Z\"\n      text: hello preview\n```\nParagraph.\n";
    const html = md.render(src);
    assert.ok(html.includes("hello preview"), "preview should render comment text");
    assert.ok(html.includes("markdown-comments"), "preview should wrap comments in a container");
  });
});
