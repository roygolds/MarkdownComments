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
  if (!fs.existsSync(src)) {
    console.warn("[esbuild] native/mdc not found; build the WASM core first (wasm-pack).");
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
