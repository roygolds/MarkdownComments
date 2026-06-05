// Markdown Preview integration. Like Mermaid, the `MarkdownComments` fenced
// block is intercepted and rendered as comment cards instead of a raw code
// block. Bodies are rendered as escaped plain text, never as Markdown.
//
// The same renderer powers the dedicated interactive panel (see previewPanel);
// the `interactive` option toggles the action buttons. In the built-in preview
// the cards are read-only (the built-in preview has no supported write-back
// channel) but can still be hidden/collapsed by media/preview.js.

import type MarkdownIt from "markdown-it";
import { core } from "../core/wasmBridge";
import type { ThreadView } from "../core/types";
import { renderThreadsHtml } from "./cardRender";

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

interface PluginOptions {
  interactive: boolean;
}

/** Apply the MarkdownComments fence renderer to a markdown-it instance. */
export function applyMarkdownCommentsPlugin(md: MarkdownIt, options: PluginOptions): MarkdownIt {
  const defaultFence =
    md.renderer.rules.fence ??
    ((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));

  md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
    const token = tokens[idx];
    if (token.info.trim() === INFO) {
      const threads = parseFencePayload(token.content);
      return renderThreadsHtml(threads, token.content, options);
    }
    return defaultFence(tokens, idx, opts, env, self);
  };

  return md;
}

/**
 * Contribution point used by VS Code's built-in Markdown preview. Renders
 * read-only comment cards (no edit buttons).
 */
export function extendMarkdownIt(md: MarkdownIt): MarkdownIt {
  return applyMarkdownCommentsPlugin(md, { interactive: false });
}
