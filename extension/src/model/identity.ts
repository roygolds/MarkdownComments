// Resolves the author display name and produces UTC timestamps.
// Identity is supplied by the extension because the core is identity-free.

import * as vscode from "vscode";
import { execFile } from "child_process";
import * as os from "os";

let cachedGitName: string | undefined;
let gitLookupDone = false;

function gitUserName(cwd: string | undefined): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile("git", ["config", "user.name"], { cwd }, (err, stdout) => {
      if (err) {
        resolve(undefined);
        return;
      }
      const name = stdout.trim();
      resolve(name.length > 0 ? name : undefined);
    });
  });
}

/**
 * Resolve the author name: the `markdownComments.authorName` setting takes
 * precedence, then the local Git `user.name`, then the OS username.
 */
export async function resolveAuthor(resource?: vscode.Uri): Promise<string> {
  const configured = vscode.workspace
    .getConfiguration("markdownComments", resource ?? null)
    .get<string>("authorName");
  if (configured && configured.trim().length > 0) {
    return configured.trim();
  }
  if (!gitLookupDone) {
    const folder = resource
      ? vscode.workspace.getWorkspaceFolder(resource)?.uri.fsPath
      : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    cachedGitName = await gitUserName(folder);
    gitLookupDone = true;
  }
  return cachedGitName ?? os.userInfo().username ?? "Unknown";
}

/** Clear cached Git identity (used when configuration changes). */
export function clearIdentityCache(): void {
  gitLookupDone = false;
  cachedGitName = undefined;
}

/** Current time as a UTC ISO-8601 timestamp with a `Z` suffix, second precision. */
export function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
