import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useVideos } from "../hooks/useVideos";
import { useAppContext } from "../context/AppContext";
import {
  rescanPlan, deletePlan, activatePlan, deactivatePlan, listPlans, setPlanPriority,
  setPlanBackground, setPlanBgWatchedVideo, setPlanProtected, setPlanWeeklySchedule,
} from "../api/plans";
import { adjustVideoReps, batchAdjustPlanReps, setVideoBgTrack } from "../api/videos";
import { useState, useEffect } from "react";
import { canOpenPlanMedia } from "../components/PlanCard";
import { TagEditor } from "../components/Tags";
import type { Plan, Video, WeekdaySetting } from "../types";

// ─── Priority ────────────────────────────────────────────────────────────────

const PRIORITY_LABELS = ["无", "低", "中", "高"];
const PRIORITY_COLORS = [
  "text-gray-500 border-gray-600",
  "text-blue-400 border-blue-700",
  "text-yellow-400 border-yellow-700",
  "text-red-400 border-red-700",
];

// ─── Weekly schedule ──────────────────────────────────────────────────────────

const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

// JS Date.getDay() is 0=Sunday..6=Saturday; convert to 0=Monday..6=Sunday to
// match the backend's weekly_schedule index (chrono's num_days_from_monday).
function todayWeekdayIdx(): number {
  return (new Date().getDay() + 6) % 7;
}

function todaySetting(plan: Plan): WeekdaySetting {
  return plan.weekly_schedule[todayWeekdayIdx()] ?? { episodes: plan.episodes_per_day, blank_minutes: 0 };
}

function WeeklyScheduleEditor({
  plan, onSave, expanded,
}: { plan: Plan; onSave: (schedule: WeekdaySetting[]) => Promise<void>; expanded: boolean }) {
  const [rows, setRows] = useState<WeekdaySetting[]>(plan.weekly_schedule);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setRows(plan.weekly_schedule); }, [plan.weekly_schedule]);

  const updateRow = (i: number, patch: Partial<WeekdaySetting>) => {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(rows);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  if (!expanded) return null;

  return (
    <div className="mb-4 mt-2 space-y-2 px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-lg">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2 bg-gray-700/50 rounded-lg">
          <span className="text-xs text-gray-300 w-10 shrink-0">{WEEKDAY_LABELS[i]}</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              value={row.episodes}
              onChange={(e) => updateRow(i, { episodes: Math.max(0, Number(e.target.value) || 0) })}
              className="w-14 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 outline-none focus:border-sky-500"
            />
            <span className="text-[10px] text-gray-500 shrink-0">集</span>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              max={60}
              value={row.blank_minutes}
              onChange={(e) => updateRow(i, { blank_minutes: Math.min(60, Math.max(0, Number(e.target.value) || 0)) })}
              className="w-14 bg-gray-900 border border-gray-600 rounded px-2 py-1 text-xs text-gray-100 outline-none focus:border-sky-500"
            />
            <span className="text-[10px] text-gray-500 shrink-0">分钟空白练习</span>
          </div>
        </div>
      ))}
      <button
        onClick={handleSave}
        disabled={saving}
        className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
          saved ? "bg-green-700 text-green-200" : "bg-sky-600 hover:bg-sky-500 text-white"
        }`}
      >
        {saved ? "已保存 ✓" : saving ? "保存中…" : "保存"}
      </button>
    </div>
  );
}

// ─── Batch rep adjustment ─────────────────────────────────────────────────────

function BatchRepsControl({ onAdjust }: { onAdjust: (delta: number) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const handle = async (delta: number) => {
    setBusy(true);
    try { await onAdjust(delta); } finally { setBusy(false); }
  };
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">批量练习次数</span>
      <button onClick={() => handle(-1)} disabled={busy}
        className="w-6 h-6 flex items-center justify-center text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded transition-colors text-gray-300">
        −
      </button>
      <button onClick={() => handle(1)} disabled={busy}
        className="w-6 h-6 flex items-center justify-center text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-40 rounded transition-colors text-gray-300">
        +
      </button>
    </div>
  );
}

// ─── Tree helpers ─────────────────────────────────────────────────────────────

interface TreeNode {
  type: "folder" | "file";
  name: string;
  children: TreeNode[];
  video?: Video;
}

function buildTree(videos: Video[], rootPath: string): TreeNode[] {
  const norm = (p: string) => p.replace(/\\/g, "/");
  const root = norm(rootPath).replace(/\/?$/, "/");
  const folderMap = new Map<string, TreeNode>();
  const rootNode: TreeNode = { type: "folder", name: "", children: [] };
  folderMap.set("", rootNode);

  const ensureFolder = (parts: string[]): TreeNode => {
    const key = parts.join("/");
    if (folderMap.has(key)) return folderMap.get(key)!;
    const parent = ensureFolder(parts.slice(0, -1));
    const node: TreeNode = { type: "folder", name: parts[parts.length - 1], children: [] };
    parent.children.push(node);
    folderMap.set(key, node);
    return node;
  };

  const sorted = [...videos].sort((a, b) => a.sort_order - b.sort_order);
  for (const video of sorted) {
    const rel = norm(video.file_path).slice(root.length);
    const parts = rel.split("/").filter(Boolean);
    const fileName = parts.pop()!;
    const folder = parts.length > 0 ? ensureFolder(parts) : rootNode;
    folder.children.push({ type: "file", name: fileName, children: [], video });
  }

  return rootNode.children;
}

function formatTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const STATUS_DOT: Record<string, string> = {
  not_watched: "bg-gray-600",
  watching: "bg-yellow-400",
  watched: "bg-green-500",
};

// ─── Video file node ──────────────────────────────────────────────────────────

function VideoFileNode({
  node, planId, isParentMode, episodeNum, onAdjustReps, onSetBgTrack, onListenAsAudio,
}: {
  node: TreeNode; planId: number; isLocked: boolean; isParentMode: boolean; episodeNum: number;
  onAdjustReps: (videoId: number, delta: number) => void;
  onSetBgTrack: (videoId: number, checked: boolean) => void;
  onListenAsAudio: (video: Video) => void;
}) {
  const navigate = useNavigate();
  const { isCastActive, castSnapshot, switchCastVideo, bgAudioPlans, bgCurrentPlanId, bgCurrentTrackIdx, bgIsPlaying } = useAppContext();
  const video = node.video!;
  const cleared = video.file_exists === false; // file removed to free space
  const locked = cleared || !canOpenPlanMedia(isParentMode, video.status);
  const isCastingThis = castSnapshot?.current?.video_id === video.id;
  const canListen = video.status === "watched" && !cleared;
  const isBgPlaying =
    canListen &&
    bgIsPlaying &&
    bgCurrentPlanId === planId &&
    bgAudioPlans.find((p) => p.id === planId)?.tracks[bgCurrentTrackIdx]?.id === video.id;
  const pct = video.status === "watching" && video.duration_seconds
    ? Math.min(100, (video.progress_seconds / video.duration_seconds) * 100) : 0;

  const handleClick = () => {
    if (cleared) {
      alert("此视频文件已清理，无法播放。如需重看请重新下载后重新扫描。");
      return;
    }
    if (locked) return;
    if (isCastActive) {
      switchCastVideo({
        video_id: video.id,
        file_path: video.file_path,
        title: video.title,
        duration_seconds: video.duration_seconds,
      }).catch(() => {});
      return;
    }
    navigate(`/plan/${planId}/video/${video.id}`);
  };

  return (
    <div
      onClick={handleClick}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${
        cleared
          ? "border-gray-800 bg-gray-900/30 cursor-not-allowed"
          : locked
          ? "border-gray-800 opacity-40 cursor-not-allowed bg-gray-900/30"
          : isBgPlaying
          ? "border-purple-700/60 bg-purple-900/20 hover:border-purple-500 cursor-pointer"
          : video.status === "watching"
          ? "border-yellow-700/50 bg-gray-800 hover:border-yellow-500 cursor-pointer"
          : "border-gray-700/50 bg-gray-800 hover:border-sky-600 cursor-pointer"
      }`}
    >
      <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[video.status] ?? "bg-gray-600"}`} />
      {cleared ? <span className="text-xs shrink-0">🗑️</span> : locked && <span className="text-xs shrink-0">🔒</span>}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-600 shrink-0">{episodeNum}</span>
          <span className={`text-sm truncate ${cleared ? "text-gray-500 line-through" : isBgPlaying ? "text-purple-300" : "text-gray-200"}`}>{video.title}</span>
          {video.status === "watched" && !cleared && (
            <span className="text-[10px] text-green-500 shrink-0">
              {video.completed_reps > 0 ? "已学" : "无需学习"}
            </span>
          )}
          {cleared && <span className="text-[10px] text-gray-500 shrink-0 no-underline">已清理</span>}
          {video.required_reps > 1 && (
            <span className="text-[10px] text-sky-400 shrink-0">练习 {video.completed_reps}/{video.required_reps}</span>
          )}
          {isCastingThis && (
            <span className="text-[10px] bg-sky-500/90 text-white font-semibold px-1.5 py-0.5 rounded shrink-0">📺 投屏中</span>
          )}
        </div>
        {!cleared && video.status === "watching" && video.progress_seconds > 0 && (
          <div className="mt-1 ml-6">
            <div className="w-full h-0.5 bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-yellow-400" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[10px] text-yellow-400">
              已看至 {formatTime(video.progress_seconds)}
              {video.duration_seconds ? ` / ${formatTime(video.duration_seconds)}` : ""}
            </span>
          </div>
        )}
      </div>
      {!cleared && video.duration_seconds && (
        <span className="text-[10px] text-gray-600 shrink-0">{formatTime(video.duration_seconds)}</span>
      )}
      {canListen && (
        <button
          onClick={(e) => { e.stopPropagation(); onListenAsAudio(video); }}
          className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 transition-colors ${
            isBgPlaying
              ? "text-purple-200 bg-purple-800/60"
              : "text-purple-300 hover:text-purple-200 hover:bg-purple-900/40"
          }`}
          title="只播声音，不占视频时长"
        >
          {isBgPlaying ? "♪ 播放中" : "♪ 听"}
        </button>
      )}
      {isParentMode && canListen && (
        <label
          onClick={(e) => e.stopPropagation()}
          title="作为背景音乐（不勾选任何视频时，开启计划开关则全部已看视频都会进入）"
          className="flex items-center gap-1 shrink-0 cursor-pointer"
        >
          <input
            type="checkbox"
            checked={video.is_bg_track === 1}
            onChange={(e) => onSetBgTrack(video.id, e.target.checked)}
            className="w-3.5 h-3.5 accent-purple-500"
          />
          <span className="text-[10px] text-purple-400">🎶</span>
        </label>
      )}
      {isParentMode && (
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => onAdjustReps(video.id, -1)}
            className="w-5 h-5 flex items-center justify-center text-[10px] bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors">−</button>
          <span className="w-4 text-center text-[10px] text-gray-400">{video.required_reps}</span>
          <button onClick={() => onAdjustReps(video.id, 1)}
            className="w-5 h-5 flex items-center justify-center text-[10px] bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors">+</button>
        </div>
      )}
    </div>
  );
}

function countTypeInTree(node: TreeNode): { video: number; audio: number } {
  if (node.type === "file") {
    return node.video?.media_type === "audio" ? { video: 0, audio: 1 } : { video: 1, audio: 0 };
  }
  return node.children.reduce(
    (acc, c) => { const s = countTypeInTree(c); return { video: acc.video + s.video, audio: acc.audio + s.audio }; },
    { video: 0, audio: 0 }
  );
}

function VideoFolderNode({
  node, planId, isLocked, isParentMode, episodeCounter, onAdjustReps, onSetBgTrack, onListenAsAudio,
}: {
  node: TreeNode; planId: number; isLocked: boolean; isParentMode: boolean; episodeCounter: { n: number };
  onAdjustReps: (videoId: number, delta: number) => void;
  onSetBgTrack: (videoId: number, checked: boolean) => void;
  onListenAsAudio: (video: Video) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const counts = countTypeInTree(node);
  return (
    <div className="mb-1">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 px-2 py-1.5 w-full text-left hover:bg-gray-700/30 rounded-lg transition-colors"
      >
        <span className="text-xs text-gray-500">{expanded ? "▼" : "▶"}</span>
        <span className="text-sm text-gray-400">📁 {node.name}</span>
        <span className="text-[10px] text-gray-600 ml-1">{counts.video} 视频{counts.audio > 0 ? ` · ${counts.audio} 音频` : ""}</span>
      </button>
      {expanded && (
        <div className="ml-4 mt-1 flex flex-col gap-1">
          <VideoTreeLevel nodes={node.children} planId={planId} isLocked={isLocked} isParentMode={isParentMode} episodeCounter={episodeCounter} onAdjustReps={onAdjustReps} onSetBgTrack={onSetBgTrack} onListenAsAudio={onListenAsAudio} />
        </div>
      )}
    </div>
  );
}

function VideoTreeLevel({
  nodes, planId, isLocked, isParentMode, episodeCounter, onAdjustReps, onSetBgTrack, onListenAsAudio,
}: {
  nodes: TreeNode[]; planId: number; isLocked: boolean; isParentMode: boolean; episodeCounter: { n: number };
  onAdjustReps: (videoId: number, delta: number) => void;
  onSetBgTrack: (videoId: number, checked: boolean) => void;
  onListenAsAudio: (video: Video) => void;
}) {
  return (
    <>
      {nodes.map((node, i) =>
        node.type === "folder" ? (
          <VideoFolderNode key={i} node={node} planId={planId} isLocked={isLocked} isParentMode={isParentMode} episodeCounter={episodeCounter} onAdjustReps={onAdjustReps} onSetBgTrack={onSetBgTrack} onListenAsAudio={onListenAsAudio} />
        ) : node.video?.media_type === "video" ? (
          <VideoFileNode key={i} node={node} planId={planId} isLocked={isLocked} isParentMode={isParentMode} episodeNum={++episodeCounter.n} onAdjustReps={onAdjustReps} onSetBgTrack={onSetBgTrack} onListenAsAudio={onListenAsAudio} />
        ) : null
      )}
    </>
  );
}

// ─── Audio tab ────────────────────────────────────────────────────────────────

function AudioTab({
  videos, planId, plan, activating, isParentMode,
  onActivate, onDeactivate, onPriorityChange, onBackgroundToggle, onSaveWeeklySchedule,
  onAdjustReps, onBatchAdjustReps, onSetBgTrack,
}: {
  videos: Video[];
  planId: number;
  plan: Plan;
  activating: boolean;
  isParentMode: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  onPriorityChange: (p: number) => void;
  onBackgroundToggle: (v: boolean) => Promise<void>;
  onSaveWeeklySchedule: (schedule: WeekdaySetting[]) => Promise<void>;
  onAdjustReps: (videoId: number, delta: number) => void;
  onBatchAdjustReps: (delta: number) => Promise<void>;
  onSetBgTrack: (videoId: number, checked: boolean) => Promise<void>;
}) {
  const navigate = useNavigate();
  const { bgAudioPlans, bgSetTrack, bgCurrentPlanId, bgCurrentTrackIdx, bgIsPlaying } = useAppContext();
  const [togglingBg, setTogglingBg] = useState(false);
  const [scheduleExpanded, setScheduleExpanded] = useState(false);

  const audioFiles = [...videos]
    .filter((v) => v.media_type === "audio")
    .sort((a, b) => a.sort_order - b.sort_order);
  // Any file explicitly checked narrows the plan's background set to just the
  // checked files (see backend BG_TRACK_FILTER); with none checked, every
  // audio file in the plan is used.
  const hasBgSelection = audioFiles.some((v) => v.is_bg_track === 1);

  const handleBgToggle = async (checked: boolean) => {
    setTogglingBg(true);
    try { await onBackgroundToggle(checked); } finally { setTogglingBg(false); }
  };

  const today = todaySetting(plan);

  return (
    <div className="space-y-4">
      {/* Background music checkbox */}
      {isParentMode && <div className="px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-lg">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={plan.is_background === 1}
            onChange={(e) => handleBgToggle(e.target.checked)}
            disabled={togglingBg}
            className="w-4 h-4 accent-purple-500"
          />
          <div>
            <span className="text-sm text-gray-200">🎶 同时作为背景音乐</span>
            <p className="text-[10px] text-gray-500 mt-0.5">
              {hasBgSelection
                ? "已勾选部分音频作为背景音乐，仅这些音频会出现在背景播放器中"
                : "勾选后这些音频也会出现在背景播放器中；可在下方文件列表勾选具体音频缩小范围"}
            </p>
          </div>
        </label>
      </div>}

      {/* Priority + batch reps */}
      {isParentMode && <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-gray-500">优先级</span>
        <div className="flex gap-1">
          {PRIORITY_LABELS.map((label, i) => (
            <button
              key={i}
              onClick={() => onPriorityChange(i)}
              className={`px-3 py-1 text-xs rounded-full border transition-all ${
                plan.priority === i
                  ? PRIORITY_COLORS[i] + " bg-gray-700"
                  : "border-gray-700 text-gray-500 hover:border-gray-500"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {plan.is_locked_by_priority && (
          <span className="text-xs text-orange-400">🔒 存在更高优先级计划未完成</span>
        )}
        <div className="ml-auto">
          <BatchRepsControl onAdjust={onBatchAdjustReps} />
        </div>
      </div>}

      {/* Daily schedule */}
      {isParentMode && (plan.daily_schedule_active ? (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-sky-900/20 border border-sky-800/40 rounded-lg">
          <span className="text-sky-400 text-sm">
            📋 今日推荐 {today.episodes} 集
            {today.blank_minutes > 0 && ` · 📝 空白练习 ${today.blank_minutes} 分钟`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => setScheduleExpanded((v) => !v)}
              className="text-xs px-2 py-1 bg-sky-700 hover:bg-sky-600 rounded transition-colors">
              {scheduleExpanded ? "收起每日设置" : "修改每日设置"}
            </button>
            <button onClick={onDeactivate}
              className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded transition-colors text-gray-400">退出</button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-800/50 border border-dashed border-gray-700 rounded-lg">
          <span className="text-gray-500 text-sm">未加入每日计划</span>
          <div className="ml-auto">
            <button onClick={onActivate} disabled={activating}
              className="text-xs px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-lg transition-colors font-medium">
              {activating ? "启动中…" : "开始计划"}
            </button>
          </div>
        </div>
      ))}

      {isParentMode && plan.daily_schedule_active === 1 && (
        <WeeklyScheduleEditor plan={plan} onSave={onSaveWeeklySchedule} expanded={scheduleExpanded} />
      )}

      {/* Audio file list */}
      <div className="flex flex-col gap-1">
        {audioFiles.map((v, idx) => {
          const isBgPlaying =
            plan.is_background === 1 &&
            bgIsPlaying &&
            bgCurrentPlanId === planId &&
            bgAudioPlans.find((p) => p.id === planId)?.tracks[bgCurrentTrackIdx]?.id === v.id;
          const canOpen = canOpenPlanMedia(isParentMode, v.status);

          return (
            <div
              key={v.id}
              onClick={() => { if (canOpen) navigate(`/plan/${planId}/video/${v.id}`); }}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${
                !canOpen
                  ? "border-gray-800 opacity-40 cursor-not-allowed bg-gray-900/30"
                  : isBgPlaying
                  ? "border-purple-700/60 bg-purple-900/20 hover:border-purple-500 cursor-pointer"
                  : v.status === "watching"
                  ? "border-yellow-700/50 bg-gray-800 hover:border-yellow-500 cursor-pointer"
                  : "border-gray-700/50 bg-gray-800 hover:border-sky-600 cursor-pointer"
              }`}
            >
              <span className={`text-sm shrink-0 ${isBgPlaying ? "text-purple-400" : "text-gray-500"}`}>
                {isBgPlaying ? "♪" : "🎵"}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-600 shrink-0">{idx + 1}</span>
                  <span className={`text-sm truncate ${isBgPlaying ? "text-purple-300" : "text-gray-200"}`}>
                    {v.title}
                  </span>
                  {v.status === "watched" && (
                    <span className="text-[10px] text-green-500 shrink-0">
                      {v.completed_reps > 0 ? "已学" : "无需学习"}
                    </span>
                  )}
                  {v.required_reps > 1 && (
                    <span className="text-[10px] text-sky-400 shrink-0">练习 {v.completed_reps}/{v.required_reps}</span>
                  )}
                  {!canOpen && <span className="text-xs shrink-0">🔒</span>}
                </div>
                {v.status === "watching" && v.progress_seconds > 0 && (
                  <span className="text-[10px] text-yellow-400 ml-5">
                    已听至 {formatTime(v.progress_seconds)}
                    {v.duration_seconds ? ` / ${formatTime(v.duration_seconds)}` : ""}
                  </span>
                )}
              </div>
              {v.duration_seconds && (
                <span className="text-[10px] text-gray-600 shrink-0">{formatTime(v.duration_seconds)}</span>
              )}
              <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[v.status] ?? "bg-gray-600"}`} />
              {isParentMode && plan.is_background === 1 && (
                <label
                  onClick={(e) => e.stopPropagation()}
                  title="作为背景音乐（不勾选任何音频时默认全部作为背景音乐）"
                  className="flex items-center gap-1 shrink-0 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={v.is_bg_track === 1}
                    onChange={(e) => onSetBgTrack(v.id, e.target.checked)}
                    className="w-3.5 h-3.5 accent-purple-500"
                  />
                  <span className="text-[10px] text-purple-400">🎶</span>
                </label>
              )}
              {isParentMode && (
                <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => onAdjustReps(v.id, -1)}
                    className="w-5 h-5 flex items-center justify-center text-[10px] bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors">−</button>
                  <span className="w-4 text-center text-[10px] text-gray-400">{v.required_reps}</span>
                  <button onClick={() => onAdjustReps(v.id, 1)}
                    className="w-5 h-5 flex items-center justify-center text-[10px] bg-gray-700 hover:bg-gray-600 rounded text-gray-300 transition-colors">+</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Background player quick-play section */}
      {plan.is_background === 1 && bgAudioPlans.find((p) => p.id === planId) && (
        <div className="mt-2 px-4 py-2.5 bg-purple-900/10 border border-purple-900/30 rounded-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs text-purple-400">🎶 在背景播放器中播放</span>
            <button
              onClick={() => bgSetTrack(planId, 0)}
              className="text-xs text-purple-300 hover:text-purple-200 transition-colors"
            >
              从头开始 ▶
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Document tab ─────────────────────────────────────────────────────────────

const DOCUMENT_ICON: Record<string, string> = {
  pdf: "📕",
};
function documentIcon(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) return "🖼️";
  return DOCUMENT_ICON[ext] ?? "📄";
}

function DocumentTab({ videos, planId }: { videos: Video[]; planId: number }) {
  const navigate = useNavigate();
  const documentFiles = [...videos]
    .filter((v) => v.media_type === "document")
    .sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="flex flex-col gap-1">
      {documentFiles.map((v, idx) => (
        <div
          key={v.id}
          onClick={() => navigate(`/plan/${planId}/document/${v.id}`)}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-700/50 bg-gray-800 hover:border-amber-600 cursor-pointer transition-all"
        >
          <span className="text-sm shrink-0 text-gray-500">{documentIcon(v.file_path)}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-600 shrink-0">{idx + 1}</span>
              <span className="text-sm truncate text-gray-200">{v.title}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PlanPage() {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const id = Number(planId);
  const { videos, loading, error, refresh } = useVideos(id);
  const { isLimitExceeded, isParentMode, bgRefreshPlans, bgSetTrack, bgAudioPlans } = useAppContext();
  const [rescanning, setRescanning] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [activating, setActivating] = useState(false);
  const [priority, setPriority] = useState(0);
  const [scheduleExpanded, setScheduleExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"video" | "audio" | "document">("video");
  const [scanNotice, setScanNotice] = useState<string | null>(
    (location.state as { scanNotice?: string } | null)?.scanNotice ?? null,
  );

  const loadPlan = async () => {
    const all = await listPlans();
    const found = all.find((p) => p.id === id) ?? null;
    setPlan(found);
    if (found) {
      setPriority(found.priority);
    }
  };

  useEffect(() => { loadPlan(); }, [id]);

  const hasVideo = videos.some((v) => v.media_type === "video");
  const hasAudio = videos.some((v) => v.media_type === "audio");
  const hasDocument = videos.some((v) => v.media_type === "document");

  useEffect(() => {
    if (!hasVideo && !hasAudio && hasDocument) setActiveTab("document");
    else if (!hasVideo && hasAudio) setActiveTab("audio");
    else setActiveTab("video");
  }, [hasVideo, hasAudio, hasDocument]);

  const handleRescan = async () => {
    setRescanning(true);
    setScanNotice(null);
    try {
      const report = await rescanPlan(id);
      const parts = [`发现 ${report.found} 个媒体文件`, `本计划 ${report.added} 个`];
      if (report.skipped > 0) {
        const names = report.skipped_names.slice(0, 5).join("、");
        const more = report.skipped_names.length < report.skipped ? " 等" : "";
        parts.push(`${report.skipped} 个已被其它计划收录（${names}${more}）`);
      }
      setScanNotice(parts.join("，"));
      await refresh();
      await loadPlan();
    } finally {
      setRescanning(false);
    }
  };

  const handleDelete = async () => {
    if (plan?.is_protected) {
      alert("该计划已受保护，请先取消保护后再删除");
      return;
    }
    if (!confirm("确认删除此计划？（不会删除磁盘上的文件）")) return;
    await deletePlan(id);
    navigate("/plans");
  };

  const handleToggleProtected = async () => {
    if (!plan) return;
    const next = plan.is_protected ? 0 : 1;
    if (!next && !confirm("取消保护后，此计划及其文件可以被删除或清理。确认取消保护？")) return;
    await setPlanProtected(id, next);
    await loadPlan();
  };

  const handleActivate = async () => {
    setActivating(true);
    try { await activatePlan(id, 1); await loadPlan(); } finally { setActivating(false); }
  };

  const handleSavePriority = async (p: number) => {
    setPriority(p);
    await setPlanPriority(id, p);
    await loadPlan();
  };

  const handleBackgroundToggle = async (enabled: boolean) => {
    await setPlanBackground(id, enabled ? 1 : 0);
    await loadPlan();
    await bgRefreshPlans();
  };

  const handleSetBgTrack = async (videoId: number, checked: boolean) => {
    await setVideoBgTrack(videoId, checked);
    await refresh();
    await bgRefreshPlans();
  };

  const handleBgWatchedVideoToggle = async (enabled: boolean) => {
    await setPlanBgWatchedVideo(id, enabled ? 1 : 0);
    await loadPlan();
    await refresh();
    await bgRefreshPlans();
  };

  const handleListenAsAudio = async (video: Video) => {
    const findIdx = (plans: typeof bgAudioPlans) =>
      plans.find((p) => p.id === id)?.tracks.findIndex((t) => t.id === video.id) ?? -1;

    let idx = findIdx(bgAudioPlans);
    if (idx < 0) {
      let plans = await bgRefreshPlans();
      idx = findIdx(plans);
      if (idx < 0) {
        await setVideoBgTrack(video.id, true);
        await refresh();
        plans = await bgRefreshPlans();
        idx = findIdx(plans);
      }
    }
    if (idx >= 0) bgSetTrack(id, idx);
  };

  const handleSaveWeeklySchedule = async (schedule: WeekdaySetting[]) => {
    await setPlanWeeklySchedule(id, schedule);
    await loadPlan();
  };

  const handleAdjustReps = async (videoId: number, delta: number) => {
    await adjustVideoReps(videoId, delta);
    await refresh();
  };

  const handleBatchAdjustReps = async (delta: number) => {
    await batchAdjustPlanReps(id, delta);
    await refresh();
    await loadPlan();
  };

  const videoTree = plan ? buildTree(videos.filter((v) => v.media_type === "video"), plan.folder_path) : [];
  const isLockedOverall = (plan?.is_locked_by_priority ?? false) || isLimitExceeded;
  const typeCount = [hasVideo, hasAudio, hasDocument].filter(Boolean).length;
  const showTabs = typeCount > 1;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate("/plans")} className="text-gray-400 hover:text-gray-200 text-sm transition-colors">
          ← 返回
        </button>
        {isParentMode && (
          <div className="flex items-center gap-2 ml-auto">
            <button onClick={handleRescan} disabled={rescanning} className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg transition-colors">
              {rescanning ? "扫描中…" : "重新扫描"}
            </button>
            <button
              onClick={handleToggleProtected}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                plan?.is_protected
                  ? "bg-amber-900/60 hover:bg-amber-800 text-amber-300"
                  : "bg-gray-700 hover:bg-gray-600 text-gray-300"
              }`}
            >
              {plan?.is_protected ? "🔒 已保护" : "🔓 保护"}
            </button>
            <button
              onClick={handleDelete}
              disabled={!!plan?.is_protected}
              title={plan?.is_protected ? "已受保护，需先取消保护" : undefined}
              className="px-3 py-1.5 text-xs bg-red-900/60 hover:bg-red-800 disabled:opacity-40 disabled:hover:bg-red-900/60 rounded-lg transition-colors text-red-300"
            >
              删除
            </button>
          </div>
        )}
      </div>

      {plan && (
        <div className="mb-5">
          <h1 className="text-xl font-bold text-gray-100 mb-1">{plan.name}</h1>
          <div className="flex items-center gap-2 text-[10px] text-gray-500">
            {plan.video_count > 0 && <span>🎬 {plan.video_count} 视频</span>}
            {plan.audio_count > 0 && <span>🎵 {plan.audio_count} 音频</span>}
            {plan.document_count > 0 && <span>📄 {plan.document_count} 文档</span>}
            {(plan.is_background === 1 || plan.bg_watched_video === 1) && <span className="text-purple-400">· 🎶 背景音乐</span>}
            {plan.is_protected === 1 && <span className="text-amber-400">· 🔒 已保护</span>}
            {plan.watched_count > 0 && <span>· {plan.watched_count} 已完成</span>}
          </div>
          <TagEditor
            planId={id}
            boundTags={plan.tags ?? []}
            editable={isParentMode}
            onChange={loadPlan}
          />
        </div>
      )}

      {scanNotice && (
        <div className="mb-4 px-4 py-3 bg-sky-900/40 border border-sky-700/60 rounded-lg text-sm text-sky-200 flex items-start gap-2">
          <span className="shrink-0">📋</span>
          <span className="flex-1">{scanNotice}</span>
          <button onClick={() => setScanNotice(null)} className="shrink-0 text-sky-400 hover:text-sky-200">✕</button>
        </div>
      )}

      {!isParentMode && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-gray-800/40 border border-gray-700 rounded-lg text-sm text-gray-500">
          <span>🔒</span>
          <span>儿童模式可重温已学内容。未学内容请在「今日学习」完成，或切换到家长模式</span>
        </div>
      )}

      {/* Tab bar */}
      {showTabs && (
        <div className="flex gap-1 mb-5 border-b border-gray-800">
          {(
            [
              { key: "video" as const, has: hasVideo, label: "🎬 视频", color: "border-sky-500 text-sky-400" },
              { key: "audio" as const, has: hasAudio, label: "🎵 音频", color: "border-purple-500 text-purple-400" },
              { key: "document" as const, has: hasDocument, label: "📄 文档", color: "border-amber-500 text-amber-400" },
            ]
          )
            .filter((tab) => tab.has)
            .map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-sm font-medium transition-all border-b-2 -mb-px ${
                  activeTab === tab.key ? tab.color : "border-transparent text-gray-500 hover:text-gray-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
        </div>
      )}

      {/* ── Video Tab ── */}
      {(activeTab === "video" || !showTabs) && hasVideo && plan && (
        <div>
          {isParentMode && <div className="px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-lg mb-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={plan.bg_watched_video === 1}
                onChange={(e) => handleBgWatchedVideoToggle(e.target.checked)}
                className="w-4 h-4 accent-purple-500"
              />
              <div>
                <span className="text-sm text-gray-200">🎶 已看视频作为背景音</span>
                <p className="text-[10px] text-gray-500 mt-0.5">
                  只出声、不占视频时长；未看完的不会进入。也可在下方已看条目上点「听」或勾选单曲。
                </p>
              </div>
            </label>
          </div>}

          {/* Priority + batch reps */}
          {isParentMode && <div className="flex items-center gap-3 flex-wrap mb-3">
            <span className="text-xs text-gray-500">优先级</span>
            <div className="flex gap-1">
              {PRIORITY_LABELS.map((label, i) => (
                <button
                  key={i}
                  onClick={() => handleSavePriority(i)}
                  className={`px-3 py-1 text-xs rounded-full border transition-all ${
                    priority === i
                      ? PRIORITY_COLORS[i] + " bg-gray-700"
                      : "border-gray-700 text-gray-500 hover:border-gray-500"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {plan.is_locked_by_priority && (
              <span className="text-xs text-orange-400">🔒 存在更高优先级计划未完成</span>
            )}
            <div className="ml-auto">
              <BatchRepsControl onAdjust={handleBatchAdjustReps} />
            </div>
          </div>}

          {/* Daily schedule */}
          {isParentMode && (plan.daily_schedule_active ? (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-sky-900/20 border border-sky-800/40 rounded-lg mb-4">
              <span className="text-sky-400 text-sm">
                📋 今日推荐 {todaySetting(plan).episodes} 集
                {todaySetting(plan).blank_minutes > 0 && ` · 📝 空白练习 ${todaySetting(plan).blank_minutes} 分钟`}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <button onClick={() => setScheduleExpanded((v) => !v)}
                  className="text-xs px-2 py-1 bg-sky-700 hover:bg-sky-600 rounded transition-colors">
                  {scheduleExpanded ? "收起每日设置" : "修改每日设置"}
                </button>
                <button onClick={async () => { await deactivatePlan(id); await loadPlan(); }} className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded transition-colors text-gray-400">退出</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-800/50 border border-dashed border-gray-700 rounded-lg mb-4">
              <span className="text-gray-500 text-sm">未加入每日计划</span>
              <div className="ml-auto">
                <button onClick={handleActivate} disabled={activating} className="text-xs px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-lg transition-colors font-medium">
                  {activating ? "启动中…" : "开始计划"}
                </button>
              </div>
            </div>
          ))}

          {isParentMode && plan.daily_schedule_active === 1 && (
            <WeeklyScheduleEditor plan={plan} onSave={handleSaveWeeklySchedule} expanded={scheduleExpanded} />
          )}

          {loading && <div className="text-center text-gray-500 py-8">加载中…</div>}
          {error && <div className="text-center text-red-400 py-4">{error}</div>}
          {!loading && videoTree.length === 0 && (
            <div className="text-center text-gray-500 py-8">
              <p>此文件夹中没有找到视频文件</p>
              {isParentMode && <button onClick={handleRescan} className="mt-3 text-sky-400 text-sm">重新扫描</button>}
            </div>
          )}
          {videoTree.length > 0 && (
            <div className="flex flex-col gap-1">
              <VideoTreeLevel nodes={videoTree} planId={id} isLocked={isLockedOverall} isParentMode={isParentMode} episodeCounter={{ n: 0 }} onAdjustReps={handleAdjustReps} onSetBgTrack={handleSetBgTrack} onListenAsAudio={handleListenAsAudio} />
            </div>
          )}
          {bgAudioPlans.find((p) => p.id === id) && (
            <div className="mt-2 px-4 py-2.5 bg-purple-900/10 border border-purple-900/30 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs text-purple-400">🎶 在背景播放器中播放</span>
                <button
                  onClick={() => bgSetTrack(id, 0)}
                  className="text-xs text-purple-300 hover:text-purple-200 transition-colors"
                >
                  从头开始 ▶
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Audio Tab ── */}
      {(activeTab === "audio" || (!showTabs && !hasVideo)) && hasAudio && plan && (
        <AudioTab
          videos={videos}
          planId={id}
          plan={plan}
          activating={activating}
          isParentMode={isParentMode}
          onActivate={handleActivate}
          onDeactivate={async () => { await deactivatePlan(id); await loadPlan(); }}
          onPriorityChange={handleSavePriority}
          onBackgroundToggle={handleBackgroundToggle}
          onSaveWeeklySchedule={handleSaveWeeklySchedule}
          onAdjustReps={handleAdjustReps}
          onBatchAdjustReps={handleBatchAdjustReps}
          onSetBgTrack={handleSetBgTrack}
        />
      )}

      {/* ── Document Tab ── */}
      {(activeTab === "document" || (!showTabs && !hasVideo && !hasAudio)) && hasDocument && plan && (
        <DocumentTab videos={videos} planId={id} />
      )}

      {loading && !videos.length && (
        <div className="text-center text-gray-500 py-16">加载中…</div>
      )}
      {error && <div className="text-center text-red-400 py-8">{error}</div>}
      {!loading && !hasVideo && !hasAudio && !hasDocument && (
        <div className="text-center text-gray-500 py-16">
          <p>此文件夹中没有找到媒体文件</p>
          <p className="text-xs text-gray-600 mt-2 max-w-md mx-auto leading-relaxed">
            若文件夹内确实有视频/音频，通常是这些文件已被<strong className="text-gray-500">上级目录（或其它）计划</strong>收录。
            每个文件只能属于一个计划，请删除重复的计划，或改用未被收录的文件夹。
          </p>
          {isParentMode && <button onClick={handleRescan} className="mt-4 text-sky-400 text-sm">重新扫描</button>}
        </div>
      )}
    </div>
  );
}
