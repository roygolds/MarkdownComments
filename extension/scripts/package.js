// Package wrapper: build a .vsix whose version is stamped with a local timestamp
// (X.Y.Z-YYYYMMDD-HHMMSS), then restore package.json to its original committed
// contents so the working tree stays clean.
//
// Run via `npm run package`.

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { computeStampedVersion, PKG_PATH } = require("./stamp-version");

const original = fs.readFileSync(PKG_PATH, "utf8");
const pkg = JSON.parse(original);
const stamped = computeStampedVersion(pkg.version);

// Stamp the version (preserving file formatting) just for the package run.
fs.writeFileSync(PKG_PATH, original.replace(/("version"\s*:\s*")[^"]*(")/, `$1${stamped}$2`));

try {
  console.log(`Packaging MarkdownComments ${stamped}`);
  execSync("npx --yes @vscode/vsce package --no-dependencies", {
    stdio: "inherit",
    cwd: path.join(__dirname, "..")
  });
} finally {
  // Always restore the exact original package.json (clean base version in git).
  fs.writeFileSync(PKG_PATH, original);
}
