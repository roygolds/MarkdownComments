// Unit tests guarding the sidebar hover/selection UX feature in the shipped
// webview assets (panel.css / panel.js).
// Run with: npm run test:unit
//
// Background: the webview runtime JS cannot be driven by the headless test host
// (the integration harness only captures the rendered HTML string; it never
// executes panel.js). So instead of behaviour, these tests assert the feature
// is present in the shipped assets via stable tokens (class names, CSS var
// names, function names) rather than exact whitespace/formatting.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const panelCss = fs.readFileSync(
  path.join(__dirname, "..", "..", "media", "panel.css"),
  "utf8"
);
const panelJs = fs.readFileSync(
  path.join(__dirname, "..", "..", "media", "panel.js"),
  "utf8"
);

describe("sidebar hover/selection CSS", () => {
  it("defines a .mdc-thread:hover rule using --vscode-list-hoverBackground", () => {
    assert.ok(panelCss.includes(".mdc-thread:hover"), "missing .mdc-thread:hover rule");
    assert.ok(
      panelCss.includes("--vscode-list-hoverBackground"),
      "hover rule should reference --vscode-list-hoverBackground"
    );
  });

  it("defines a .mdc-thread--selected rule using --vscode-focusBorder", () => {
    assert.ok(
      panelCss.includes(".mdc-thread--selected"),
      "missing .mdc-thread--selected rule"
    );
    assert.ok(
      panelCss.includes("--vscode-focusBorder"),
      "selected rule should reference --vscode-focusBorder"
    );
  });
});

describe("sidebar selection JS", () => {
  it("references the mdc-thread--selected class", () => {
    assert.ok(
      panelJs.includes("mdc-thread--selected"),
      "panel.js should reference the mdc-thread--selected class"
    );
  });

  it("defines the selectThread and applySelected helpers", () => {
    assert.ok(
      panelJs.includes("function selectThread"),
      "panel.js should define selectThread"
    );
    assert.ok(
      panelJs.includes("function applySelected"),
      "panel.js should define applySelected"
    );
  });

  it("invokes selectThread from both reveal paths", () => {
    assert.ok(
      panelJs.includes("selectThread(id)"),
      "selectThread(id) should be called from the click reveal path"
    );
    assert.ok(
      panelJs.includes("selectThread(msg.threadId)"),
      "selectThread(msg.threadId) should be called from the revealThread handler"
    );
  });
});
