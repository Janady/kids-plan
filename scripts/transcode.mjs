/**
 * Batch-transcode incompatible videos to H.264 so they play in the app's WebView.
 *
 * Why: the in-app player uses the system WebView (Chromium / WebView2 / Android
 * WebView), which only decodes H.264 / VP8 / VP9 / AV1 video. Files encoded with
 * mpeg4 (DivX/Xvid), older codecs, or (on some platforms) H.265/HEVC play with
 * AUDIO ONLY — you hear sound but see no picture. Desktop players work because
 * they bundle their own decoders.
 *
 * This script scans a folder, detects which videos the WebView can't show, and
 * re-encodes just those to H.264 + AAC in an .mp4.
 *
 * Requirements: ffmpeg and ffprobe on PATH (https://ffmpeg.org/download.html).
 *
 * Usage:
 *   bun scripts/transcode.mjs "D:\path\to\folder"          # transcode in place (keeps a .bak)
 *   bun scripts/transcode.mjs "D:\path\to\folder" --check  # only report, don't convert
 *   bun scripts/transcode.mjs "D:\path\to\folder" --replace # overwrite original (no .bak)
 *
 * Notes:
 *   - Recurses into subfolders.
 *   - Only touches files whose video codec is NOT web-friendly.
 *   - Default keeps the original as "<name>.bak.<ext>"; use --replace to delete it.
 */

import { execFileSync } from "child_process";
import { readdirSync, statSync, renameSync, rmSync, existsSync } from "fs";
import { join, extname, dirname, basename } from "path";

const VIDEO_EXT = new Set([
  ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v",
  ".ts", ".m2ts", ".mts", ".mpg", ".mpeg", ".3gp",
]);

// Video codecs the WebView can display. Everything else needs transcoding.
// H.265/hevc is intentionally treated as incompatible for the widest support
// (Android WebView and older WebView2 often can't decode it).
const WEB_OK = new Set(["h264", "vp8", "vp9", "av1"]);

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith("--"));
const checkOnly = args.includes("--check");
const replace = args.includes("--replace");

if (!root) {
  console.error('Usage: bun scripts/transcode.mjs "<folder>" [--check] [--replace]');
  process.exit(1);
}

function videoCodec(file) {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0",
       "-show_entries", "stream=codec_name",
       "-of", "default=nw=1:nk=1", file],
      { encoding: "utf8" }
    );
    return out.trim();
  } catch {
    return null; // ffprobe failed / no video stream
  }
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (VIDEO_EXT.has(extname(name).toLowerCase())) acc.push(full);
  }
  return acc;
}

function transcode(file) {
  const dir = dirname(file);
  const ext = extname(file);
  const stem = basename(file, ext);
  const tmp = join(dir, `${stem}.h264.mp4`);

  // libx264 + AAC; -crf 20 good quality, faststart for progressive playback.
  execFileSync(
    "ffmpeg",
    ["-y", "-i", file,
     "-c:v", "libx264", "-crf", "20", "-preset", "fast", "-pix_fmt", "yuv420p",
     "-c:a", "aac", "-b:a", "192k",
     "-movflags", "+faststart", tmp],
    { stdio: "inherit" }
  );

  if (replace) {
    rmSync(file);
  } else {
    renameSync(file, join(dir, `${stem}.bak${ext}`));
  }
  // Final output takes the original .mp4 name
  const finalName = join(dir, `${stem}.mp4`);
  if (existsSync(finalName) && finalName !== tmp) rmSync(finalName);
  renameSync(tmp, finalName);
}

const files = walk(root);
const bad = [];
for (const f of files) {
  const codec = videoCodec(f);
  if (codec && !WEB_OK.has(codec)) bad.push({ f, codec });
}

console.log(`扫描 ${files.length} 个视频，发现 ${bad.length} 个需要转码：`);
for (const { f, codec } of bad) console.log(`  [${codec}] ${f}`);

if (checkOnly || bad.length === 0) process.exit(0);

console.log("\n开始转码…\n");
let ok = 0;
for (const { f } of bad) {
  try {
    console.log(`→ ${f}`);
    transcode(f);
    ok += 1;
  } catch (e) {
    console.error(`  失败: ${e.message}`);
  }
}
console.log(`\n完成：${ok}/${bad.length} 个已转为 H.264${replace ? "" : "（原文件保留为 .bak）"}。`);
console.log("转码后请在 app 里对相应计划「重新扫描」。");
