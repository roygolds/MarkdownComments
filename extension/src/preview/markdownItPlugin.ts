// Markdown Preview integration. Like Mermaid, the `MarkdownComments` fenced
// block is intercepted and rendered as comment cards instead of a raw code
// block. Bodies are rendered as escaped plain text, never as Markdown.

import type MarkdownIt from "markdown-it";
import { core } from "../core/wasmBridge";
import type { ThreadView } from "../core/types";

const INFO = "MarkdownComments";

function parseFencePayload(payload: string): ThreadView[] {
  // Reconstruct a minimal document so the real core parser handles the YAML.
  const doc = "```" + INFO + "\n" + payload + "```\nplaceholder\n";
  try {
    return core.parse(doc).fences[0]?.threads ?? [];
  } catch {
    return [];
  }
}

function renderThreads(md: MarkdownIt, threads: ThreadView[], rawPayload: string): string {
  const esc = md.utils.escapeHtml;
  if (threads.length === 0) {
    return (
      '<div class="markdown-comments markdown-comments--invalid"' +
      ' style="border:1px solid var(--vscode-editorWarning-foreground,#cca700);' +
      'border-radius:6px;padding:8px;margin:8px 0;">' +
      '<strong>MarkdownComments</strong><pre style="white-space:pre-wrap;">' +
      esc(rawPayload) +
      "</pre></div>"
    );
  }

  const cards = threads
    .map((thread) => {
      const statusBadge =
        thread.status === "resolved"
          ? '<span style="color:var(--vscode-descriptionForeground,#888);">resolved</span>'
          : '<span style="color:var(--vscode-charts-blue,#3794ff);">open</span>';
      const quote = thread.quote
        ? '<div style="font-style:italic;opacity:0.8;">&ldquo;' +
          esc(thread.quote) +
          "&rdquo;</div>"
        : "";
      const comments = thread.comments
        .map(
          (c) =>
            '<div style="margin-top:6px;">' +
            '<div style="font-size:0.85em;opacity:0.8;"><strong>' +
            esc(c.by) +
            "</strong> · " +
            esc(c.at) +
            "</div>" +
            '<div style="white-space:pre-wrap;">' +
            esc(c.text) +
            "</div></div>"
        )
        .join("");
      return (
        '<div class="markdown-comments__thread" style="margin:6px 0;padding-bottom:6px;' +
        'border-bottom:1px solid var(--vscode-panel-border,#3c3c3c);">' +
        '<div style="font-size:0.85em;opacity:0.7;">' +
        esc(thread.id) +
        " · " +
        statusBadge +
        "</div>" +
        quote +
        comments +
        "</div>"
      );
    })
    .join("");

  return (
    '<div class="markdown-comments" style="border:1px solid ' +
    "var(--vscode-panel-border,#3c3c3c);border-radius:6px;padding:8px 12px;" +
    'margin:8px 0;background:var(--vscode-editorWidget-background,rgba(127,127,127,0.08));">' +
    '<div style="font-size:0.8em;text-transform:uppercase;letter-spacing:0.05em;' +
    'opacity:0.6;margin-bottom:4px;">💬 Comments</div>' +
    cards +
    "</div>"
  );
}

export function extendMarkdownIt(md: MarkdownIt): MarkdownIt {
  const defaultFence =
    md.renderer.rules.fence ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token.info.trim() === INFO) {
      const threads = parseFencePayload(token.content);
      return renderThreads(md, threads, token.content);
    }
    return defaultFence(tokens, idx, options, env, self);
  };

  return md;
}
