/**
 * Batch-downscale large videos to a smaller resolution (e.g. 720p) to shrink file size.
 *
 * Usage:
 *   bun scripts/compress-video.mjs "D:\path\to\folder"                 # downscale in place (keeps a .bak)
 *   bun scripts/compress-video.mjs "D:\path\to\folder" --check         # only list videos, don't compress
 *   bun scripts/compress-video.mjs "D:\path\to\folder" --height 480    # target 480p instead of 720p
 *   bun scripts/compress-video.mjs "D:\path\to\folder" --crf 28        # smaller / lower quality output
 *   bun scripts/compress-video.mjs "D:\path\to\folder" --out "D:\out"  # write outputs into a separate folder
 *   bun scripts/compress-video.mjs "D:\path\to\folder" --replace       # overwrite original (no .bak)
 *
 * Notes:
 *   - Recurses into subfolders.
 *   - Only touches videos whose resolution exceeds the target (never upscales).
 *   - Landscape videos are capped by height; portrait videos are capped by width.
 *   - Re-encodes to H.264 + AAC so output stays compatible with the in-app WebView player.
 *   - Skips a file if its compressed target already exists (in --out mode).
 *   - Requires ffmpeg and ffprobe on PATH (https://ffmpeg.org/download.html).
 */

import { execFileSync } from "child_process";
import { readdirSync, statSync, existsSync, mkdirSync, renameSync, rmSync } from "fs";
import { join, extname, dirname, basename, relative } from "path";

const VIDEO_EXT = new Set([
  ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v",
  ".ts", ".m2ts", ".mts", ".mpg", ".mpeg", ".3gp",
]);

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith("--"));
const checkOnly = args.includes("--check");
const replace = args.includes("--replace");

const heightIdx = args.indexOf("--height");
const target = heightIdx !== -1 ? parseInt(args[heightIdx + 1], 10) : 720;

const crfIdx = args.indexOf("--crf");
const crf = crfIdx !== -1 ? parseInt(args[crfIdx + 1], 10) : 26;

const presetIdx = args.indexOf("--preset");
const preset = presetIdx !== -1 ? args[presetIdx + 1] : "fast";

const outIdx = args.indexOf("--out");
const outDir = outIdx !== -1 ? args[outIdx + 1] : null;

if (!root) {
  console.error(
    'Usage: bun scripts/compress-video.mjs "<folder>" [--check] [--height 720] [--crf 26] [--preset fast] [--out "<folder>"] [--replace]'
  );
  process.exit(1);
}
if (!Number.isFinite(target) || target <= 0) {
  console.error(`不合法的目标高度: ${args[heightIdx + 1]}`);
  process.exit(1);
}
if (!Number.isFinite(crf) || crf < 0) {
  console.error(`不合法的 crf 值: ${args[crfIdx + 1]}`);
  process.exit(1);
}

function videoDimensions(file) {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0",
       "-show_entries", "stream=width,height",
       "-of", "csv=p=0", file],
      { encoding: "utf8" }
    );
    const [w, h] = out.trim().split(",").map(Number);
    if (!w || !h) return null;
    return { width: w, height: h };
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

function scaleFilter(width, height) {
  // Landscape: cap height. Portrait: cap width. "-2" keeps the other side
  // proportional and rounded to an even number (required by yuv420p).
  return width >= height ? `scale=-2:${target}` : `scale=${target}:-2`;
}

function fmtMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1);
}

function targetPath(file) {
  const stem = basename(file, extname(file));
  if (outDir) {
    const rel = dirname(relative(root, file));
    const dir = rel && rel !== "." ? join(outDir, rel) : outDir;
    mkdirSync(dir, { recursive: true });
    return join(dir, `${stem}.mp4`);
  }
  return join(dirname(file), `${stem}.mp4`);
}

function compress(file, dest, filter) {
  const tmp = outDir ? dest : join(dirname(file), `${basename(file, extname(file))}.compressed.mp4`);

  execFileSync(
    "ffmpeg",
    ["-y", "-i", file,
     "-vf", filter,
     "-c:v", "libx264", "-crf", String(crf), "-preset", preset, "-pix_fmt", "yuv420p",
     "-c:a", "aac", "-b:a", "128k",
     "-movflags", "+faststart", tmp],
    { stdio: "inherit" }
  );

  if (outDir) return tmp;

  const ext = extname(file);
  const dir = dirname(file);
  const stem = basename(file, ext);
  if (replace) {
    rmSync(file);
  } else {
    renameSync(file, join(dir, `${stem}.bak${ext}`));
  }
  if (existsSync(dest) && dest !== tmp) rmSync(dest);
  renameSync(tmp, dest);
  return dest;
}

const files = walk(root);
const candidates = [];
for (const f of files) {
  const dim = videoDimensions(f);
  if (!dim) continue;
  const boundSide = dim.width >= dim.height ? dim.height : dim.width;
  if (boundSide > target) candidates.push({ f, dim });
}

console.log(`扫描 ${files.length} 个视频，其中 ${candidates.length} 个分辨率超过 ${target}p，需要压缩：`);
for (const { f, dim } of candidates) console.log(`  [${dim.width}x${dim.height}] ${f}`);

if (checkOnly || candidates.length === 0) process.exit(0);

console.log(`\n开始压缩（目标: ${target}p, crf: ${crf}, preset: ${preset}）…\n`);
let ok = 0;
let totalBefore = 0;
let totalAfter = 0;
for (const { f, dim } of candidates) {
  const dest = targetPath(f);
  if (outDir && existsSync(dest)) {
    console.log(`↷ 已存在，跳过: ${dest}`);
    continue;
  }
  try {
    console.log(`→ ${f}`);
    const before = statSync(f).size;
    const finalPath = compress(f, dest, scaleFilter(dim.width, dim.height));
    const after = statSync(finalPath).size;
    totalBefore += before;
    totalAfter += after;
    const saved = before > 0 ? (100 * (1 - after / before)).toFixed(0) : "0";
    console.log(`  ${fmtMB(before)}MB → ${fmtMB(after)}MB（省 ${saved}%）`);
    ok += 1;
  } catch (e) {
    console.error(`  失败: ${e.message}`);
  }
}
console.log(
  `\n完成：${ok}/${candidates.length} 个已压缩` +
  (!outDir && !replace ? "（原文件保留为 .bak）" : "") +
  (totalBefore ? `，共 ${fmtMB(totalBefore)}MB → ${fmtMB(totalAfter)}MB` : "") +
  "。"
);
if (!outDir) console.log("压缩后请在 app 里对相应计划「重新扫描」。");
