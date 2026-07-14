/**
 * Bump the app version across all files that must stay in sync.
 *
 * Usage:
 *   bun run bump                default: bump patch (0.2.0 -> 0.2.1)
 *   bun run bump <version>      e.g.  bun run bump 0.3.0
 *   bun run bump patch          bump the patch part (0.2.0 -> 0.2.1)
 *   bun run bump minor          bump the minor part (0.2.0 -> 0.3.0)
 *   bun run bump major          bump the major part (0.2.0 -> 1.0.0)
 *
 * Updates:
 *   package.json                       "version"
 *   src-tauri/tauri.conf.json          "version"
 *   src/version.ts                     APP_VERSION
 *   src-tauri/gen/android/app/tauri.properties
 *                                      versionName + versionCode (auto +1)
 *
 * Android versionCode must strictly increase for each release so devices can
 * upgrade; we derive it from the semver as major*1_000_000 + minor*1000 + patch,
 * which keeps it monotonic and human-readable (0.2.0 -> 2000, 0.3.1 -> 3001).
 */

import { readFileSync, writeFileSync } from "fs";

// Default to "patch" when no argument is given.
const arg = process.argv[2] ?? "patch";

const pkgPath = "package.json";
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const current = pkg.version;

function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) throw new Error(`Invalid semver: ${v}`);
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

let next;
if (arg === "major" || arg === "minor" || arg === "patch") {
  const c = parse(current);
  if (arg === "major") next = `${c.major + 1}.0.0`;
  else if (arg === "minor") next = `${c.major}.${c.minor + 1}.0`;
  else next = `${c.major}.${c.minor}.${c.patch + 1}`;
} else {
  parse(arg); // validate format
  next = arg;
}

const { major, minor, patch } = parse(next);
const versionCode = major * 1_000_000 + minor * 1000 + patch;

// ── 1. package.json ──────────────────────────────────────────────────────────
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// ── 2. src-tauri/tauri.conf.json ─────────────────────────────────────────────
const confPath = "src-tauri/tauri.conf.json";
const conf = JSON.parse(readFileSync(confPath, "utf8"));
conf.version = next;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + "\n");

// ── 3. src/version.ts ────────────────────────────────────────────────────────
const verTsPath = "src/version.ts";
let verTs = readFileSync(verTsPath, "utf8");
verTs = verTs.replace(/APP_VERSION = "[^"]*"/, `APP_VERSION = "${next}"`);
writeFileSync(verTsPath, verTs);

// ── 4. Android tauri.properties ──────────────────────────────────────────────
const propsPath = "src-tauri/gen/android/app/tauri.properties";
let props = readFileSync(propsPath, "utf8");
props = props
  .replace(/tauri\.android\.versionName=.*/, `tauri.android.versionName=${next}`)
  .replace(/tauri\.android\.versionCode=.*/, `tauri.android.versionCode=${versionCode}`);
writeFileSync(propsPath, props);

console.log(`Version bumped: ${current} -> ${next}`);
console.log(`  package.json, tauri.conf.json, src/version.ts  -> ${next}`);
console.log(`  Android versionName=${next}  versionCode=${versionCode}`);
