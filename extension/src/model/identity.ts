// Resolves the author display name and produces UTC timestamps.
// Identity is supplied by the extension because the core is identity-free.

import * as vscode from "vscode";
import { execFile } from "child_process";

// Git `user.name` is cached per workspace folder so that, in a multi-root
// workspace, comments in one folder are not misattributed using another
// folder's configured identity.
const gitNameCache = new Map<string, string | undefined>();

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
 * precedence, then the local Git `user.name`, then a neutral `"Unknown"`.
 *
 * The OS account name is intentionally never used as a fallback: the resolved
 * name is written into a file that is committed and shared, so leaking the
 * local username would be an unintended disclosure.
 */
export async function resolveAuthor(resource?: vscode.Uri): Promise<string> {
  const configured = vscode.workspace
    .getConfiguration("markdownComments", resource ?? null)
    .get<string>("authorName");
  if (configured && configured.trim().length > 0) {
    return configured.trim();
  }
  const folder = resource
    ? vscode.workspace.getWorkspaceFolder(resource)?.uri.fsPath
    : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const cacheKey = folder ?? "";
  if (!gitNameCache.has(cacheKey)) {
    gitNameCache.set(cacheKey, await gitUserName(folder));
  }
  return gitNameCache.get(cacheKey) ?? "Unknown";
}

/** Clear cached Git identity (used when configuration changes). */
export function clearIdentityCache(): void {
  gitNameCache.clear();
}

/** Current time as a UTC ISO-8601 timestamp with a `Z` suffix, second precision. */
export function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
