// Publishes core diagnostics into a VS Code DiagnosticCollection.

import * as vscode from "vscode";
import type { Diagnostic as CoreDiagnostic } from "../core/types";
import { toVsRange } from "./edits";

const SEVERITY: Record<string, vscode.DiagnosticSeverity> = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information
};

export function createDiagnostics(): vscode.DiagnosticCollection {
  return vscode.languages.createDiagnosticCollection("markdownComments");
}

export function publishDiagnostics(
  collection: vscode.DiagnosticCollection,
  uri: vscode.Uri,
  diagnostics: CoreDiagnostic[]
): void {
  const vsDiags = diagnostics.map((d) => {
    const diag = new vscode.Diagnostic(
      toVsRange(d.range),
      d.message,
      SEVERITY[d.severity] ?? vscode.DiagnosticSeverity.Information
    );
    diag.source = "MarkdownComments";
    diag.code = d.code;
    if (d.relatedRanges && d.relatedRanges.length > 0) {
      diag.relatedInformation = d.relatedRanges.map(
        (r) =>
          new vscode.DiagnosticRelatedInformation(
            new vscode.Location(uri, toVsRange(r)),
            "related thread"
          )
      );
    }
    return diag;
  });
  collection.set(uri, vsDiags);
}
