import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { getVideoUrl } from "../api/videoSrc";
import { listVideosForPlan } from "../api/videos";
import { listPlans } from "../api/plans";
import { usePlatform } from "../hooks/usePlatform";
import type { Video, Plan } from "../types";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "bmp"];
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;

function fileExtension(filePath: string): string {
  return filePath.split(".").pop()?.toLowerCase() ?? "";
}

// Shared top bar for the full-window image/PDF overlays: title, optional
// extra controls (zoom), the system-open button, and a close button that
// returns to the plan page.
function OverlayTopBar({
  title, onOpenWithSystem, onClose, extra,
}: { title: string; onOpenWithSystem: () => void; onClose: () => void; extra?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-900 border-b border-gray-800">
      <span className="text-sm text-gray-200 truncate flex-1">{title}</span>
      {extra}
      <button
        onClick={onOpenWithSystem}
        className="text-xs px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors shrink-0"
      >
        ↗ 用系统程序打开
      </button>
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

// Pan + zoom for the image overlay: wheel to zoom (centered on the cursor),
// drag to pan once zoomed in, buttons for discrete zoom steps + reset.
function useImagePanZoom() {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  const clampScale = (s: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, s));
  const zoomBy = (factor: number) => setScale((s) => clampScale(s * factor));
  const reset = () => { setScale(1); setPos({ x: 0, y: 0 }); };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const d = dragRef.current;
    setPos({ x: d.origX + (e.clientX - d.startX), y: d.origY + (e.clientY - d.startY) });
  };
  const endDrag = () => { dragRef.current = null; };

  return { scale, pos, zoomBy, reset, onWheel, onMouseDown, onMouseMove, endDrag };
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

  const handleOpenWithSystem = async () => {
    if (!video) return;
    setOpenError(null);
    try {
      await openPath(video.file_path);
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
  const isPdf = ext === "pdf";
  const src = getVideoUrl(video.file_path);
  const canPreviewPdf = isPdf && !isAndroid;

  // PDFs get their own full-window overlay instead of being squeezed into the
  // normal page layout — a PDF page is tall and narrow, so embedding it next to
  // the breadcrumb/title/buttons leaves very little room to actually read it.
  if (canPreviewPdf) {
    return (
      <div className="fixed inset-0 z-[80] bg-black flex flex-col">
        <OverlayTopBar title={video.title} onOpenWithSystem={handleOpenWithSystem} onClose={goBack} />
        {openError && <p className="text-xs text-red-400 px-4 py-1">{openError}</p>}
        <iframe src={src} title={video.title} className="flex-1 w-full border-0" />
      </div>
    );
  }

  // Images get the same full-window treatment, plus pan/zoom since a photo of
  // a whiteboard or a dense diagram needs to be readable at more than "fit to
  // a column next to the breadcrumb" size.
  if (isImage && !imageFailed) {
    return (
      <div className="fixed inset-0 z-[80] bg-black flex flex-col">
        <OverlayTopBar
          title={video.title}
          onOpenWithSystem={handleOpenWithSystem}
          onClose={goBack}
          extra={
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => panZoom.zoomBy(1 / 1.25)} className="w-7 h-7 flex items-center justify-center text-sm bg-gray-800 hover:bg-gray-700 rounded text-gray-300 transition-colors">−</button>
              <button onClick={panZoom.reset} className="px-2 h-7 flex items-center justify-center text-xs bg-gray-800 hover:bg-gray-700 rounded text-gray-300 transition-colors">{Math.round(panZoom.scale * 100)}%</button>
              <button onClick={() => panZoom.zoomBy(1.25)} className="w-7 h-7 flex items-center justify-center text-sm bg-gray-800 hover:bg-gray-700 rounded text-gray-300 transition-colors">+</button>
            </div>
          }
        />
        {openError && <p className="text-xs text-red-400 px-4 py-1">{openError}</p>}
        <div
          className="flex-1 overflow-hidden flex items-center justify-center"
          style={{ cursor: panZoom.scale > 1 ? "grab" : "default" }}
          onWheel={panZoom.onWheel}
          onMouseDown={panZoom.onMouseDown}
          onMouseMove={panZoom.onMouseMove}
          onMouseUp={panZoom.endDrag}
          onMouseLeave={panZoom.endDrag}
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

  return (
    <div>
      {/* Breadcrumb */}
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
        <div className="text-5xl mb-4">📄</div>
        <p className="text-gray-400 text-sm text-center mb-1">此文件类型无法在应用内预览</p>
        <p className="text-gray-600 text-xs text-center">{video.title}</p>
      </div>

      <div className="mt-4 flex flex-col items-start gap-2">
        <button
          onClick={handleOpenWithSystem}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium transition-colors"
        >
          ↗ 用系统程序打开
        </button>
        {openError && <p className="text-xs text-red-400">{openError}</p>}
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
