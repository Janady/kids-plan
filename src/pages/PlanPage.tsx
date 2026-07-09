import { useParams, useNavigate } from "react-router-dom";
import { useVideos } from "../hooks/useVideos";
import { useAppContext } from "../context/AppContext";
import { rescanPlan, deletePlan, activatePlan, deactivatePlan, listPlans, setPlanPriority } from "../api/plans";
import { useState, useEffect } from "react";import type { Plan, Video } from "../types";

// ─── Priority ────────────────────────────────────────────────────────────────

const PRIORITY_LABELS = ["无", "低", "中", "高"];
const PRIORITY_COLORS = [
  "text-gray-500 border-gray-600",
  "text-blue-400 border-blue-700",
  "text-yellow-400 border-yellow-700",
  "text-red-400 border-red-700",
];

// ─── Folder tree ─────────────────────────────────────────────────────────────

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

  // Sort by sort_order so files appear in canonical order
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

function FileNode({
  node,
  planId,
  isParentMode,
  episodeNum,
}: {
  node: TreeNode;
  planId: number;
  isLocked: boolean; // kept for interface compatibility; lock is solely from isParentMode
  isParentMode: boolean;
  episodeNum: number;
}) {
  const navigate = useNavigate();
  const video = node.video!;
  // Plan detail view always requires parent mode — child mode never opens videos here
  const locked = !isParentMode;
  const pct =
    video.status === "watching" && video.duration_seconds
      ? Math.min(100, (video.progress_seconds / video.duration_seconds) * 100)
      : 0;

  return (
    <div
      onClick={() => !locked && navigate(`/plan/${planId}/video/${video.id}`)}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${
        locked
          ? "border-gray-800 opacity-40 cursor-not-allowed bg-gray-900/30"
          : video.status === "watching"
          ? "border-yellow-700/50 bg-gray-800 hover:border-yellow-500 cursor-pointer"
          : "border-gray-700/50 bg-gray-800 hover:border-sky-600 cursor-pointer"
      }`}
    >
      {/* Status indicator */}
      <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[video.status] ?? "bg-gray-600"}`} />
      {locked && <span className="text-xs shrink-0">🔒</span>}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-600 shrink-0">{episodeNum}</span>
          <span className="text-sm text-gray-200 truncate">{video.title}</span>
        </div>
        {video.status === "watching" && video.progress_seconds > 0 && (
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

      {video.duration_seconds && (
        <span className="text-[10px] text-gray-600 shrink-0">
          {formatTime(video.duration_seconds)}
        </span>
      )}
    </div>
  );
}

function FolderNode({
  node,
  planId,
  isLocked,
  isParentMode,
  episodeCounter,
}: {
  node: TreeNode;
  planId: number;
  isLocked: boolean;
  isParentMode: boolean;
  episodeCounter: { n: number };
}) {
  const [expanded, setExpanded] = useState(true);
  const fileCount = countFiles(node);

  return (
    <div className="mb-1">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 px-2 py-1.5 w-full text-left hover:bg-gray-700/30 rounded-lg transition-colors"
      >
        <span className="text-xs text-gray-500">{expanded ? "▼" : "▶"}</span>
        <span className="text-sm text-gray-400">📁 {node.name}</span>
        <span className="text-[10px] text-gray-600 ml-1">{fileCount} 个视频</span>
      </button>
      {expanded && (
        <div className="ml-4 mt-1 flex flex-col gap-1">
          <TreeLevel
            nodes={node.children}
            planId={planId}
            isLocked={isLocked}
            isParentMode={isParentMode}
            episodeCounter={episodeCounter}
          />
        </div>
      )}
    </div>
  );
}

function countFiles(node: TreeNode): number {
  if (node.type === "file") return 1;
  return node.children.reduce((s, c) => s + countFiles(c), 0);
}

function TreeLevel({
  nodes,
  planId,
  isLocked,
  isParentMode,
  episodeCounter,
}: {
  nodes: TreeNode[];
  planId: number;
  isLocked: boolean;
  isParentMode: boolean;
  episodeCounter: { n: number };
}) {
  return (
    <>
      {nodes.map((node, i) =>
        node.type === "folder" ? (
          <FolderNode
            key={i}
            node={node}
            planId={planId}
            isLocked={isLocked}
            isParentMode={isParentMode}
            episodeCounter={episodeCounter}
          />
        ) : (
          <FileNode
            key={i}
            node={node}
            planId={planId}
            isLocked={isLocked}
            isParentMode={isParentMode}
            episodeNum={++episodeCounter.n}
          />
        )
      )}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PlanPage() {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const id = Number(planId);
  const { videos, loading, error, refresh } = useVideos(id);
  const { isLimitExceeded, isParentMode } = useAppContext();
  const [rescanning, setRescanning] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [epPerDay, setEpPerDay] = useState(1);
  const [activating, setActivating] = useState(false);
  const [priority, setPriority] = useState(0);

  const loadPlan = async () => {
    const all = await listPlans();
    const found = all.find((p) => p.id === id) ?? null;
    setPlan(found);
    if (found) {
      setEpPerDay(found.episodes_per_day);
      setPriority(found.priority);
    }
  };

  useEffect(() => { loadPlan(); }, [id]);

  const handleRescan = async () => {
    setRescanning(true);
    try { await rescanPlan(id); await refresh(); } finally { setRescanning(false); }
  };

  const handleDelete = async () => {
    if (!confirm("确认删除此计划？（不会删除磁盘上的文件）")) return;
    await deletePlan(id);
    navigate("/");
  };

  const handleActivate = async () => {
    setActivating(true);
    try { await activatePlan(id, epPerDay); await loadPlan(); } finally { setActivating(false); }
  };

  const handleSavePriority = async (p: number) => {
    setPriority(p);
    await setPlanPriority(id, p);
    await loadPlan();
  };

  const tree = plan ? buildTree(videos, plan.folder_path) : [];
  const isLockedOverall = (plan?.is_locked_by_priority ?? false) || isLimitExceeded;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <button onClick={() => navigate("/")} className="text-gray-400 hover:text-gray-200 text-sm transition-colors">
          ← 返回
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={handleRescan} disabled={rescanning} className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg transition-colors">
            {rescanning ? "扫描中…" : "重新扫描"}
          </button>
          <button onClick={handleDelete} className="px-3 py-1.5 text-xs bg-red-900/60 hover:bg-red-800 rounded-lg transition-colors text-red-300">
            删除
          </button>
        </div>
      </div>

      {plan && (
        <div className="mb-5 space-y-3">
          <h1 className="text-xl font-bold text-gray-100">{plan.name}</h1>

          {/* Priority */}
          <div className="flex items-center gap-3 flex-wrap">
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
          </div>

          {/* Daily schedule */}
          {plan.daily_schedule_active ? (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-sky-900/20 border border-sky-800/40 rounded-lg">
              <span className="text-sky-400 text-sm">📋 每日推荐 {plan.episodes_per_day} 集</span>
              <div className="ml-auto flex items-center gap-2">
                <select value={epPerDay} onChange={(e) => setEpPerDay(Number(e.target.value))} className="bg-gray-800 border border-gray-600 rounded text-xs text-gray-300 px-2 py-1 outline-none">
                  {[1, 2, 3, 5].map((n) => <option key={n} value={n}>{n} 集/天</option>)}
                </select>
                <button onClick={handleActivate} disabled={activating || epPerDay === plan.episodes_per_day} className="text-xs px-2 py-1 bg-sky-700 hover:bg-sky-600 disabled:opacity-40 rounded transition-colors">更新</button>
                <button onClick={async () => { await deactivatePlan(id); await loadPlan(); }} className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded transition-colors text-gray-400">退出</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-800/50 border border-dashed border-gray-700 rounded-lg">
              <span className="text-gray-500 text-sm">未加入每日计划</span>
              <div className="ml-auto flex items-center gap-2">
                <select value={epPerDay} onChange={(e) => setEpPerDay(Number(e.target.value))} className="bg-gray-800 border border-gray-600 rounded text-xs text-gray-300 px-2 py-1 outline-none">
                  {[1, 2, 3, 5].map((n) => <option key={n} value={n}>{n} 集</option>)}
                </select>
                <button onClick={handleActivate} disabled={activating} className="text-xs px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-lg transition-colors font-medium">
                  {activating ? "启动中…" : "加入每日计划"}
                </button>
              </div>
            </div>
          )}

          <div className="text-xs text-gray-600">共 {plan.video_count} 集 · {plan.watched_count} 集已完成</div>
        </div>
      )}

      {/* Parent mode notice */}
      {!isParentMode && (
        <div className="mb-4 flex items-center gap-2 px-4 py-2.5 bg-gray-800/40 border border-gray-700 rounded-lg text-sm text-gray-500">
          <span>🔒</span>
          <span>切换到家长模式后可播放视频</span>
        </div>
      )}

      {loading && <div className="text-center text-gray-500 py-16">加载中…</div>}
      {error && <div className="text-center text-red-400 py-8">{error}</div>}
      {!loading && videos.length === 0 && (
        <div className="text-center text-gray-500 py-16">
          <p>此文件夹中没有找到视频文件</p>
          <button onClick={handleRescan} className="mt-4 text-sky-400 text-sm">重新扫描</button>
        </div>
      )}

      {/* Folder tree */}
      {tree.length > 0 && (
        <div className="flex flex-col gap-1">
          <TreeLevel
            nodes={tree}
            planId={id}
            isLocked={isLockedOverall}
            isParentMode={isParentMode}
            episodeCounter={{ n: 0 }}
          />
        </div>
      )}
    </div>
  );
}
