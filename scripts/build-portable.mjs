/**
 * Build a portable (no-install) Windows package.
 * Output: dist/video-plan-portable-<version>-windows-x64.zip
 *
 * Usage:
 *   bun run build:portable
 *
 * Contents of the ZIP:
 *   video-plan.exe   — the app
 *   .portable        — marker that tells the app to store data next to the exe
 *
 * Requirements: WebView2 must be installed on the target machine.
 * WebView2 ships with Windows 11 and Windows 10 1803+ (auto-updated via Windows Update).
 */

import { execSync } from "child_process";
import { existsSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readFileSync } from "fs";
import { join, resolve } from "path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const VERSION = pkg.version;
const EXE_NAME = "video-plan.exe";
const STAGING = "dist/.portable-staging";
const ZIP_OUT = `dist/video-plan-portable-${VERSION}-windows-x64.zip`;

// ── 1. Build via Tauri CLI (embeds frontend into the binary) ────────────────
// Must use `bun tauri build`, NOT `cargo build` directly.
// Without the Tauri CLI, the frontend assets are NOT embedded and the app
// falls back to connecting to the dev server (localhost:1420), which fails.
// --bundles nsis: build the NSIS installer (we only use the .exe, but the
// CLI still needs a bundle target to perform a proper production build).
console.log("→ Building with Tauri CLI (embeds frontend)…");
execSync("bun tauri build --bundles nsis", { stdio: "inherit" });

const exeSrc = resolve(`src-tauri/target/release/${EXE_NAME}`);
if (!existsSync(exeSrc)) {
  console.error(`\nERROR: exe not found at ${exeSrc}`);
  process.exit(1);
}

// ── 2. Stage portable directory ──────────────────────────────────────────────
console.log("→ Staging portable files…");
mkdirSync("dist", { recursive: true });
if (existsSync(STAGING)) rmSync(STAGING, { recursive: true, force: true });
mkdirSync(STAGING, { recursive: true });

copyFileSync(exeSrc, join(STAGING, EXE_NAME));
// .portable marker → app stores data in ./data/ instead of %APPDATA%
writeFileSync(join(STAGING, ".portable"), "");

// ── 3. Create ZIP via PowerShell ─────────────────────────────────────────────
console.log(`→ Creating ${ZIP_OUT}…`);
const staging = resolve(STAGING).replaceAll("/", "\\");
const zipOut  = resolve(ZIP_OUT).replaceAll("/", "\\");
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${staging}\\*' -DestinationPath '${zipOut}' -Force"`,
  { stdio: "inherit" }
);

// ── 4. Cleanup staging ───────────────────────────────────────────────────────
rmSync(STAGING, { recursive: true, force: true });

console.log(`\n✓ Portable package ready: ${ZIP_OUT}`);
console.log("  Unzip anywhere and run video-plan.exe — no installation needed.");
console.log("  Data will be stored in a 'data' folder next to the exe.");
