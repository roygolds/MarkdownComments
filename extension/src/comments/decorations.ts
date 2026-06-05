// Editor decorations: a gutter marker on commented blocks and a subtle
// highlight on quoted anchors. Resolved threads can be visually de-emphasized.

import * as vscode from "vscode";
import type { FenceView } from "../core/types";
import { toVsRange } from "./edits";

export class Decorations implements vscode.Disposable {
  private readonly anchor: vscode.TextEditorDecorationType;
  private readonly resolvedAnchor: vscode.TextEditorDecorationType;
  private readonly needsReattach: vscode.TextEditorDecorationType;

  constructor() {
    this.anchor = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("editor.wordHighlightBackground"),
      overviewRulerColor: new vscode.ThemeColor("editorOverviewRuler.findMatchForeground"),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    });
    this.resolvedAnchor = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor("editor.inactiveSelectionBackground"),
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed
    });
    this.needsReattach = vscode.window.createTextEditorDecorationType({
      textDecoration: "underline wavy",
      overviewRulerColor: new vscode.ThemeColor("editorWarning.foreground"),
      overviewRulerLane: vscode.OverviewRulerLane.Right
    });
  }

  apply(editor: vscode.TextEditor, fences: FenceView[]): void {
    const open: vscode.Range[] = [];
    const resolved: vscode.Range[] = [];
    const reattach: vscode.Range[] = [];

    for (const fence of fences) {
      for (const thread of fence.threads) {
        const anchor = thread.anchor;
        if (anchor.kind === "needsReattach") {
          // Mark the fence line itself when the anchor is lost.
          reattach.push(toVsRange(fence.range));
          continue;
        }
        if (!anchor.range) {
          continue;
        }
        const range = toVsRange(anchor.range);
        if (thread.status === "resolved") {
          resolved.push(range);
        } else {
          open.push(range);
        }
      }
    }

    editor.setDecorations(this.anchor, open);
    editor.setDecorations(this.resolvedAnchor, resolved);
    editor.setDecorations(this.needsReattach, reattach);
  }

  clear(editor: vscode.TextEditor): void {
    editor.setDecorations(this.anchor, []);
    editor.setDecorations(this.resolvedAnchor, []);
    editor.setDecorations(this.needsReattach, []);
  }

  dispose(): void {
    this.anchor.dispose();
    this.resolvedAnchor.dispose();
    this.needsReattach.dispose();
  }
}
