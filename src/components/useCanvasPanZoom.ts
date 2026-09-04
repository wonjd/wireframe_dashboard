import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type CanvasView = { x: number; y: number; k: number };
export type CanvasContentSize = { width: number; height: number };

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;
/** Breathing room kept around the content when fitting it to the viewport. */
const FIT_MARGIN = 28;
const FALLBACK_VIEW: CanvasView = { x: 32, y: 24, k: 1 };

function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));
}

/**
 * Pan (drag background) + zoom (wheel / buttons) for a canvas viewport.
 *
 * Usage: attach `viewportRef` to the clipping element, spread `viewportProps`
 * on it, and apply `transform` on the inner content element. Elements marked
 * with `data-canvas-node` (or interactive elements) never start a pan, so
 * node clicks keep working.
 *
 * When `content` (the laid-out content bounding box, anchored at 0,0) is
 * given, the initial view is fitted so everything is visible: zoom is the
 * largest factor that fits both dimensions with a small margin, clamped to
 * [0.35, 2.5] and never above 1, and the content is centered (or pinned to
 * the top-left margin when it still overflows at minimum zoom). The fit is
 * recomputed when the content size or the container size changes — but only
 * until the user pans or zooms manually; after that their view is left alone.
 * `reset` re-fits and hands auto-fit back.
 */
export function useCanvasPanZoom(content?: CanvasContentSize | null) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<CanvasView>(FALLBACK_VIEW);
  const viewRef = useRef(view);
  viewRef.current = view;
  const contentRef = useRef<CanvasContentSize | null>(content ?? null);
  contentRef.current = content ?? null;
  const userMovedRef = useRef(false);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; ox: number; oy: number } | null>(
    null,
  );
  const [panning, setPanning] = useState(false);

  const fit = useCallback(() => {
    const el = viewportRef.current;
    const c = contentRef.current;
    if (!el || !c || c.width <= 0 || c.height <= 0) return;
    const vw = el.clientWidth;
    const vh = el.clientHeight;
    if (vw <= 0 || vh <= 0) return;
    const k = clampZoom(
      Math.min(1, (vw - FIT_MARGIN * 2) / c.width, (vh - FIT_MARGIN * 2) / c.height),
    );
    // Center when it fits; if the minimum zoom still overflows, show the
    // top-left of the diagram rather than its middle.
    setView({
      k,
      x: Math.max(FIT_MARGIN, (vw - c.width * k) / 2),
      y: Math.max(FIT_MARGIN, (vh - c.height * k) / 2),
    });
  }, []);

  // Re-fit when the laid-out content changes size (document edits, filters).
  useLayoutEffect(() => {
    if (!userMovedRef.current) fit();
  }, [content?.width, content?.height, fit]);

  // Re-fit when the container resizes (split-pane drag, fullscreen, window).
  // The observer fires once on observe, which doubles as the initial fit.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!userMovedRef.current) fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  // Native wheel listener: React's onWheel can be passive, which blocks preventDefault.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const cur = viewRef.current;
      const nk = clampZoom(cur.k * Math.exp(-e.deltaY * 0.0015));
      if (nk === cur.k) return;
      userMovedRef.current = true;
      const scale = nk / cur.k;
      setView({
        k: nk,
        x: px - (px - cur.x) * scale,
        y: py - (py - cur.y) * scale,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-canvas-node], button, a, select, input, textarea")) return;
    const cur = viewRef.current;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      ox: cur.x,
      oy: cur.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setPanning(true);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    userMovedRef.current = true;
    setView((v) => ({
      ...v,
      x: drag.ox + (e.clientX - drag.startX),
      y: drag.oy + (e.clientY - drag.startY),
    }));
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setPanning(false);
  }, []);

  const zoomBy = useCallback((factor: number) => {
    const el = viewportRef.current;
    const cur = viewRef.current;
    const nk = clampZoom(cur.k * factor);
    if (nk === cur.k) return;
    userMovedRef.current = true;
    const rect = el?.getBoundingClientRect();
    const px = rect ? rect.width / 2 : 0;
    const py = rect ? rect.height / 2 : 0;
    const scale = nk / cur.k;
    setView({ k: nk, x: px - (px - cur.x) * scale, y: py - (py - cur.y) * scale });
  }, []);

  const reset = useCallback(() => {
    userMovedRef.current = false;
    if (contentRef.current) fit();
    else setView(FALLBACK_VIEW);
  }, [fit]);

  return {
    viewportRef,
    view,
    panning,
    zoomBy,
    reset,
    viewportProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
    },
    transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
  };
}
