// Build-time version stamping.
//
// The committed package.json keeps a clean base version (X.Y.Z). For builds and
// packages we stamp a local timestamp so every artifact has a unique, traceable
// version of the form X.Y.Z-YYYYMMDD-HHMMSS. This makes it obvious which build is
// installed/running (e.g. to confirm a fresh dev build vs a stale one).
//
// Usage:
//   node scripts/stamp-version.js            # print the stamped version
//   node scripts/stamp-version.js --write    # write the stamped version into package.json
//
// `computeStampedVersion` and `baseVersion` are exported for the package wrapper.

const fs = require("fs");
const path = require("path");

const PKG_PATH = path.join(__dirname, "..", "package.json");
const SUFFIX_RE = /-\d{8}-\d{6}$/;

function pad(n) {
  return String(n).padStart(2, "0");
}

/** Strip any existing `-YYYYMMDD-HHMMSS` suffix to get the X.Y.Z base. */
function baseVersion(version) {
  return version.replace(SUFFIX_RE, "");
}

/** Build a `YYYYMMDD-HHMMSS` stamp from a Date (local time). */
function timestamp(date = new Date()) {
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** Return `X.Y.Z-YYYYMMDD-HHMMSS` for the given base version. */
function computeStampedVersion(version, date = new Date()) {
  return `${baseVersion(version)}-${timestamp(date)}`;
}

function readPackage() {
  return JSON.parse(fs.readFileSync(PKG_PATH, "utf8"));
}

function writeVersion(version) {
  const original = fs.readFileSync(PKG_PATH, "utf8");
  // Replace only the top-level "version" string to preserve the file's exact
  // formatting (vsce reads this field; the package wrapper restores it after).
  const updated = original.replace(
    /("version"\s*:\s*")[^"]*(")/,
    `$1${version}$2`
  );
  if (updated === original) {
    throw new Error('Could not find a top-level "version" field to stamp.');
  }
  fs.writeFileSync(PKG_PATH, updated);
}

module.exports = { baseVersion, timestamp, computeStampedVersion, readPackage, writeVersion, PKG_PATH };

if (require.main === module) {
  const current = readPackage().version;
  if (process.argv.includes("--reset")) {
    // Strip any timestamp suffix, returning package.json to its clean base.
    const base = baseVersion(current);
    writeVersion(base);
    process.stdout.write(base + "\n");
  } else {
    const stamped = computeStampedVersion(current);
    if (process.argv.includes("--write")) {
      writeVersion(stamped);
    }
    process.stdout.write(stamped + "\n");
  }
}
