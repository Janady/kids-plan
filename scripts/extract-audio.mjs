/**
 * Batch-extract the audio track from videos into standalone audio files.
 *
 * Usage:
 *   bun scripts/extract-audio.mjs "D:\path\to\folder"                 # extract to .mp3 next to each video
 *   bun scripts/extract-audio.mjs "D:\path\to\folder" --check         # only list videos, don't extract
 *   bun scripts/extract-audio.mjs "D:\path\to\folder" --format m4a    # extract to .m4a instead
 *   bun scripts/extract-audio.mjs "D:\path\to\folder" --out "D:\out"  # write outputs into a separate folder
 *
 * Notes:
 *   - Recurses into subfolders.
 *   - Skips files that have no audio stream.
 *   - Skips extraction if the target audio file already exists.
 *   - Requires ffmpeg and ffprobe on PATH (https://ffmpeg.org/download.html).
 */

import { execFileSync } from "child_process";
import { readdirSync, statSync, existsSync, mkdirSync } from "fs";
import { join, extname, dirname, basename, relative, isAbsolute } from "path";

const VIDEO_EXT = new Set([
  ".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v",
  ".ts", ".m2ts", ".mts", ".mpg", ".mpeg", ".3gp",
]);

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith("--"));
const checkOnly = args.includes("--check");
const formatIdx = args.indexOf("--format");
const format = formatIdx !== -1 ? args[formatIdx + 1] : "mp3";
const outIdx = args.indexOf("--out");
const outDir = outIdx !== -1 ? args[outIdx + 1] : null;

if (!root) {
  console.error(
    'Usage: bun scripts/extract-audio.mjs "<folder>" [--check] [--format mp3|m4a] [--out "<folder>"]'
  );
  process.exit(1);
}
if (format !== "mp3" && format !== "m4a") {
  console.error(`不支持的格式: ${format}（仅支持 mp3 / m4a）`);
  process.exit(1);
}

function hasAudio(file) {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-select_streams", "a:0",
       "-show_entries", "stream=codec_name",
       "-of", "default=nw=1:nk=1", file],
      { encoding: "utf8" }
    );
    return out.trim().length > 0;
  } catch {
    return false;
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

function targetPath(file) {
  const stem = basename(file, extname(file));
  if (outDir) {
    const rel = dirname(relative(root, file));
    const dir = rel && rel !== "." ? join(outDir, rel) : outDir;
    mkdirSync(dir, { recursive: true });
    return join(dir, `${stem}.${format}`);
  }
  return join(dirname(file), `${stem}.${format}`);
}

function extract(file, dest) {
  const codecArgs =
    format === "m4a"
      ? ["-c:a", "aac", "-b:a", "192k"]
      : ["-c:a", "libmp3lame", "-b:a", "192k"];

  execFileSync(
    "ffmpeg",
    ["-y", "-i", file, "-vn", ...codecArgs, dest],
    { stdio: "inherit" }
  );
}

const files = walk(root);
const withAudio = files.filter(hasAudio);

console.log(`扫描 ${files.length} 个视频，其中 ${withAudio.length} 个含音轨。`);
for (const f of withAudio) console.log(`  ${f}`);

if (checkOnly || withAudio.length === 0) process.exit(0);

console.log(`\n开始提取音频（格式: ${format}）…\n`);
let ok = 0;
let skipped = 0;
for (const f of withAudio) {
  const dest = targetPath(f);
  if (existsSync(dest)) {
    console.log(`↷ 已存在，跳过: ${dest}`);
    skipped += 1;
    continue;
  }
  try {
    console.log(`→ ${f}`);
    extract(f, dest);
    ok += 1;
  } catch (e) {
    console.error(`  失败: ${e.message}`);
  }
}
console.log(`\n完成：${ok}/${withAudio.length} 个已提取${skipped ? `，${skipped} 个已跳过` : ""}。`);
