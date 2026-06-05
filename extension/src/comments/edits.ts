// Helpers to convert core view ranges to VS Code ranges and to apply an
// EditResult atomically through a WorkspaceEdit.

import * as vscode from "vscode";
import type { EditResult, Range as CoreRange } from "../core/types";

export function toVsRange(r: CoreRange): vscode.Range {
  return new vscode.Range(
    new vscode.Position(r.start.line, r.start.character),
    new vscode.Position(r.end.line, r.end.character)
  );
}

export function toCorePosition(p: vscode.Position): { line: number; character: number } {
  return { line: p.line, character: p.character };
}

/**
 * Apply a core EditResult to a document. Returns true on success. Rejected
 * edits surface a warning and make no change.
 */
export async function applyEditResult(
  uri: vscode.Uri,
  result: EditResult
): Promise<boolean> {
  if (!result.ok) {
    if (result.rejected) {
      void vscode.window.showWarningMessage(`MarkdownComments: ${result.rejected}`);
    }
    return false;
  }
  if (result.edits.length === 0) {
    return true;
  }
  const wsEdit = new vscode.WorkspaceEdit();
  for (const edit of result.edits) {
    wsEdit.replace(uri, toVsRange(edit.range), edit.newText);
  }
  return vscode.workspace.applyEdit(wsEdit);
}
