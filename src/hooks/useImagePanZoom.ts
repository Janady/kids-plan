import { useRef, useState } from "react";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 5;

// Pan + zoom for the image overlay: wheel to zoom (desktop), drag to pan once
// zoomed in, buttons for discrete zoom steps + reset, and on touch devices a
// single finger pans while two fingers pinch-zoom.
export function useImagePanZoom() {
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
