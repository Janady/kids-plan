import { useNavigate } from "react-router-dom";
import { useAppContext } from "../context/AppContext";
import { TagChip } from "./Tags";
import type { Plan, PlanPreviewVideo, PlanStatus, VideoStatus } from "../types";

const STATUS_LABEL: Record<PlanStatus, string> = {
  not_started: "未开始",
  in_progress: "学习中",
  completed: "已完成",
};

const PRIORITY_LABELS = ["无", "低", "中", "高"];

function formatTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function todayEpisodeQuota(plan: Plan): number {
  const idx = (new Date().getDay() + 6) % 7;
  return plan.weekly_schedule[idx]?.episodes ?? plan.episodes_per_day;
}

export function canOpenPlanMedia(isParentMode: boolean, status: VideoStatus): boolean {
  return isParentMode || status === "watched";
}

export function PlanCard({ plan }: { plan: Plan }) {
  const navigate = useNavigate();
  const { isParentMode, isCastActive, castSnapshot, switchCastVideo } = useAppContext();
  const total = plan.video_count + plan.audio_count;
  const pct = total > 0 ? Math.round((plan.watched_count / total) * 100) : 0;
  const recentVideos = plan.recent_videos ?? [];
  const extraCount = Math.max(0, total - recentVideos.length);
  const mark = plan.audio_count > 0 && plan.video_count === 0 ? "音" : plan.document_count > 0 && total === 0 ? "文" : "视";
  const icoClass = mark === "音" ? "audio" : mark === "文" ? "doc" : "video";

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
    <div className="card overflow-hidden">
      <button type="button" onClick={goDetail} className="acc">
        <span className={`kind-ico ${icoClass}`}>{mark}</span>
        <span className="acc-main">
          <b>{plan.name}</b>
          <small>
            {STATUS_LABEL[plan.status as PlanStatus]}
            {plan.video_count > 0 ? ` · ${plan.video_count} 视频` : ""}
            {plan.audio_count > 0 ? ` · ${plan.audio_count} 音频` : ""}
            {plan.document_count > 0 ? ` · ${plan.document_count} 文档` : ""}
            {plan.priority > 0 ? ` · 优先级${PRIORITY_LABELS[plan.priority]}` : ""}
            {!!plan.daily_schedule_active ? ` · 今日${todayEpisodeQuota(plan)}集` : ""}
          </small>
        </span>
        <span className={`chip ${plan.status === "completed" ? "leaf" : plan.status === "in_progress" ? "video" : "muted"}`}>
          {plan.watched_count}/{total}
        </span>
      </button>

      <div className="px-4 pb-3">
        {(plan.tags ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {plan.tags.map((tag) => (
              <TagChip key={tag.id} tag={tag} />
            ))}
          </div>
        )}
        <div className={`progress ${pct === 100 ? "leaf" : "sky"}`}>
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="px-3 pb-3 flex flex-col gap-1">
        {recentVideos.length === 0 ? (
          <div className="px-3 py-2 text-xs text-mute">暂无媒体文件</div>
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
                className={`rounded-xl px-3 py-2.5 ${canOpen ? "bg-chip" : "opacity-50"}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`chip ${isAudio ? "audio" : "video"}`}>{isAudio ? "音频" : "视频"}</span>
                  <span className="flex-1 min-w-0 text-sm text-ink truncate">{item.title}</span>
                  {isCastingThis && <span className="chip video">投屏</span>}
                  {!canOpen && <span>🔒</span>}
                  {item.status === "watched" && <span className="chip leaf">已学</span>}
                  {item.duration_seconds != null && (
                    <span className="text-[11px] text-mute shrink-0">{formatTime(item.duration_seconds)}</span>
                  )}
                </div>
                {isWatching && progressPct > 0 && (
                  <div className="mt-1.5">
                    <div className="progress sun">
                      <span style={{ width: `${progressPct}%` }} />
                    </div>
                    <span className="text-[11px] text-sun">
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
          <button type="button" onClick={goDetail} className="ghost-btn text-left">
            还有 {extraCount} 个，查看全部
          </button>
        )}
      </div>
    </div>
  );
}
