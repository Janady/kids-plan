import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../context/AppContext";
import { canOpenPlanMedia } from "./PlanCard";
import type { Plan, Video, WeekdaySetting } from "../types";

export const PRIORITY_LABELS = ["无", "低", "中", "高"];
export const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function todayWeekdayIdx(): number {
  return (new Date().getDay() + 6) % 7;
}

export function todaySetting(plan: Plan): WeekdaySetting {
  return plan.weekly_schedule[todayWeekdayIdx()] ?? { episodes: plan.episodes_per_day, blank_minutes: 0 };
}

export function formatTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const STATUS_DOT: Record<string, string> = {
  not_watched: "bg-mute/40",
  watching: "bg-sun",
  watched: "bg-leaf",
};

interface TreeNode {
  type: "folder" | "file";
  name: string;
  children: TreeNode[];
  video?: Video;
}

export function buildTree(videos: Video[], rootPath: string): TreeNode[] {
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

export function WeeklyScheduleEditor({
  plan,
  onSave,
  expanded,
}: {
  plan: Plan;
  onSave: (schedule: WeekdaySetting[]) => Promise<void>;
  expanded: boolean;
}) {
  const [rows, setRows] = useState<WeekdaySetting[]>(plan.weekly_schedule);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setRows(plan.weekly_schedule);
  }, [plan.weekly_schedule]);

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
    <div className="card mt-2 mb-3" style={{ padding: 12 }}>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2">
          <span className="text-xs text-ink w-10 shrink-0">{WEEKDAY_LABELS[i]}</span>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              value={row.episodes}
              onChange={(e) => updateRow(i, { episodes: Math.max(0, Number(e.target.value) || 0) })}
              className="w-14 h-9 rounded-lg bg-paper text-center text-sm"
            />
            <span className="text-[11px] text-mute">集</span>
          </div>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              max={60}
              value={row.blank_minutes}
              onChange={(e) => updateRow(i, { blank_minutes: Math.min(60, Math.max(0, Number(e.target.value) || 0)) })}
              className="w-14 h-9 rounded-lg bg-paper text-center text-sm"
            />
            <span className="text-[11px] text-mute">分钟空白练习</span>
          </div>
        </div>
      ))}
      <button onClick={handleSave} disabled={saving} className="primary mt-2">
        {saved ? "已保存 ✓" : saving ? "保存中…" : "保存"}
      </button>
    </div>
  );
}

export function BatchRepsControl({ onAdjust }: { onAdjust: (delta: number) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const handle = async (delta: number) => {
    setBusy(true);
    try {
      await onAdjust(delta);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-mute">批量练习次数</span>
      <span className="stepper">
        <button onClick={() => handle(-1)} disabled={busy}>
          −
        </button>
        <button onClick={() => handle(1)} disabled={busy}>
          +
        </button>
      </span>
    </div>
  );
}

function VideoFileNode({
  node,
  planId,
  isParentMode,
  episodeNum,
  onAdjustReps,
  onSetBgTrack,
  onListenAsAudio,
}: {
  node: TreeNode;
  planId: number;
  isLocked: boolean;
  isParentMode: boolean;
  episodeNum: number;
  onAdjustReps: (videoId: number, delta: number) => void;
  onSetBgTrack: (videoId: number, checked: boolean) => void;
  onListenAsAudio: (video: Video) => void;
}) {
  const navigate = useNavigate();
  const { isCastActive, castSnapshot, switchCastVideo, bgAudioPlans, bgCurrentPlanId, bgCurrentTrackIdx, bgIsPlaying } =
    useAppContext();
  const video = node.video!;
  const cleared = video.file_exists === false;
  const locked = cleared || !canOpenPlanMedia(isParentMode, video.status);
  const isCastingThis = castSnapshot?.current?.video_id === video.id;
  const canListen = video.status === "watched" && !cleared;
  const isBgPlaying =
    canListen &&
    bgIsPlaying &&
    bgCurrentPlanId === planId &&
    bgAudioPlans.find((p) => p.id === planId)?.tracks[bgCurrentTrackIdx]?.id === video.id;
  const pct =
    video.status === "watching" && video.duration_seconds
      ? Math.min(100, (video.progress_seconds / video.duration_seconds) * 100)
      : 0;

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
    <div onClick={handleClick} className={`acc ${locked ? "opacity-50" : ""}`} role="button">
      <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[video.status] ?? "bg-mute/40"}`} />
      <span className="acc-main">
        <b className={cleared ? "line-through" : ""}>
          {episodeNum}. {video.title}
        </b>
        <small>
          {cleared
            ? "已清理"
            : video.status === "watched"
              ? video.completed_reps > 0
                ? "已学"
                : "无需学习"
              : video.status === "watching" && video.progress_seconds > 0
                ? `已看至 ${formatTime(video.progress_seconds)}`
                : video.duration_seconds
                  ? formatTime(video.duration_seconds)
                  : ""}
          {video.required_reps > 1 ? ` · 练习 ${video.completed_reps}/${video.required_reps}` : ""}
          {isCastingThis ? " · 投屏中" : ""}
          {locked && !cleared ? " · 未学" : ""}
        </small>
        {video.status === "watching" && pct > 0 && (
          <div className="progress sun mt-1">
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
      </span>
      {canListen && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onListenAsAudio(video);
          }}
          className="chip audio"
        >
          {isBgPlaying ? "播放中" : "听"}
        </button>
      )}
      {isParentMode && canListen && (
        <label onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 shrink-0">
          <input
            type="checkbox"
            checked={video.is_bg_track === 1}
            onChange={(e) => onSetBgTrack(video.id, e.target.checked)}
          />
        </label>
      )}
      {isParentMode && (
        <span className="stepper" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => onAdjustReps(video.id, -1)}>−</button>
          <b>{video.required_reps}</b>
          <button onClick={() => onAdjustReps(video.id, 1)}>+</button>
        </span>
      )}
    </div>
  );
}

function countTypeInTree(node: TreeNode): { video: number; audio: number } {
  if (node.type === "file") {
    return node.video?.media_type === "audio" ? { video: 0, audio: 1 } : { video: 1, audio: 0 };
  }
  return node.children.reduce(
    (acc, c) => {
      const s = countTypeInTree(c);
      return { video: acc.video + s.video, audio: acc.audio + s.audio };
    },
    { video: 0, audio: 0 },
  );
}

function VideoFolderNode({
  node,
  planId,
  isLocked,
  isParentMode,
  episodeCounter,
  onAdjustReps,
  onSetBgTrack,
  onListenAsAudio,
}: {
  node: TreeNode;
  planId: number;
  isLocked: boolean;
  isParentMode: boolean;
  episodeCounter: { n: number };
  onAdjustReps: (videoId: number, delta: number) => void;
  onSetBgTrack: (videoId: number, checked: boolean) => void;
  onListenAsAudio: (video: Video) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const counts = countTypeInTree(node);
  return (
    <div>
      <button onClick={() => setExpanded((v) => !v)} className="acc">
        <span className="acc-ico">📁</span>
        <span className="acc-main">
          <b>{node.name}</b>
          <small>
            {counts.video} 视频{counts.audio > 0 ? ` · ${counts.audio} 音频` : ""}
          </small>
        </span>
        <span className="text-mute text-xs">{expanded ? "收起" : "展开"}</span>
      </button>
      {expanded && (
        <div className="ml-3">
          <VideoTreeLevel
            nodes={node.children}
            planId={planId}
            isLocked={isLocked}
            isParentMode={isParentMode}
            episodeCounter={episodeCounter}
            onAdjustReps={onAdjustReps}
            onSetBgTrack={onSetBgTrack}
            onListenAsAudio={onListenAsAudio}
          />
        </div>
      )}
    </div>
  );
}

export function VideoTreeLevel({
  nodes,
  planId,
  isLocked,
  isParentMode,
  episodeCounter,
  onAdjustReps,
  onSetBgTrack,
  onListenAsAudio,
}: {
  nodes: TreeNode[];
  planId: number;
  isLocked: boolean;
  isParentMode: boolean;
  episodeCounter: { n: number };
  onAdjustReps: (videoId: number, delta: number) => void;
  onSetBgTrack: (videoId: number, checked: boolean) => void;
  onListenAsAudio: (video: Video) => void;
}) {
  return (
    <>
      {nodes.map((node, i) =>
        node.type === "folder" ? (
          <VideoFolderNode
            key={i}
            node={node}
            planId={planId}
            isLocked={isLocked}
            isParentMode={isParentMode}
            episodeCounter={episodeCounter}
            onAdjustReps={onAdjustReps}
            onSetBgTrack={onSetBgTrack}
            onListenAsAudio={onListenAsAudio}
          />
        ) : node.video?.media_type === "video" ? (
          <VideoFileNode
            key={i}
            node={node}
            planId={planId}
            isLocked={isLocked}
            isParentMode={isParentMode}
            episodeNum={++episodeCounter.n}
            onAdjustReps={onAdjustReps}
            onSetBgTrack={onSetBgTrack}
            onListenAsAudio={onListenAsAudio}
          />
        ) : null,
      )}
    </>
  );
}

export function AudioList({
  videos,
  planId,
  plan,
  isParentMode,
  onAdjustReps,
  onSetBgTrack,
}: {
  videos: Video[];
  planId: number;
  plan: Plan;
  isParentMode: boolean;
  onAdjustReps: (videoId: number, delta: number) => void;
  onSetBgTrack: (videoId: number, checked: boolean) => Promise<void>;
}) {
  const navigate = useNavigate();
  const { bgAudioPlans, bgCurrentPlanId, bgCurrentTrackIdx, bgIsPlaying } = useAppContext();
  const audioFiles = [...videos].filter((v) => v.media_type === "audio").sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="card">
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
            onClick={() => {
              if (canOpen) navigate(`/plan/${planId}/video/${v.id}`);
            }}
            className={`acc ${canOpen ? "" : "opacity-50"}`}
            role="button"
          >
            <span className="kind-ico audio">{isBgPlaying ? "♪" : "音"}</span>
            <span className="acc-main">
              <b>
                {idx + 1}. {v.title}
              </b>
              <small>
                {v.status === "watched" ? (v.completed_reps > 0 ? "已学" : "无需学习") : ""}
                {v.status === "watching" && v.progress_seconds > 0
                  ? `已听至 ${formatTime(v.progress_seconds)}${v.duration_seconds ? ` / ${formatTime(v.duration_seconds)}` : ""}`
                  : v.duration_seconds
                    ? formatTime(v.duration_seconds)
                    : ""}
                {v.required_reps > 1 ? ` · 练习 ${v.completed_reps}/${v.required_reps}` : ""}
                {!canOpen ? " · 未学" : ""}
              </small>
            </span>
            {isParentMode && plan.is_background === 1 && (
              <label onClick={(e) => e.stopPropagation()} className="flex items-center">
                <input type="checkbox" checked={v.is_bg_track === 1} onChange={(e) => onSetBgTrack(v.id, e.target.checked)} />
              </label>
            )}
            {isParentMode && (
              <span className="stepper" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => onAdjustReps(v.id, -1)}>−</button>
                <b>{v.required_reps}</b>
                <button onClick={() => onAdjustReps(v.id, 1)}>+</button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

const DOCUMENT_ICON: Record<string, string> = { pdf: "📕" };
function documentIcon(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp"].includes(ext)) return "🖼️";
  return DOCUMENT_ICON[ext] ?? "📄";
}

export function DocumentList({ videos, planId }: { videos: Video[]; planId: number }) {
  const navigate = useNavigate();
  const documentFiles = [...videos].filter((v) => v.media_type === "document").sort((a, b) => a.sort_order - b.sort_order);
  return (
    <div className="card">
      {documentFiles.map((v, idx) => (
        <button key={v.id} className="acc" onClick={() => navigate(`/plan/${planId}/document/${v.id}`)}>
          <span className="kind-ico doc">{documentIcon(v.file_path)}</span>
          <span className="acc-main">
            <b>
              {idx + 1}. {v.title}
            </b>
          </span>
        </button>
      ))}
    </div>
  );
}
