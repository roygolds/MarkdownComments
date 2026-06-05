// Extension entry point: wires commands to the CommentManager and exposes the
// Markdown Preview plugin.

import * as vscode from "vscode";
import { CommentManager, MarkdownComment } from "./comments/commentController";
import { extendMarkdownIt } from "./preview/markdownItPlugin";
import { clearIdentityCache } from "./model/identity";

export function activate(context: vscode.ExtensionContext): { extendMarkdownIt: typeof extendMarkdownIt } {
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

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("markdownComments.authorName")) {
        clearIdentityCache();
      }
    })
  );

  return { extendMarkdownIt };
}

export function deactivate(): void {
  // Disposables are cleaned up via context.subscriptions.
}
