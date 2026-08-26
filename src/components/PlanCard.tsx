import { useNavigate } from "react-router-dom";
import { useAppContext } from "../context/AppContext";
import type { Plan, PlanPreviewVideo, PlanStatus, VideoStatus } from "../types";

const STATUS_LABEL: Record<PlanStatus, string> = {
  not_started: "未开始",
  in_progress: "学习中",
  completed: "已完成",
};

const STATUS_COLOR: Record<PlanStatus, string> = {
  not_started: "bg-gray-700 text-gray-300",
  in_progress: "bg-sky-700 text-sky-200",
  completed: "bg-green-800 text-green-200",
};

const PRIORITY_LABELS = ["无", "低", "中", "高"];
const PRIORITY_BADGE = [
  "",
  "bg-blue-900/50 text-blue-300",
  "bg-yellow-900/50 text-yellow-300",
  "bg-red-900/50 text-red-300",
];

function formatTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function canOpenPlanMedia(isParentMode: boolean, status: VideoStatus): boolean {
  return isParentMode || status === "watched";
}

interface Props {
  plan: Plan;
}

export function PlanCard({ plan }: Props) {
  const navigate = useNavigate();
  const { isParentMode, isCastActive, castSnapshot, switchCastVideo } = useAppContext();
  const total = plan.video_count + plan.audio_count;
  const pct = total > 0 ? Math.round((plan.watched_count / total) * 100) : 0;
  const recentVideos = plan.recent_videos ?? [];
  const extraCount = Math.max(0, total - recentVideos.length);

  const goDetail = () => navigate(`/plan/${plan.id}`);

  const openVideo = (item: PlanPreviewVideo) => {
    if (!canOpenPlanMedia(isParentMode, item.status)) return;
    if (item.media_type !== "audio" && isCastActive) {
      switchCastVideo({
        video_id: item.id,
        file_path: item.file_path,
        title: item.title,
        duration_seconds: item.duration_seconds,
      }).catch(() => {});
      return;
    }
    navigate(`/plan/${plan.id}/video/${item.id}`);
  };

  return (
    <div className="bg-gray-800 border border-gray-700 hover:border-sky-600 rounded-xl overflow-hidden transition-all">
      <button
        type="button"
        onClick={goDetail}
        className="w-full text-left px-5 pt-5 pb-3 hover:bg-gray-750/40 transition-colors"
      >
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 className="font-semibold text-gray-100 leading-tight line-clamp-2">
            {plan.name}
          </h3>
          <span
            className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[plan.status as PlanStatus]}`}
          >
            {STATUS_LABEL[plan.status as PlanStatus]}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-[10px] text-gray-500">
          {plan.video_count > 0 && <span>🎬 {plan.video_count}</span>}
          {plan.audio_count > 0 && <span>🎵 {plan.audio_count}</span>}
          {plan.is_background === 1 && <span className="text-purple-400">🎶</span>}
          {plan.is_protected === 1 && <span className="text-amber-400">🔒</span>}
          {plan.priority > 0 && (
            <span className={`px-1.5 py-0.5 rounded ${PRIORITY_BADGE[plan.priority]}`}>
              优先级·{PRIORITY_LABELS[plan.priority]}
            </span>
          )}
          {!!plan.daily_schedule_active && (
            <span className="bg-sky-800/60 text-sky-300 px-1.5 py-0.5 rounded">
              每日{plan.episodes_per_day}集
            </span>
          )}
          <span>{plan.watched_count}/{total} 已完成</span>
        </div>
        <div className="mt-3 w-full h-1 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${pct === 100 ? "bg-green-500" : "bg-sky-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </button>

      <div className="px-3 pb-3 flex flex-col gap-1.5">
        {recentVideos.length === 0 ? (
          <div className="px-3 py-2 text-xs text-gray-500">暂无媒体文件</div>
        ) : (
          recentVideos.map((item) => {
            const canOpen = canOpenPlanMedia(isParentMode, item.status);
            const isAudio = item.media_type === "audio";
            const isWatching = item.status === "watching";
            const isCastingThis = castSnapshot?.current?.video_id === item.id;
            const progressPct =
              isWatching && item.duration_seconds && item.duration_seconds > 0
                ? Math.min(100, Math.round((item.progress_seconds / item.duration_seconds) * 100))
                : 0;

            return (
              <div
                key={item.id}
                role="button"
                tabIndex={canOpen ? 0 : -1}
                onClick={() => openVideo(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openVideo(item);
                  }
                }}
                className={`rounded-lg px-3 py-2.5 border transition-all ${
                  canOpen
                    ? isWatching
                      ? "border-yellow-700/50 bg-gray-900/40 hover:border-yellow-500 cursor-pointer"
                      : "border-gray-700/60 bg-gray-900/40 hover:border-sky-600 cursor-pointer"
                    : "border-gray-800 bg-gray-900/20 opacity-50 cursor-not-allowed"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs shrink-0">{isAudio ? "🎵" : "🎬"}</span>
                  <span className="text-[10px] text-gray-600 shrink-0">{item.sort_order + 1}</span>
                  <span className="flex-1 min-w-0 text-sm text-gray-200 truncate">{item.title}</span>
                  {isCastingThis && (
                    <span className="text-[10px] bg-sky-500/90 text-white font-semibold px-1.5 py-0.5 rounded shrink-0">
                      📺
                    </span>
                  )}
                  {!canOpen && <span className="text-xs shrink-0">🔒</span>}
                  {item.status === "watched" && (
                    <span className="text-[10px] text-green-500 shrink-0">已学</span>
                  )}
                  {item.duration_seconds != null && (
                    <span className="text-[10px] text-gray-600 shrink-0">{formatTime(item.duration_seconds)}</span>
                  )}
                </div>
                {isWatching && progressPct > 0 && (
                  <div className="mt-1.5 ml-6">
                    <div className="w-full h-0.5 bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full bg-yellow-400" style={{ width: `${progressPct}%` }} />
                    </div>
                    <span className="text-[10px] text-yellow-400">
                      {isAudio ? "已听至" : "已看至"} {formatTime(item.progress_seconds)}
                      {item.duration_seconds ? ` / ${formatTime(item.duration_seconds)}` : ""}
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}

        {extraCount > 0 && (
          <button
            type="button"
            onClick={goDetail}
            className="mt-0.5 px-3 py-1.5 text-xs text-sky-400 hover:text-sky-300 text-left transition-colors"
          >
            还有 {extraCount} 个，查看全部 →
          </button>
        )}
      </div>
    </div>
  );
}
