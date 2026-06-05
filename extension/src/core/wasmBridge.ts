// Thin, typed wrapper around the mdc-wasm core.
//
// The core is pure: text in, result out. This module loads the wasm-pack
// (`--target nodejs`) glue that is copied next to the bundle at build time and
// exposes strongly-typed methods. The `require` is hidden from esbuild so the
// native module is resolved at runtime from `dist/native/mdc`.

import * as path from "path";
import { createRequire } from "module";
import type { EditResult, ParseResult, Diagnostic } from "./types";

interface WasmModule {
  parse(text: string): ParseResult;
  validate(text: string): Diagnostic[];
  nextThreadId(text: string): string;
  version(): string;
  createThread(
    text: string,
    line: number,
    character: number,
    quote: string | undefined,
    by: string,
    at: string,
    body: string
  ): EditResult;
  addReply(text: string, threadId: string, by: string, at: string, body: string): EditResult;
  editComment(text: string, threadId: string, commentIndex: number, newText: string): EditResult;
  setThreadStatus(
    text: string,
    threadId: string,
    resolved: boolean,
    by: string | undefined,
    at: string | undefined
  ): EditResult;
  deleteThread(text: string, threadId: string): EditResult;
  deleteComment(text: string, threadId: string, commentIndex: number): EditResult;
  reattachThread(
    text: string,
    threadId: string,
    newQuote: string | undefined,
    line: number | undefined,
    character: number | undefined
  ): EditResult;
}

let mod: WasmModule | undefined;

function load(): WasmModule {
  if (mod) {
    return mod;
  }
  // Resolve the native glue at runtime from the bundle directory; createRequire
  // keeps the path dynamic so esbuild leaves the native module external.
  const runtimeRequire = createRequire(__filename);
  const modulePath = path.join(__dirname, "native", "mdc", "mdc_wasm.js");
  mod = runtimeRequire(modulePath) as WasmModule;
  return mod;
}

export const core = {
  parse(text: string): ParseResult {
    return load().parse(text);
  },
  validate(text: string): Diagnostic[] {
    return load().validate(text);
  },
  nextThreadId(text: string): string {
    return load().nextThreadId(text);
  },
  version(): string {
    return load().version();
  },
  createThread(
    text: string,
    line: number,
    character: number,
    quote: string | undefined,
    by: string,
    at: string,
    body: string
  ): EditResult {
    return load().createThread(text, line, character, quote, by, at, body);
  },
  addReply(text: string, threadId: string, by: string, at: string, body: string): EditResult {
    return load().addReply(text, threadId, by, at, body);
  },
  editComment(text: string, threadId: string, commentIndex: number, newText: string): EditResult {
    return load().editComment(text, threadId, commentIndex, newText);
  },
  setThreadStatus(
    text: string,
    threadId: string,
    resolved: boolean,
    by: string | undefined,
    at: string | undefined
  ): EditResult {
    return load().setThreadStatus(text, threadId, resolved, by, at);
  },
  deleteThread(text: string, threadId: string): EditResult {
    return load().deleteThread(text, threadId);
  },
  deleteComment(text: string, threadId: string, commentIndex: number): EditResult {
    return load().deleteComment(text, threadId, commentIndex);
  },
  reattachThread(
    text: string,
    threadId: string,
    newQuote: string | undefined,
    line: number | undefined,
    character: number | undefined
  ): EditResult {
    return load().reattachThread(text, threadId, newQuote, line, character);
  }
};
