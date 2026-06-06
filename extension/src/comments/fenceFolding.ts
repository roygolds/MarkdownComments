// Source-editor folding for ```MarkdownComments fences. Registers a
// FoldingRangeProvider so each inline-YAML fence is collapsible, and auto-folds
// those fences the first time a Markdown document is shown so the prose stays
// readable. This ONLY affects the Markdown source editor — the preview and
// sidebar are untouched.
//
// Auto-fold runs ONCE per document (tracked in `autoFolded`, cleared on close so
// reopening re-folds). Fences the user creates later (e.g. by adding a comment)
// are intentionally NOT auto-folded, so a freshly added comment stays open for
// editing.

import * as vscode from "vscode";
import { core } from "../core/wasmBridge";
import type { FenceView } from "../core/types";
import { fenceFoldRegions, fenceFoldStartLines } from "./fenceFoldRanges";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FenceFolding implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  // Documents we have already issued an auto-fold for (once-per-document).
  private readonly autoFolded = new Set<string>();
  // Documents with an in-flight readiness-polling loop, to guard against
  // concurrent loops for the same document.
  private readonly pending = new Set<string>();

  constructor() {
    this.disposables.push(
      vscode.languages.registerFoldingRangeProvider(
        { language: "markdown" },
        { provideFoldingRanges: (doc) => this.provideFoldingRanges(doc) }
      ),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.scheduleAutoFold(editor);
        }
      }),
      vscode.workspace.onDidCloseTextDocument((doc) => {
        const key = doc.uri.toString();
        this.autoFolded.delete(key);
        this.pending.delete(key);
      })
    );
    for (const editor of vscode.window.visibleTextEditors) {
      this.scheduleAutoFold(editor);
    }
  }

  private spans(document: vscode.TextDocument): Array<{ startLine: number; endLine: number }> {
    if (document.languageId !== "markdown") {
      return [];
    }
    let fences: FenceView[];
    try {
      fences = core.parse(document.getText()).fences;
    } catch {
      return [];
    }
    return fences.map((f) => ({ startLine: f.range.start.line, endLine: f.range.end.line }));
  }

  private provideFoldingRanges(document: vscode.TextDocument): vscode.FoldingRange[] {
    return fenceFoldRegions(this.spans(document)).map(
      (r) => new vscode.FoldingRange(r.start, r.end, vscode.FoldingRangeKind.Region)
    );
  }

  private scheduleAutoFold(editor: vscode.TextEditor): void {
    const document = editor.document;
    if (document.languageId !== "markdown") {
      return;
    }
    const key = document.uri.toString();
    // Cheap synchronous gate: skip if already folded or a poll loop is running.
    if (this.autoFolded.has(key) || this.pending.has(key)) {
      return;
    }
    this.pending.add(key);
    void this.autoFold(document, key);
  }

  // Readiness-aware auto-fold. The blocking issue on a cold start is that the
  // editor's folding MODEL is not built immediately, so a blind `editor.fold`
  // becomes a silent no-op. We poll the folding-range provider until ranges that
  // cover our fences are actually available (the signal that `editor.fold` will
  // work), then fold — preserving once-per-document and active-editor semantics.
  private async autoFold(document: vscode.TextDocument, key: string): Promise<void> {
    const ATTEMPTS = 40;
    const DELAY_MS = 150;
    try {
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        if (this.autoFolded.has(key)) {
          return;
        }
        const lines = fenceFoldStartLines(this.spans(document));
        if (lines.length === 0) {
          return;
        }
        const ranges =
          ((await vscode.commands.executeCommand(
            "vscode.executeFoldingRangeProvider",
            document.uri
          )) as vscode.FoldingRange[] | undefined) || [];
        const ready = ranges.some((r) => lines.includes(r.start));
        if (!ready) {
          await delay(DELAY_MS);
          continue;
        }
        // Ranges are available: fold, but only if this document is still active
        // (editor.fold targets the active editor). If it is not active, abort
        // WITHOUT marking it folded so focusing it later re-triggers the fold.
        if (vscode.window.activeTextEditor?.document.uri.toString() !== key) {
          return;
        }
        this.autoFolded.add(key);
        await vscode.commands.executeCommand("editor.fold", { selectionLines: lines });
        // Belt-and-suspenders against model lag: re-issue once more. Folding an
        // already-folded region is a harmless no-op.
        await delay(200);
        if (vscode.window.activeTextEditor?.document.uri.toString() === key) {
          await vscode.commands.executeCommand("editor.fold", { selectionLines: lines });
        }
        return;
      }
    } finally {
      this.pending.delete(key);
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
