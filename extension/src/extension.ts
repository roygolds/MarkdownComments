// Extension entry point: wires commands to the CommentManager and exposes the
// Markdown Preview plugin.

import * as vscode from "vscode";
import { CommentManager, MarkdownComment } from "./comments/commentController";
import { extendMarkdownIt, applyMarkdownCommentsPlugin } from "./preview/markdownItPlugin";
import { CommentsPreviewPanel } from "./preview/previewPanel";
import { CommentsSidebarProvider } from "./preview/commentsSidebar";import { renderDocumentComments, selectSidebarBody } from "./preview/documentCards";
import {
  validateInboundMessage,
  evaluateLiveGuard,
  computeEdit
} from "./preview/messageValidation";
import { findThreadRange, parseRevealMessage } from "./preview/revealThread";
import { isSidebarVisible, setSidebarVisible } from "./preview/previewState";
import { clearIdentityCache } from "./model/identity";

export function activate(context: vscode.ExtensionContext): {
  extendMarkdownIt: typeof extendMarkdownIt;
  applyMarkdownCommentsPlugin: typeof applyMarkdownCommentsPlugin;
  validateInboundMessage: typeof validateInboundMessage;
  evaluateLiveGuard: typeof evaluateLiveGuard;
  computeEdit: typeof computeEdit;
  renderDocumentComments: typeof renderDocumentComments;
  selectSidebarBody: typeof selectSidebarBody;
  findThreadRange: typeof findThreadRange;
  parseRevealMessage: typeof parseRevealMessage;
  isSidebarVisible: typeof isSidebarVisible;
  setSidebarVisible: typeof setSidebarVisible;
  revealThreadInPanel: (uri: vscode.Uri, threadId: string) => boolean;
} {
  const manager = new CommentManager();
  context.subscriptions.push(manager);

  const register = (command: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(vscode.commands.registerCommand(command, handler));

  register("markdownComments.addComment", () => manager.addComment());
  register("markdownComments.reply", (reply: vscode.CommentReply) => manager.reply(reply));
  register("markdownComments.resolve", (thread: vscode.CommentThread) => manager.resolve(thread));
  register("markdownComments.reopen", (thread: vscode.CommentThread) => manager.reopen(thread));
  register("markdownComments.editComment", (comment: MarkdownComment) => manager.editComment(comment));
  register("markdownComments.saveComment", (comment: MarkdownComment) => manager.saveComment(comment));
  register("markdownComments.cancelEdit", (comment: MarkdownComment) => manager.cancelEdit(comment));
  register("markdownComments.deleteComment", (comment: MarkdownComment) => manager.deleteComment(comment));
  register("markdownComments.deleteThread", (thread: vscode.CommentThread) => manager.deleteThread(thread));
  register("markdownComments.reattach", () => manager.reattach());
  register("markdownComments.toggleResolved", () => manager.toggleResolved());
  register("markdownComments.openPreview", () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") {
      void vscode.window.showInformationMessage(
        "MarkdownComments: open a Markdown file to show its comments preview."
      );
      return;
    }
    CommentsPreviewPanel.createOrShow(context.extensionUri, editor.document);
  });

  const sidebarProvider = new CommentsSidebarProvider(context.extensionUri);
  context.subscriptions.push(
    sidebarProvider,
    vscode.window.registerWebviewViewProvider(
      CommentsSidebarProvider.viewType,
      sidebarProvider
    )
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("markdownComments.authorName")) {
        clearIdentityCache();
      }
    })
  );

  return {
    extendMarkdownIt,
    applyMarkdownCommentsPlugin,
    validateInboundMessage,
    evaluateLiveGuard,
    computeEdit,
    renderDocumentComments,
    selectSidebarBody,
    findThreadRange,
    parseRevealMessage,
    isSidebarVisible,
    setSidebarVisible,
    revealThreadInPanel: (uri, threadId) => CommentsPreviewPanel.revealThread(uri, threadId)
  };
}

export function deactivate(): void {
  // Disposables are cleaned up via context.subscriptions.
}
