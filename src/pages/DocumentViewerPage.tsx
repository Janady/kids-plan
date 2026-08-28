import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { pdfjsLib } from "../lib/pdfWorker";
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
// extra controls (zoom), the system-open button (desktop only — Android's
// open_path is broken in tauri-plugin-opener 2.5.4, see handleOpenWithSystem),
// and a close button that returns to the plan page.
function OverlayTopBar({
  title, onOpenWithSystem, showOpenButton, onClose, extra,
}: {
  title: string; onOpenWithSystem: () => void; showOpenButton: boolean;
  onClose: () => void; extra?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-900 border-b border-gray-800">
      <span className="text-sm text-gray-200 truncate flex-1">{title}</span>
      {extra}
      {showOpenButton && (
        <button
          onClick={onOpenWithSystem}
          className="text-xs px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors shrink-0"
        >
          ↗ 用系统程序打开
        </button>
      )}
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

// Pan + zoom for the image/PDF overlays: wheel to zoom (desktop), drag to pan
// once zoomed in, buttons for discrete zoom steps + reset, and on touch
// devices a single finger pans while two fingers pinch-zoom.
function useImagePanZoom() {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(null);

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
  const endDrag = () => { dragRef.current = null; pinchRef.current = null; };

  const touchDist = (touches: React.TouchList) =>
    Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      dragRef.current = null;
      pinchRef.current = { startDist: touchDist(e.touches), startScale: scale };
    } else if (e.touches.length === 1 && scale > 1) {
      const t = e.touches[0];
      dragRef.current = { startX: t.clientX, startY: t.clientY, origX: pos.x, origY: pos.y };
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const factor = touchDist(e.touches) / pinchRef.current.startDist;
      setScale(clampScale(pinchRef.current.startScale * factor));
    } else if (e.touches.length === 1 && dragRef.current) {
      const t = e.touches[0];
      const d = dragRef.current;
      setPos({ x: d.origX + (t.clientX - d.startX), y: d.origY + (t.clientY - d.startY) });
    }
  };

  return {
    scale, pos, zoomBy, reset, onWheel, onMouseDown, onMouseMove, endDrag,
    onTouchStart, onTouchMove, onTouchEnd: endDrag,
  };
}

// Loads a PDF document from a URL (works with the Tauri asset-protocol URL on
// desktop and the local video-server URL on Android — both are plain
// fetchable URLs, so pdf.js's default network loader handles them directly).
function usePdfDocument(src: string) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setNumPages(0);
    setError(null);
    const task = pdfjsLib.getDocument({ url: src });
    task.promise.then((d) => {
      if (cancelled) return;
      setDoc(d);
      setNumPages(d.numPages);
    }).catch((e) => {
      if (!cancelled) setError(String(e));
    });
    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [src]);

  return { doc, numPages, error };
}

// Renders one PDF page into its own canvas at a fixed resolution (not tied to
// the live pan/zoom scale — re-rendering every canvas on every zoom tick would
// need debouncing and render-task cancellation for little practical benefit;
// a moderately high fixed resolution stays sharp for typical reading zoom).
function PdfPageCanvas({
  doc, pageNum, renderScale,
}: { doc: PDFDocumentProxy; pageNum: number; renderScale: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | null = null;

    doc.getPage(pageNum).then((page) => {
      if (cancelled) return;
      const viewport = page.getViewport({ scale: renderScale });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      renderTask = page.render({ canvasContext: ctx, viewport });
    });

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNum, renderScale]);

  return <canvas ref={canvasRef} className="max-w-full block mb-2 bg-white shadow" />;
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
  const renderScaleRef = useRef(Math.min(3, (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1) * 2));

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
      // 确保路径带上 file:// 协议头
      let formattedPath = video.file_path;

      // 如果是 Windows 路径（如 D:\xxx 或 D:/xxx），转换为 file:///D:/xxx 格式
      if (/^[a-zA-Z]:/.test(formattedPath)) {
        formattedPath = `file:///${formattedPath.replace(/\\/g, '/')}`;
      } else if (formattedPath.startsWith('/')) {
        formattedPath = `file://${formattedPath}`;
      }
      await openUrl(formattedPath);
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
  const showOpenButton = !isAndroid;

  // PDFs get their own full-window overlay instead of being squeezed into the
  // normal page layout, rendered with pdf.js onto canvases (not an iframe —
  // Android's WebView has no built-in PDF viewer, so an iframe there would
  // just be blank; canvas rendering works identically on both platforms).
  if (isPdf) {
    return (
      <PdfViewer
        video={video}
        src={src}
        showOpenButton={showOpenButton}
        onOpenWithSystem={handleOpenWithSystem}
        openError={openError}
        onClose={goBack}
        panZoom={panZoom}
        renderScale={renderScaleRef.current}
      />
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
          showOpenButton={showOpenButton}
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

      {showOpenButton ? (
        <div className="mt-4 flex flex-col items-start gap-2">
          <button
            onClick={handleOpenWithSystem}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium transition-colors"
          >
            ↗ 用系统程序打开
          </button>
          {openError && <p className="text-xs text-red-400">{openError}</p>}
        </div>
      ) : (
        <p className="mt-4 text-xs text-gray-600 text-center">此文件类型暂不支持在移动端打开，请在电脑上查看</p>
      )}

      <button
        onClick={goBack}
        className="mt-4 text-sm text-gray-500 hover:text-gray-300 transition-colors"
      >
        ← 返回计划目录
      </button>
    </div>
  );
}

// Split out from the main component so the PDF-only hooks (usePdfDocument)
// are never called on the image/office-doc render paths.
function PdfViewer({
  video, src, showOpenButton, onOpenWithSystem, openError, onClose, panZoom, renderScale,
}: {
  video: Video;
  src: string;
  showOpenButton: boolean;
  onOpenWithSystem: () => void;
  openError: string | null;
  onClose: () => void;
  panZoom: ReturnType<typeof useImagePanZoom>;
  renderScale: number;
}) {
  const { doc, numPages, error } = usePdfDocument(src);

  return (
    <div className="fixed inset-0 z-[80] bg-black flex flex-col">
      <OverlayTopBar
        title={video.title}
        onOpenWithSystem={onOpenWithSystem}
        showOpenButton={showOpenButton}
        onClose={onClose}
        extra={
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => panZoom.zoomBy(1 / 1.25)} className="w-7 h-7 flex items-center justify-center text-sm bg-gray-800 hover:bg-gray-700 rounded text-gray-300 transition-colors">−</button>
            <button onClick={panZoom.reset} className="px-2 h-7 flex items-center justify-center text-xs bg-gray-800 hover:bg-gray-700 rounded text-gray-300 transition-colors">{Math.round(panZoom.scale * 100)}%</button>
            <button onClick={() => panZoom.zoomBy(1.25)} className="w-7 h-7 flex items-center justify-center text-sm bg-gray-800 hover:bg-gray-700 rounded text-gray-300 transition-colors">+</button>
          </div>
        }
      />
      {openError && <p className="text-xs text-red-400 px-4 py-1">{openError}</p>}
      {error && <p className="text-xs text-red-400 px-4 py-1">PDF 加载失败：{error}</p>}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col items-center py-3"
        onTouchStart={panZoom.onTouchStart}
        onTouchMove={panZoom.onTouchMove}
        onTouchEnd={panZoom.onTouchEnd}
      >
        <div
          style={{
            transform: `translate(${panZoom.pos.x}px, 0) scale(${panZoom.scale})`,
            transformOrigin: "top center",
            transition: panZoom.scale === 1 ? "transform 0.15s ease-out" : "none",
          }}
        >
          {doc && Array.from({ length: numPages }, (_, i) => (
            <PdfPageCanvas key={i} doc={doc} pageNum={i + 1} renderScale={renderScale} />
          ))}
        </div>
      </div>
    </div>
  );
}
