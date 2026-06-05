// esbuild bundler for the MarkdownComments extension.
// The WASM glue (native/mdc) is emitted by wasm-pack with `--target nodejs`;
// it is kept external and copied next to the bundle so its .wasm loads at runtime.
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

function copyNative() {
  const src = path.join(__dirname, "native", "mdc");
  const dest = path.join(__dirname, "dist", "native", "mdc");
  const wasm = path.join(src, "mdc_wasm_bg.wasm");
  if (!fs.existsSync(src) || !fs.existsSync(wasm)) {
    const msg =
      "[esbuild] native/mdc (mdc_wasm_bg.wasm) not found; build the WASM core first (wasm-pack).";
    // In a production/package build a missing .wasm would ship a broken VSIX,
    // so fail loudly instead of silently producing an unusable extension.
    if (production) {
      throw new Error(msg);
    }
    console.warn(msg);
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
  }
}

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node18",
    outfile: "dist/extension.js",
    external: ["vscode", "./native/mdc"],
    sourcemap: !production,
    minify: production,
    logLevel: "info"
  });

  copyNative();

  if (production) {
    // Production bundles omit source maps; remove any stale map left by a prior
    // dev build so it is never packaged into the VSIX.
    const staleMap = path.join(__dirname, "dist", "extension.js.map");
    if (fs.existsSync(staleMap)) {
      fs.rmSync(staleMap);
    }
  }

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
