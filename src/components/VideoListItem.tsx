import { useNavigate } from "react-router-dom";
import { FocusableCard } from "./FocusableCard";
import type { Video, VideoStatus } from "../types";

const STATUS_DOT: Record<VideoStatus, string> = {
  not_watched: "bg-gray-600",
  watching: "bg-yellow-400",
  watched: "bg-green-500",
};

const STATUS_LABEL: Record<VideoStatus, string> = {
  not_watched: "未看",
  watching: "看到一半",
  watched: "已看",
};

function formatTime(s: number | null): string {
  if (s === null) return "--:--";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

interface Props {
  video: Video;
  planId: number;
  isLocked: boolean;
  episodeNum?: number;
}

export function VideoListItem({ video, planId, isLocked, episodeNum }: Props) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (!isLocked) {
      navigate(`/plan/${planId}/video/${video.id}`);
    }
  };

  const progressPct =
    video.status === "watching" && video.duration_seconds && video.duration_seconds > 0
      ? Math.min(100, Math.round((video.progress_seconds / video.duration_seconds) * 100))
      : 0;

  return (
    <FocusableCard
      onClick={handleClick}
      className={`px-4 py-3 rounded-lg border transition-all ${
        isLocked
          ? "border-gray-800 bg-gray-900/50 opacity-50 cursor-not-allowed"
          : video.status === "watching"
          ? "border-yellow-700/50 bg-gray-800 hover:border-yellow-500"
          : "border-gray-700 bg-gray-800 hover:border-sky-600"
      }`}
    >
      <div className="flex items-center gap-3">
        {/* Status dot */}
        <div
          className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[video.status as VideoStatus]}`}
          title={STATUS_LABEL[video.status as VideoStatus]}
        />

        {/* Episode number */}
        {episodeNum !== undefined && (
          <span className="text-xs text-gray-500 shrink-0 w-6 text-right">
            {episodeNum}
          </span>
        )}

        {/* Title */}
        <div className="flex-1 min-w-0">
          <div
            className={`text-sm font-medium truncate ${
              video.status === "watched" ? "text-gray-400" : "text-gray-200"
            }`}
          >
            {video.title}
          </div>
        </div>

        {/* Duration / progress */}
        <div className="text-xs text-gray-500 shrink-0 text-right">
          {video.status === "watching" && video.progress_seconds > 0 ? (
            <span className="text-yellow-400">
              {formatTime(video.progress_seconds)}
              {video.duration_seconds ? ` / ${formatTime(video.duration_seconds)}` : ""}
            </span>
          ) : (
            formatTime(video.duration_seconds)
          )}
        </div>

        {isLocked && <span className="text-xs text-red-400 shrink-0">🔒</span>}
      </div>

      {/* Progress bar for watching videos */}
      {video.status === "watching" && progressPct > 0 && (
        <div className="mt-2 ml-5 w-[calc(100%-1.25rem)]">
          <div className="w-full h-0.5 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-yellow-400 rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}
    </FocusableCard>
  );
}
