import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { listCompletedForCleanup, cleanupVideos } from "../api/videos";
import { useAppContext } from "../context/AppContext";
import { usePlatform } from "../hooks/usePlatform";
import type { CleanupPlan } from "../types";

function formatBytes(n: number): string {
  if (n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / Math.pow(1024, i);
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export default function CleanupPage() {
  const navigate = useNavigate();
  const { isParentMode } = useAppContext();
  const { isAndroid } = usePlatform();
  const [plans, setPlans] = useState<CleanupPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [cleaning, setCleaning] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listCompletedForCleanup();
      setPlans(data);
      // Expand all by default so files are visible
      setExpanded(new Set(data.map((p) => p.plan_id)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!isParentMode) {
    return (
      <div className="card empty">
        <p className="text-4xl mb-4">🔒</p>
        <p className="font-semibold text-ink mb-1">清理页面仅家长可见</p>
        <p className="hint">请到「我的」切换到家长模式</p>
        <button className="primary" onClick={() => navigate("/me")}>去我的</button>
      </div>
    );
  }

  const toggleExpand = (planId: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(planId) ? next.delete(planId) : next.add(planId);
      return next;
    });

  const toggleOne = (videoId: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(videoId) ? next.delete(videoId) : next.add(videoId);
      return next;
    });

  const planFullySelected = (p: CleanupPlan) =>
    p.videos.length > 0 && p.videos.every((v) => selected.has(v.id));

  const togglePlan = (p: CleanupPlan) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const all = planFullySelected(p);
      for (const v of p.videos) {
        if (all) next.delete(v.id);
        else next.add(v.id);
      }
      return next;
    });

  // Selected count and size
  const allVideos = plans.flatMap((p) => p.videos);
  const selectedVideos = allVideos.filter((v) => selected.has(v.id));
  const selectedSize = selectedVideos.reduce((s, v) => s + v.file_size, 0);
  const totalSize = plans.reduce((s, p) => s + p.total_size, 0);

  const handleClean = async () => {
    if (selectedVideos.length === 0) return;
    const ok = confirm(
      `将永久删除 ${selectedVideos.length} 个视频文件，释放约 ${formatBytes(selectedSize)}。\n` +
      `文件删除后不可恢复（学习记录会保留）。确认清理？`
    );
    if (!ok) return;

    setCleaning(true);
    try {
      const res = await cleanupVideos([...selected]);
      let msg = `已删除 ${res.deleted} 个文件，释放 ${formatBytes(res.freed_bytes)}`;
      if (res.not_found > 0) msg += `；${res.not_found} 个按记录路径未找到文件`;
      if (res.failed.length > 0) {
        const detail = res.failed.slice(0, 3).join("；");
        msg += `；${res.failed.length} 个删除失败：${detail}${res.failed.length > 3 ? " 等" : ""}`;
      }
      // On Android, failures/not-found almost always mean the "all files access"
      // permission is missing (READ_MEDIA_* can't delete other apps' files).
      if (isAndroid && (res.failed.length > 0 || res.not_found > 0)) {
        msg += "。若删除失败，请在 系统设置 › 应用 › 本应用 › 权限 › 「所有文件访问权限」中开启后重试。";
      }
      setResultMsg(msg);
      setSelected(new Set());
      await load();
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div>
      <header className="month-head">
        <div>
          <button className="kicker" onClick={() => navigate("/me")}>← 我的</button>
          <h1>清理已学文件</h1>
        </div>
      </header>

      <p className="hint" style={{ paddingTop: 0 }}>
        删除已看完视频的本地文件以释放磁盘空间。学习记录会保留；已清理的视频将无法再播放。
      </p>

      {resultMsg && (
        <div className="card mb-4" style={{ padding: 12 }}>
          <div className="flex items-start gap-2 text-sm text-leaf">
            <span className="shrink-0">✓</span>
            <span className="flex-1 text-ink">{resultMsg}</span>
            <button onClick={() => setResultMsg(null)} className="text-mute">✕</button>
          </div>
        </div>
      )}

      {loading && <div className="empty">加载中…</div>}

      {!loading && plans.length === 0 && (
        <div className="card empty">
          <p className="text-3xl mb-3">🧹</p>
          <p className="font-semibold text-ink mb-1">暂无可清理的已完成视频</p>
          <p className="hint">看完的视频会出现在这里，供你释放空间</p>
        </div>
      )}

      {!loading && plans.length > 0 && (
        <>
          <div className="text-xs text-mute mb-3">
            共 {allVideos.length} 个可清理视频 · 合计 {formatBytes(totalSize)}
          </div>

          <div className="space-y-3">
            {plans.map((p) => {
              const isExpanded = expanded.has(p.plan_id);
              const fullySelected = planFullySelected(p);
              const someSelected = p.videos.some((v) => selected.has(v.id));
              return (
                <div key={p.plan_id} className="card overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={fullySelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected && !fullySelected; }}
                      onChange={() => togglePlan(p)}
                      className="w-4 h-4 shrink-0"
                    />
                    <button
                      onClick={() => toggleExpand(p.plan_id)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-left"
                    >
                      <span className="text-xs text-mute">{isExpanded ? "▼" : "▶"}</span>
                      <span className="text-sm font-medium text-ink truncate">{p.plan_name}</span>
                    </button>
                    <span className="text-xs text-mute shrink-0">
                      {p.videos.length} 个 · {formatBytes(p.total_size)}
                    </span>
                  </div>

                  {isExpanded && (
                    <div>
                      {p.videos.map((v) => (
                        <label
                          key={v.id}
                          className="flex items-center gap-3 px-4 py-2.5 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selected.has(v.id)}
                            onChange={() => toggleOne(v.id)}
                            className="w-4 h-4 shrink-0"
                          />
                          <span className="flex-1 text-sm text-ink truncate">{v.title}</span>
                          <span className="text-xs text-mute shrink-0">{formatBytes(v.file_size)}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Fixed action bar — sits above the background-audio mini player when present */}
      {selectedVideos.length > 0 && (
        <div className="dock-action">
          <span className="text-sm text-ink flex-1">
            已选 {selectedVideos.length} 个 · 约 {formatBytes(selectedSize)}
          </span>
          <button onClick={() => setSelected(new Set())} className="text-btn">
            取消
          </button>
          <button onClick={handleClean} disabled={cleaning} className="danger-btn" style={{ width: "auto", marginTop: 0, padding: "8px 16px" }}>
            {cleaning ? "清理中…" : "清理选中"}
          </button>
        </div>
      )}
    </div>
  );
}
