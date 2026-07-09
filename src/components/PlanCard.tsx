import { useNavigate } from "react-router-dom";
import type { Plan, PlanStatus } from "../types";

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

function formatTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

interface Props {
  plan: Plan;
}

export function PlanCard({ plan }: Props) {
  const navigate = useNavigate();
  const pct =
    plan.video_count > 0
      ? Math.round((plan.watched_count / plan.video_count) * 100)
      : 0;

  const episodeNum =
    plan.next_video_sort_order !== null ? plan.next_video_sort_order + 1 : null;

  const isWatching = plan.next_video_status === "watching";
  const isCompleted = plan.status === "completed";

  const nextLabel = isCompleted
    ? "已全部完成 · 最后一课"
    : isWatching
    ? "继续观看"
    : plan.status === "not_started"
    ? "即将开始"
    : "下一课";

  const playBtnLabel = isCompleted ? "重温" : isWatching ? "继续" : "开始";

  const progressPct =
    isWatching && plan.next_video_progress && plan.next_video_duration
      ? Math.min(100, Math.round((plan.next_video_progress / plan.next_video_duration) * 100))
      : 0;

  const handleCardClick = () => navigate(`/plan/${plan.id}`);

  const handlePlayClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (plan.next_video_id) {
      navigate(`/plan/${plan.id}/video/${plan.next_video_id}`);
    }
  };

  return (
    <div
      onClick={handleCardClick}
      className="bg-gray-800 border border-gray-700 hover:border-sky-600 rounded-xl overflow-hidden cursor-pointer transition-all group"
    >
      {/* Header */}
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h3 className="font-semibold text-gray-100 leading-tight line-clamp-2 group-hover:text-sky-300 transition-colors">
            {plan.name}
          </h3>
          <span
            className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[plan.status as PlanStatus]}`}
          >
            {STATUS_LABEL[plan.status as PlanStatus]}
          </span>
        </div>
        <div className="text-xs text-gray-500">
          {plan.watched_count}/{plan.video_count} 集已完成
        </div>

        {/* Overall progress bar */}
        <div className="mt-3 w-full h-1 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              pct === 100 ? "bg-green-500" : "bg-sky-500"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Next video preview */}
      {plan.next_video_id && plan.next_video_title && (
        <div
          className={`mx-3 mb-3 rounded-lg px-4 py-3 flex items-center gap-3 ${
            isCompleted
              ? "bg-green-900/30 border border-green-800/40"
              : isWatching
              ? "bg-yellow-900/30 border border-yellow-700/40"
              : "bg-gray-700/50 border border-gray-600/40"
          }`}
        >
          {/* Episode info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span
                className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                  isCompleted
                    ? "bg-green-800/60 text-green-300"
                    : isWatching
                    ? "bg-yellow-800/60 text-yellow-300"
                    : "bg-gray-600/60 text-gray-400"
                }`}
              >
                {nextLabel}
              </span>
              {episodeNum && (
                <span className="text-[10px] text-gray-500">
                  第 {episodeNum} 集
                </span>
              )}
            </div>

            <div className="text-sm text-gray-200 truncate leading-snug">
              {plan.next_video_title}
            </div>

            {/* Progress bar for watching */}
            {isWatching && progressPct > 0 && (
              <div className="mt-1.5">
                <div className="w-full h-1 bg-gray-600 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-yellow-400 rounded-full"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className="text-[10px] text-yellow-400 mt-0.5">
                  已看至 {formatTime(plan.next_video_progress!)}
                  {plan.next_video_duration ? ` / ${formatTime(plan.next_video_duration)}` : ""}
                </div>
              </div>
            )}
          </div>

          {/* Play button */}
          <button
            onClick={handlePlayClick}
            className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
              isCompleted
                ? "bg-green-700 hover:bg-green-600 text-white"
                : "bg-sky-600 hover:bg-sky-500 text-white"
            }`}
            title={playBtnLabel}
          >
            ▶
          </button>
        </div>
      )}
    </div>
  );
}
