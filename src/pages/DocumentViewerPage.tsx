import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { openDocumentWithSystem } from "../api/document";
import { listVideosForPlan } from "../api/videos";
import { listPlans } from "../api/plans";
import { usePlatform } from "../hooks/usePlatform";
import { getVideoUrl } from "../api/videoSrc";
import type { Video, Plan } from "../types";
import { useImagePanZoom } from "../hooks/useImagePanZoom";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "bmp"];

function fileExtension(filePath: string): string {
  return filePath.split(".").pop()?.toLowerCase() ?? "";
}

function OverlayTopBar({
  title, onClose, extra,
}: {
  title: string; onClose: () => void; extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-900 border-b border-gray-800">
      <span className="text-sm text-gray-200 truncate flex-1">{title}</span>
      {extra}
      <button
        onClick={onClose}
        className="text-xl text-gray-400 hover:text-gray-100 leading-none px-2 transition-colors shrink-0"
        aria-label="关闭"
      >
        ×
      </button>
    </div>
  );
}

export default function DocumentViewerPage() {
  const { planId, videoId } = useParams<{ planId: string; videoId: string }>();
  const navigate = useNavigate();
  const pId = Number(planId);
  const vId = Number(videoId);
  const { isAndroid } = usePlatform();

  const [video, setVideo] = useState<Video | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const panZoom = useImagePanZoom();

  useEffect(() => {
    setLoading(true);
    setOpenError(null);
    setImageFailed(false);
    Promise.all([listVideosForPlan(pId), listPlans()]).then(([videos, plans]) => {
      setVideo(videos.find((v) => v.id === vId) ?? null);
      setPlan(plans.find((p) => p.id === pId) ?? null);
      setLoading(false);
    });
  }, [pId, vId]);

  // Non-image documents (PDF, Office docs, etc.) are opened with the system app
  // immediately on mount, then we return to the plan page — this route is just
  // a trampoline that lets PlanPage navigate without re-implementing the
  // platform-specific open logic inline.
  useEffect(() => {
    if (!video || loading) return;
    const ext = fileExtension(video.file_path);
    if (!IMAGE_EXTENSIONS.includes(ext)) {
      handleOpenWithSystem();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video, loading]);

  const handleOpenWithSystem = async () => {
    if (!video) return;
    setOpenError(null);
    try {
      if (isAndroid) {
        await openDocumentWithSystem(video.file_path);
      } else {
        const { openUrl } = await import("@tauri-apps/plugin-opener");
        let formattedPath = video.file_path;
        if (/^[a-zA-Z]:/.test(formattedPath)) {
          formattedPath = `file:///${formattedPath.replace(/\\/g, "/")}`;
        } else if (formattedPath.startsWith("/")) {
          formattedPath = `file://${formattedPath}`;
        }
        await openUrl(formattedPath);
      }
      // Successfully opened, go back to plan page
      navigate(`/plan/${pId}`);
    } catch (e) {
      setOpenError(`打开失败：${e}`);
    }
  };

  const goBack = () => navigate(`/plan/${pId}`);

  if (loading) return <div className="text-center text-gray-500 py-16">加载中…</div>;

  if (!video) {
    return (
      <div className="text-center text-gray-500 py-16">
        <p>文件未找到</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-sky-400 text-sm">返回</button>
      </div>
    );
  }

  const ext = fileExtension(video.file_path);
  const isImage = IMAGE_EXTENSIONS.includes(ext);

  // If opening with system failed, show error page
  if (!isImage && openError) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-3 text-sm text-gray-500">
          <button onClick={() => navigate("/")} className="hover:text-gray-300 transition-colors">首页</button>
          <span>/</span>
          <button onClick={goBack} className="hover:text-gray-300 transition-colors truncate max-w-[160px]">
            {plan?.name ?? "计划"}
          </button>
        </div>

        <h1 className="text-lg font-semibold text-gray-100 mb-3 leading-tight">
          <span className="text-amber-400 mr-2">📄</span>
          {video.title}
        </h1>

        <div className="flex flex-col items-center justify-center py-16 px-6 bg-gray-900 rounded-xl">
          <div className="text-5xl mb-4">⚠️</div>
          <p className="text-red-400 text-sm text-center mb-1">{openError}</p>
          <p className="text-gray-600 text-xs text-center mt-2">{video.title}</p>
        </div>

        <div className="mt-4 flex flex-col items-start gap-2">
          <button
            onClick={handleOpenWithSystem}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium transition-colors"
          >
            ↗ 重试打开
          </button>
        </div>

        <button
          onClick={goBack}
          className="mt-4 text-sm text-gray-500 hover:text-gray-300 transition-colors"
        >
          ← 返回计划目录
        </button>
      </div>
    );
  }

  // Images get in-app pan/zoom preview (no system-open button)
  if (isImage && !imageFailed) {
    const src = getVideoUrl(video.file_path);
    return (
      <div className="fixed inset-0 z-[80] bg-black flex flex-col">
        <OverlayTopBar
          title={video.title}
          onClose={goBack}
          extra={
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => panZoom.zoomBy(1 / 1.25)} className="w-7 h-7 flex items-center justify-center text-sm bg-gray-800 hover:bg-gray-700 rounded text-gray-300 transition-colors">−</button>
              <button onClick={panZoom.reset} className="px-2 h-7 flex items-center justify-center text-xs bg-gray-800 hover:bg-gray-700 rounded text-gray-300 transition-colors">{Math.round(panZoom.scale * 100)}%</button>
              <button onClick={() => panZoom.zoomBy(1.25)} className="w-7 h-7 flex items-center justify-center text-sm bg-gray-800 hover:bg-gray-700 rounded text-gray-300 transition-colors">+</button>
            </div>
          }
        />
        <div
          className="flex-1 overflow-hidden flex items-center justify-center touch-none"
          style={{ cursor: panZoom.scale > 1 ? "grab" : "default" }}
          onWheel={panZoom.onWheel}
          onMouseDown={panZoom.onMouseDown}
          onMouseMove={panZoom.onMouseMove}
          onMouseUp={panZoom.endDrag}
          onMouseLeave={panZoom.endDrag}
          onTouchStart={panZoom.onTouchStart}
          onTouchMove={panZoom.onTouchMove}
          onTouchEnd={panZoom.onTouchEnd}
        >
          <img
            src={src}
            alt={video.title}
            className="max-w-full max-h-full object-contain select-none"
            style={{
              transform: `translate(${panZoom.pos.x}px, ${panZoom.pos.y}px) scale(${panZoom.scale})`,
              transition: panZoom.scale === 1 ? "transform 0.15s ease-out" : "none",
            }}
            draggable={false}
            onError={() => setImageFailed(true)}
          />
        </div>
      </div>
    );
  }

  // Image load failed, show fallback
  if (isImage && imageFailed) {
    return (
      <div className="text-center text-gray-500 py-16">
        <p>图片加载失败</p>
        <p className="text-sm text-gray-600 mt-2">{video.title}</p>
        <button onClick={goBack} className="mt-4 text-sky-400 text-sm">返回</button>
      </div>
    );
  }

  // Non-image documents should have already triggered system open on mount —
  // this fallback shouldn't normally be reached, but show loading just in case
  return <div className="text-center text-gray-500 py-16">打开中…</div>;
}
