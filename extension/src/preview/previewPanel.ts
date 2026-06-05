// Dedicated interactive comments preview panel.
//
// VS Code's built-in Markdown preview has no supported channel to write edits
// back to an extension, so full control (reply / edit / resolve / reopen /
// delete) lives in this dedicated webview panel instead. The panel renders the
// Markdown body (with `html:false`, so document content can never inject markup)
// plus interactive comment cards, and turns button clicks into core edit
// operations applied through the shared WorkspaceEdit path.
//
// SECURITY MODEL:
//   * Strict CSP: scripts run only with a per-render nonce; no inline/eval.
//   * No document-derived data is ever interpolated into JavaScript. The card
//     markup is produced in the host and HTML-escaped (see cardRender); the
//     webview script only reads `data-` attributes and element text.
//   * Every inbound message is validated as hostile: the action must be known,
//     string lengths are bounded, and a `docVersion` guard rejects edits that
//     were composed against a stale view of the document.
//   * Operations are serialized; a re-render is debounced after each change.

import * as vscode from "vscode";
import { randomBytes } from "crypto";
import MarkdownIt from "markdown-it";
import { applyMarkdownCommentsPlugin } from "./markdownItPlugin";
import { CommentEditController } from "./commentEditController";
import { parseRevealMessage, revealThread } from "./revealThread";

const activePreviewChanged = new vscode.EventEmitter<void>();

/**
 * Fires whenever the interactive Comments Preview panel gains or loses focus, or
 * is created/disposed. The sidebar uses this to follow the panel's source
 * document when the panel tab (a webview, not a text editor) is focused.
 */
export const onDidChangeActivePreview = activePreviewChanged.event;

export class CommentsPreviewPanel {
  private static current: CommentsPreviewPanel | undefined;

  /** The source document uri of the panel when its tab is currently focused. */
  static activeSourceUri(): vscode.Uri | undefined {
    const c = CommentsPreviewPanel.current;
    return c && c.active ? c.uri : undefined;
  }

  /**
   * If the interactive preview panel is open for `uri`, bring it forward and
   * scroll it to the given thread, then return true. Returns false when no panel
   * is showing that document, so callers can fall back to revealing the source
   * text editor. Lets a sidebar click focus the comment in the preview rather
   * than switching the user to the raw Markdown.
   */
  static revealThread(uri: vscode.Uri, threadId: string): boolean {
    const c = CommentsPreviewPanel.current;
    if (!c || c.uri.toString() !== uri.toString()) {
      return false;
    }
    c.panel.reveal(c.panel.viewColumn, true);
    void c.panel.webview.postMessage({ type: "revealThread", threadId });
    return true;
  }

  static createOrShow(extensionUri: vscode.Uri, document: vscode.TextDocument): void {
    const column = vscode.ViewColumn.Beside;
    const existing = CommentsPreviewPanel.current;
    if (existing) {
      if (existing.uri.toString() === document.uri.toString()) {
        existing.panel.reveal(column, true);
        return;
      }
      // Retarget to a different document: dispose the old webview entirely so no
      // queued messages or persisted drafts/toggles bleed across documents.
      existing.dispose();
    }
    const panel = vscode.window.createWebviewPanel(
      "markdownCommentsPreview",
      "Comments Preview",
      { viewColumn: column, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, "media")]
      }
    );
    CommentsPreviewPanel.current = new CommentsPreviewPanel(panel, extensionUri, document);
  }

  private readonly md: MarkdownIt;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly uri: vscode.Uri;
  private readonly editController: CommentEditController;
  private renderTimer: ReturnType<typeof setTimeout> | undefined;
  private active: boolean;

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri,
    document: vscode.TextDocument
  ) {
    this.uri = document.uri;
    this.active = panel.active;
    this.md = new MarkdownIt({ html: false, linkify: false, breaks: false });
    applyMarkdownCommentsPlugin(this.md, { interactive: true });
    this.editController = new CommentEditController(
      () => this.uri,
      () => this.findDocument(),
      () => this.render()
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.panel.onDidChangeViewState(
      (e) => {
        this.active = e.webviewPanel.active;
        activePreviewChanged.fire();
      },
      null,
      this.disposables
    );

    this.panel.webview.onDidReceiveMessage(
      (msg) => {
        const reveal = parseRevealMessage(msg);
        if (reveal) {
          if (reveal.uri === this.uri.toString()) {
            void revealThread(this.uri, reveal.threadId);
          }
          return;
        }
        void this.editController.handle(msg);
      },
      null,
      this.disposables
    );

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() === this.uri.toString()) {
          this.scheduleRender();
        }
      })
    );

    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (doc.uri.toString() === this.uri.toString()) {
          this.render();
        }
      })
    );

    this.render();
  }

  private findDocument(): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find(
      (d) => d.uri.toString() === this.uri.toString()
    );
  }

  private scheduleRender(): void {
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
    }
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined;
      this.render();
    }, 150);
  }

  private render(): void {
    const document = this.findDocument();
    const webview = this.panel.webview;
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "panel.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "panel.css")
    );
    const csp =
      `default-src 'none'; img-src ${webview.cspSource} https: data:; ` +
      `style-src ${webview.cspSource} 'unsafe-inline'; ` +
      `script-src 'nonce-${nonce}'; font-src ${webview.cspSource};`;

    let bodyHtml: string;
    let docVersion = -1;
    const fileName = document
      ? document.uri.path.split("/").pop() ?? "document"
      : this.uri.path.split("/").pop() ?? "document";

    if (!document) {
      bodyHtml = `<p class="mdc-panel__notice">Open <strong>${escapeText(
        fileName
      )}</strong> in an editor to view its comments.</p>`;
    } else {
      docVersion = document.version;
      const text = document.getText();
      bodyHtml = this.md.render(text);
    }

    this.panel.title = `Comments: ${fileName}`;
    this.panel.webview.html = this.htmlShell({
      csp,
      nonce,
      scriptUri: scriptUri.toString(),
      styleUri: styleUri.toString(),
      cspSource: webview.cspSource,
      docVersion,
      uri: this.uri.toString(),
      bodyHtml
    });
  }

  private htmlShell(p: {
    csp: string;
    nonce: string;
    scriptUri: string;
    styleUri: string;
    cspSource: string;
    docVersion: number;
    uri: string;
    bodyHtml: string;
  }): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${p.csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${p.styleUri}" />
  <title>Comments Preview</title>
</head>
<body data-uri="${escapeAttr(p.uri)}" data-doc-version="${p.docVersion}">
  <div class="mdc-toolbar" role="toolbar" aria-label="Comment controls">
    <button type="button" class="mdc-toolbar__btn" data-toggle="hide-comments" aria-pressed="false">Hide comments</button>
    <button type="button" class="mdc-toolbar__btn" data-toggle="collapse-comments" aria-pressed="false">Collapse all</button>
    <button type="button" class="mdc-toolbar__btn" data-toggle="hide-resolved" aria-pressed="false">Hide resolved</button>
  </div>
  <div class="mdc-panel__body">
${p.bodyHtml}
  </div>
  <script nonce="${p.nonce}" src="${p.scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    CommentsPreviewPanel.current = undefined;
    this.active = false;
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
    }
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
    this.panel.dispose();
    activePreviewChanged.fire();
  }
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function makeNonce(): string {
  return randomBytes(24).toString("base64").replace(/[^A-Za-z0-9]/g, "");
}
