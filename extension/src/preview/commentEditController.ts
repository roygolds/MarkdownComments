// Shared inbound-message handler for the comment webviews (preview panel and
// sidebar). Both surfaces accept identical edit messages; centralizing the
// handling here keeps the hostile-input firewall, the stale-edit guard, the
// identity/confirmation flow, and the core argument wiring in one place.

import * as vscode from "vscode";
import { core } from "../core/wasmBridge";
import { applyEditResult } from "../comments/edits";
import { resolveAuthor, nowUtc } from "../model/identity";
import {
  Inbound,
  validateInboundMessage,
  evaluateLiveGuard,
  computeEdit,
  needsIdentity
} from "./messageValidation";

export class CommentEditController {
  private applying = false;

  constructor(
    private readonly getTargetUri: () => vscode.Uri | undefined,
    private readonly findDocument: () => vscode.TextDocument | undefined,
    private readonly refresh: () => void
  ) {}

  async handle(raw: unknown): Promise<void> {
    const msg = validateInboundMessage(raw);
    if (!msg) {
      return;
    }
    if (this.applying) {
      void vscode.window.showInformationMessage(
        "MarkdownComments: please wait for the previous change to finish."
      );
      return;
    }
    this.applying = true;
    try {
      await this.dispatch(msg);
    } finally {
      this.applying = false;
    }
  }

  /**
   * Return the live document only if it is still the surface's target, is open
   * in an editor, and is at exactly the version the message was composed
   * against. Called again after every `await` so a concurrent external edit
   * cannot make a positional edit land on the wrong range.
   */
  private liveDocument(msg: Inbound): vscode.TextDocument | undefined {
    const target = this.getTargetUri();
    const document = this.findDocument();
    const decision = evaluateLiveGuard({
      msgUri: msg.uri,
      panelUri: target ? target.toString() : "",
      doc: document,
      msgVersion: msg.docVersion
    });
    switch (decision) {
      case "wrongUri":
        this.refresh();
        return undefined;
      case "noDocument":
        void vscode.window.showWarningMessage(
          "MarkdownComments: open the document in an editor to edit its comments."
        );
        return undefined;
      case "staleVersion":
        void vscode.window.showWarningMessage(
          "MarkdownComments: comments were out of date and have been refreshed. Please retry."
        );
        this.refresh();
        return undefined;
      case "ok":
        return document;
    }
  }

  private async dispatch(msg: Inbound): Promise<void> {
    let identity: { by?: string; at?: string } = {};
    if (needsIdentity(msg.type)) {
      identity = { by: await resolveAuthor(this.getTargetUri()), at: nowUtc() };
    }
    if (msg.type === "deleteThread") {
      const confirmed = await vscode.window.showWarningMessage(
        `Delete comment thread "${msg.threadId}" and all of its replies?`,
        { modal: true },
        "Delete"
      );
      if (confirmed !== "Delete") {
        return;
      }
    }

    const document = this.liveDocument(msg);
    if (!document) {
      return;
    }
    const result = computeEdit(core, document.getText(), msg, identity);
    await applyEditResult(document.uri, result);
  }
}
