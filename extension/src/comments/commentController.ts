// Bridges the VS Code Comments API to the pure mdc-core engine.
//
// On every change we re-parse the document and rebuild comment threads from the
// inline `MarkdownComments` fences. All mutations go through the core, which
// returns text edits the extension applies via WorkspaceEdit; the resulting
// document change triggers another rebuild. The editor source of truth is the
// Markdown file itself.

import * as vscode from "vscode";
import { core } from "../core/wasmBridge";
import type { FenceView, ThreadView } from "../core/types";
import { applyEditResult, toVsRange } from "./edits";
import { Decorations } from "./decorations";
import { createDiagnostics, publishDiagnostics } from "./diagnostics";
import { nowUtc, resolveAuthor } from "../model/identity";

class MarkdownComment implements vscode.Comment {
  public contextValue = "canEdit";
  public label?: string;

  constructor(
    public threadId: string,
    public index: number,
    public rawText: string,
    public author: vscode.CommentAuthorInformation,
    public mode: vscode.CommentMode,
    public parent: vscode.CommentThread,
    at: string
  ) {
    this.label = at;
  }

  get body(): vscode.MarkdownString | string {
    if (this.mode === vscode.CommentMode.Editing) {
      return this.rawText;
    }
    // Plain text only: escape Markdown so bodies never render as Markdown.
    const md = new vscode.MarkdownString();
    md.appendText(this.rawText);
    return md;
  }

  set body(_value: vscode.MarkdownString | string) {
    // VS Code writes the edited text back here while in Editing mode.
    if (typeof _value === "string") {
      this.rawText = _value;
    } else {
      this.rawText = _value.value;
    }
  }
}

export class CommentManager implements vscode.Disposable {
  private readonly controller: vscode.CommentController;
  private readonly decorations = new Decorations();
  private readonly diagnostics = createDiagnostics();
  private readonly threadsByUri = new Map<string, vscode.CommentThread[]>();
  private readonly threadIds = new WeakMap<vscode.CommentThread, string>();
  private readonly draftQuotes = new WeakMap<vscode.CommentThread, string | undefined>();
  private readonly debounce = new Map<string, NodeJS.Timeout>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.controller = vscode.comments.createCommentController(
      "markdownComments",
      "MarkdownComments"
    );
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (document) => {
        if (document.languageId !== "markdown") {
          return [];
        }
        const last = Math.max(0, document.lineCount - 1);
        return [new vscode.Range(0, 0, last, 0)];
      }
    };
    this.disposables.push(this.controller, this.decorations, this.diagnostics);

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.languageId === "markdown") {
          this.scheduleRefresh(e.document);
        }
      }),
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (doc.languageId === "markdown") {
          this.refresh(doc);
        }
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && editor.document.languageId === "markdown") {
          this.refresh(editor.document);
        }
      })
    );

    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.languageId === "markdown") {
        this.refresh(editor.document);
      }
    }
  }

  private scheduleRefresh(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const existing = this.debounce.get(key);
    if (existing) {
      clearTimeout(existing);
    }
    this.debounce.set(
      key,
      setTimeout(() => {
        this.debounce.delete(key);
        this.refresh(document);
      }, 200)
    );
  }

  /** Re-parse a document and rebuild its threads, decorations, and diagnostics. */
  refresh(document: vscode.TextDocument): void {
    const key = document.uri.toString();

    const text = document.getText();
    let result;
    try {
      result = core.parse(text);
    } catch (err) {
      // Parsing should never throw, but if the WASM boundary surfaces an
      // unexpected error we keep the previously rendered threads rather than
      // wiping the UI, and surface the failure for diagnosis.
      console.error("MarkdownComments: failed to parse document", err);
      return;
    }

    const previous = this.threadsByUri.get(key) ?? [];
    for (const t of previous) {
      t.dispose();
    }

    const showResolved = vscode.workspace
      .getConfiguration("markdownComments", document.uri)
      .get<boolean>("showResolved", true);

    const created: vscode.CommentThread[] = [];
    for (const fence of result.fences) {
      for (const thread of fence.threads) {
        const vsThread = this.buildThread(document.uri, fence, thread, showResolved);
        if (vsThread) {
          created.push(vsThread);
        }
      }
    }
    this.threadsByUri.set(key, created);

    publishDiagnostics(this.diagnostics, document.uri, result.diagnostics);

    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() === key) {
        this.decorations.apply(editor, result.fences);
      }
    }
  }

  private buildThread(
    uri: vscode.Uri,
    fence: FenceView,
    thread: ThreadView,
    showResolved: boolean
  ): vscode.CommentThread | undefined {
    const range = thread.anchor.range
      ? toVsRange(thread.anchor.range)
      : toVsRange(fence.range);
    const vsThread = this.controller.createCommentThread(uri, range, []);
    vsThread.comments = thread.comments.map(
      (c, i) =>
        new MarkdownComment(
          thread.id,
          i,
          c.text,
          { name: c.by },
          vscode.CommentMode.Preview,
          vsThread,
          c.at
        )
    );
    vsThread.canReply = true;
    this.threadIds.set(vsThread, thread.id);

    const resolved = thread.status === "resolved";
    vsThread.state = resolved
      ? vscode.CommentThreadState.Resolved
      : vscode.CommentThreadState.Unresolved;
    vsThread.contextValue = "markdownComments";

    if (thread.anchor.kind === "needsReattach") {
      vsThread.label = "Needs reattach";
    } else if (thread.quote) {
      vsThread.label = `"${thread.quote}"`;
    }

    vsThread.collapsibleState =
      resolved && !showResolved
        ? vscode.CommentThreadCollapsibleState.Collapsed
        : vscode.CommentThreadCollapsibleState.Expanded;

    return vsThread;
  }

  // --- Commands ---

  /** Start a new comment from the current editor selection. */
  async addComment(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") {
      return;
    }
    const selection = editor.selection;
    const quote = selection.isEmpty ? undefined : editor.document.getText(selection);
    const range = selection.isEmpty
      ? new vscode.Range(selection.start, selection.start)
      : new vscode.Range(selection.start, selection.end);
    const draft = this.controller.createCommentThread(editor.document.uri, range, []);
    draft.canReply = true;
    draft.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    draft.contextValue = "markdownComments";
    draft.label = quote ? `"${quote}"` : "New comment";
    this.draftQuotes.set(draft, quote);
  }

  /** Handle the reply box: create a new thread (draft) or append a reply. */
  async reply(reply: vscode.CommentReply): Promise<void> {
    const thread = reply.thread;
    const body = reply.text.trim();
    if (body.length === 0) {
      return;
    }
    const document = await vscode.workspace.openTextDocument(thread.uri);
    const src = document.getText();
    const author = await resolveAuthor(thread.uri);
    const at = nowUtc();

    const id = this.threadIds.get(thread);
    let result;
    if (id) {
      result = core.addReply(src, id, author, at, body);
    } else {
      const quote = this.draftQuotes.get(thread);
      const pos = thread.range?.start ?? new vscode.Position(0, 0);
      result = core.createThread(src, pos.line, pos.character, quote, author, at, body);
    }
    thread.dispose();
    await applyEditResult(thread.uri, result);
    this.refresh(document);
  }

  async resolve(thread: vscode.CommentThread): Promise<void> {
    await this.setStatus(thread, true);
  }

  async reopen(thread: vscode.CommentThread): Promise<void> {
    await this.setStatus(thread, false);
  }

  private async setStatus(thread: vscode.CommentThread, resolved: boolean): Promise<void> {
    const id = this.threadIds.get(thread);
    if (!id) {
      return;
    }
    const document = await vscode.workspace.openTextDocument(thread.uri);
    const src = document.getText();
    const author = resolved ? await resolveAuthor(thread.uri) : undefined;
    const at = resolved ? nowUtc() : undefined;
    const result = core.setThreadStatus(src, id, resolved, author, at);
    await applyEditResult(thread.uri, result);
    this.refresh(document);
  }

  editComment(comment: MarkdownComment): void {
    comment.mode = vscode.CommentMode.Editing;
    comment.parent.comments = [...comment.parent.comments];
  }

  async saveComment(comment: MarkdownComment): Promise<void> {
    const document = await vscode.workspace.openTextDocument(comment.parent.uri);
    const src = document.getText();
    const result = core.editComment(src, comment.threadId, comment.index, comment.rawText);
    comment.mode = vscode.CommentMode.Preview;
    await applyEditResult(comment.parent.uri, result);
    this.refresh(document);
  }

  cancelEdit(comment: MarkdownComment): void {
    comment.mode = vscode.CommentMode.Preview;
    comment.parent.comments = [...comment.parent.comments];
  }

  async deleteComment(comment: MarkdownComment): Promise<void> {
    const document = await vscode.workspace.openTextDocument(comment.parent.uri);
    const src = document.getText();
    const result = core.deleteComment(src, comment.threadId, comment.index);
    await applyEditResult(comment.parent.uri, result);
    this.refresh(document);
  }

  async deleteThread(thread: vscode.CommentThread): Promise<void> {
    const id = this.threadIds.get(thread);
    if (!id) {
      thread.dispose();
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      `Delete comment thread ${id}? This removes all of its comments.`,
      { modal: true },
      "Delete"
    );
    if (confirmed !== "Delete") {
      return;
    }
    const document = await vscode.workspace.openTextDocument(thread.uri);
    const src = document.getText();
    const result = core.deleteThread(src, id);
    await applyEditResult(thread.uri, result);
    this.refresh(document);
  }

  /** Reattach a thread that lost its anchor to the current editor selection. */
  async reattach(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== "markdown") {
      return;
    }
    const src = editor.document.getText();
    let parsed;
    try {
      parsed = core.parse(src);
    } catch (err) {
      console.error("MarkdownComments: failed to parse document", err);
      void vscode.window.showErrorMessage("MarkdownComments: could not parse this document.");
      return;
    }
    const candidates: ThreadView[] = [];
    for (const fence of parsed.fences) {
      for (const thread of fence.threads) {
        candidates.push(thread);
      }
    }
    if (candidates.length === 0) {
      void vscode.window.showInformationMessage("MarkdownComments: no threads to reattach.");
      return;
    }
    const pick = await vscode.window.showQuickPick(
      candidates.map((t) => ({
        label: t.id,
        description:
          t.anchor.kind === "needsReattach" ? "needs reattach" : t.quote ?? "whole block",
        detail: t.comments[0]?.text,
        id: t.id
      })),
      { placeHolder: "Select a thread to reattach to the current selection" }
    );
    if (!pick) {
      return;
    }
    const selection = editor.selection;
    const quote = selection.isEmpty
      ? undefined
      : editor.document.getText(selection);
    const pos = selection.start;
    const result = core.reattachThread(src, pick.id, quote, pos.line, pos.character);
    await applyEditResult(editor.document.uri, result);
    this.refresh(editor.document);
  }

  async toggleResolved(): Promise<void> {
    const config = vscode.workspace.getConfiguration("markdownComments");
    const current = config.get<boolean>("showResolved", true);
    await config.update("showResolved", !current, vscode.ConfigurationTarget.Workspace);
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.languageId === "markdown") {
        this.refresh(editor.document);
      }
    }
  }

  dispose(): void {
    for (const timer of this.debounce.values()) {
      clearTimeout(timer);
    }
    for (const threads of this.threadsByUri.values()) {
      for (const t of threads) {
        t.dispose();
      }
    }
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

export { MarkdownComment };
