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

function isLineHidden(editor: vscode.TextEditor, line: number): boolean {
  return !editor.visibleRanges.some((r) => line >= r.start.line && line <= r.end.line);
}

// True when the FIRST fence collapsed but a non-fence line just BELOW it stayed
// visible — i.e. the enclosing heading region was NOT the thing that folded.
function onlyFenceFolded(
  editor: vscode.TextEditor,
  spans: Array<{ startLine: number; endLine: number }>
): boolean {
  const first = spans[0];
  if (!first) {
    return true;
  }
  const inner = first.startLine + 1; // YAML line inside the fence
  if (inner > first.endLine || !isLineHidden(editor, inner)) {
    return false; // the fence itself didn't collapse
  }
  // Sentinel: a line that is hidden if the heading collapsed but visible if only
  // the fence collapsed. Prefer the line just below the fence (inside the heading
  // when a heading spans past the fence — the exact "everything collapsed" case).
  const lineCount = editor.document.lineCount;
  let sentinel = -1;
  if (first.endLine + 1 < lineCount) {
    sentinel = first.endLine + 1;
  } else if (first.startLine - 1 >= 0) {
    sentinel = first.startLine - 1;
  }
  if (sentinel >= 0 && isLineHidden(editor, sentinel)) {
    return false; // a non-fence neighbour got folded => heading hijack
  }
  return true;
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

  // Readiness-aware, scope-verifying auto-fold. Two problems on a cold start:
  //  1. The editor's folding MODEL is not built immediately, so a blind
  //     `editor.fold` is a no-op until the provider's ranges are incorporated.
  //  2. Even after `vscode.executeFoldingRangeProvider` returns our fence ranges,
  //     the editor's LIVE fold model can still only know the built-in Markdown
  //     HEADING region. In that window `editor.fold` collapses the whole heading
  //     (everything → only the heading line visible) instead of just the fence.
  // There is no public event for "live fold model updated", so we fold → verify
  // (only the fence collapsed?) → unfold + retry until the model has the fence
  // regions and the fold is correctly scoped.
  private async autoFold(document: vscode.TextDocument, key: string): Promise<void> {
    try {
      // 1. Wait until the provider produces fence ranges (necessary but NOT
      //    sufficient — the live fold model lags behind).
      const readySpans = await this.waitForProviderReady(document, key);
      if (!readySpans) {
        return;
      }
      // 2. Fold → verify → retry. The first attempts may hit the window where the
      //    live model only knows the heading region and collapses everything; we
      //    detect that (onlyFenceFolded === false), unfold, and retry until the
      //    model has the fence regions and the fold is correct.
      const MAX_ATTEMPTS = 14;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (this.autoFolded.has(key)) {
          return;
        }
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.uri.toString() !== key) {
          return; // not active; refocus will reschedule (autoFolded not set)
        }
        const spans = this.spans(document);
        const lines = fenceFoldStartLines(spans);
        if (lines.length === 0) {
          return;
        }
        await vscode.commands.executeCommand("editor.unfoldAll");
        await delay(120);
        await vscode.commands.executeCommand("editor.fold", {
          selectionLines: lines,
          levels: 1,
          direction: "down"
        });
        await delay(180);
        if (onlyFenceFolded(editor, spans)) {
          this.autoFolded.add(key);
          return;
        }
        await delay(150);
      }
      // Exhausted without a verified-correct fold: never leave the user staring at
      // a fully collapsed document — unfold so the content is at least readable.
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document.uri.toString() === key) {
        await vscode.commands.executeCommand("editor.unfoldAll");
      }
    } finally {
      this.pending.delete(key);
    }
  }

  // Poll the folding-range PROVIDER until it returns ranges covering our fences.
  // Returns the spans when ready, or undefined if it never becomes ready / no fences.
  private async waitForProviderReady(
    document: vscode.TextDocument,
    key: string
  ): Promise<Array<{ startLine: number; endLine: number }> | undefined> {
    const ATTEMPTS = 40;
    const DELAY_MS = 150;
    for (let i = 0; i < ATTEMPTS; i++) {
      if (this.autoFolded.has(key)) {
        return undefined;
      }
      const spans = this.spans(document);
      const lines = fenceFoldStartLines(spans);
      if (lines.length === 0) {
        return undefined;
      }
      const ranges =
        ((await vscode.commands.executeCommand(
          "vscode.executeFoldingRangeProvider",
          document.uri
        )) as vscode.FoldingRange[] | undefined) || [];
      if (ranges.some((r) => lines.includes(r.start))) {
        return spans;
      }
      await delay(DELAY_MS);
    }
    return undefined;
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
