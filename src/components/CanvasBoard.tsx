import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { ExternalLink, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { getHardwarePointerMode } from "../pointerInput";
import { getInitialScrollPosition, getNavigationBounds, getScrollSurfaceSize, textBlockHeight, WORLD_ORIGIN } from "../canvasNavigation";
import { isEditingText } from "../keyboardShortcuts";
import type { SheetBackground } from "./SettingsPanel";
import type { NotePage, PenPreset, Point, Stroke, TableBlock, TextBlock, ToolId } from "../types";

type CanvasBoardProps = {
  page: NotePage;
  tool: ToolId;
  preset: PenPreset;
  theme: "light" | "dark";
  sheetBackground: SheetBackground;
  onChange: (page: NotePage) => void;
  onToolChange: (tool: ToolId) => void;
  onHardwareEraserChange: (active: boolean) => void;
};

type WacomPointerEvent = ReactPointerEvent<HTMLDivElement> & { eraser?: boolean };

type ScrollPosition = { left: number; top: number };

function strokeColor(stroke: Stroke, theme: "light" | "dark") {
  const isLegacyContrast = stroke.color.toLowerCase() === "#1c2228";
  return stroke.colorRole === "contrast" || isLegacyContrast ? (theme === "dark" ? "#f4f6f8" : "#1c2228") : stroke.color;
}

function strokePath(points: Point[]) {
  if (points.length < 2) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    path += ` Q ${current.x} ${current.y} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

function distanceToStroke(point: Point, stroke: Stroke) {
  if (stroke.points.length === 0) return Number.POSITIVE_INFINITY;
  if (stroke.points.length === 1) return Math.hypot(point.x - stroke.points[0].x, point.y - stroke.points[0].y);

  let best = Number.POSITIVE_INFINITY;
  for (let index = 1; index < stroke.points.length; index += 1) {
    const start = stroke.points[index - 1];
    const end = stroke.points[index];
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const projection = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared));
    const closestX = start.x + projection * deltaX;
    const closestY = start.y + projection * deltaY;
    best = Math.min(best, Math.hypot(point.x - closestX, point.y - closestY));
  }
  return best;
}

export function CanvasBoard({ page, tool, preset, theme, sheetBackground, onChange, onToolChange, onHardwareEraserChange }: CanvasBoardProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef(page);
  const [zoom, setZoom] = useState(1);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [draftStroke, setDraftStroke] = useState<Stroke | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const gestureRef = useRef<{ startX: number; startY: number; scrollLeft: number; scrollTop: number } | null>(null);
  const panTargetRef = useRef<ScrollPosition | null>(null);
  const panFrameRef = useRef<number | null>(null);
  const pointerModeRef = useRef<{ mode: "draw" | "erase" | "pan" | "idle"; restoreTool?: ToolId }>({ mode: "idle" });
  const nativeWacomEraserRef = useRef(false);
  const hardwareEraserRef = useRef(false);
  const previousLayoutRef = useRef<{ pageId: string; minX: number; minY: number; zoom: number } | null>(null);
  const zoomAnchorRef = useRef<{ localX: number; localY: number; worldX: number; worldY: number } | null>(null);

  pageRef.current = page;
  const navigationBounds = useMemo(() => getNavigationBounds(page, viewportSize.width, viewportSize.height, zoom), [page, viewportSize.height, viewportSize.width, zoom]);
  const surfaceSize = useMemo(() => getScrollSurfaceSize(navigationBounds, zoom), [navigationBounds, zoom]);

  const stopPanAnimation = useCallback(() => {
    if (panFrameRef.current !== null) {
      cancelAnimationFrame(panFrameRef.current);
      panFrameRef.current = null;
    }
  }, []);

  const animatePan = useCallback(() => {
    panFrameRef.current = null;
    const viewport = viewportRef.current;
    const target = panTargetRef.current;
    if (!viewport || !target) return;

    const deltaX = target.left - viewport.scrollLeft;
    const deltaY = target.top - viewport.scrollTop;
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
      viewport.scrollLeft = target.left;
      viewport.scrollTop = target.top;
      panTargetRef.current = null;
      return;
    }

    // Ease toward the latest pointer position instead of stepping once per
    // tablet event. This keeps pan motion fluid when Wacom events arrive in
    // uneven bursts while still tracking the pen closely.
    viewport.scrollLeft += deltaX * 0.24;
    viewport.scrollTop += deltaY * 0.24;
    panFrameRef.current = requestAnimationFrame(animatePan);
  }, []);

  const setPanTarget = useCallback((target: ScrollPosition) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const maxLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    const maxTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    panTargetRef.current = {
      left: Math.max(0, Math.min(maxLeft, target.left)),
      top: Math.max(0, Math.min(maxTop, target.top)),
    };
    if (panFrameRef.current === null) panFrameRef.current = requestAnimationFrame(animatePan);
  }, [animatePan]);

  useEffect(() => () => stopPanAnimation(), [stopPanAnimation]);

  useEffect(() => {
    setZoom(1);
    setSelectedTextId(null);
    setDraftStroke(null);
  }, [page.id]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const syncSize = () => {
      const rect = viewport.getBoundingClientRect();
      setViewportSize({ width: rect.width, height: rect.height });
    };
    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewportSize.width || !viewportSize.height) return;
    if (!viewport) return;
    stopPanAnimation();
    panTargetRef.current = null;
    const previous = previousLayoutRef.current;
    const zoomAnchor = zoomAnchorRef.current;
    if (!previous || previous.pageId !== page.id) {
      const initial = getInitialScrollPosition(navigationBounds, zoom);
      viewport.scrollLeft = initial.left;
      viewport.scrollTop = initial.top;
    } else if (zoomAnchor) {
      viewport.scrollLeft = (zoomAnchor.worldX - navigationBounds.minX) * zoom - zoomAnchor.localX;
      viewport.scrollTop = (zoomAnchor.worldY - navigationBounds.minY) * zoom - zoomAnchor.localY;
      zoomAnchorRef.current = null;
    } else {
      viewport.scrollLeft += (previous.minX - navigationBounds.minX) * zoom;
      viewport.scrollTop += (previous.minY - navigationBounds.minY) * zoom;
    }
    previousLayoutRef.current = { pageId: page.id, minX: navigationBounds.minX, minY: navigationBounds.minY, zoom };
  }, [navigationBounds, page.id, stopPanAnimation, viewportSize.height, viewportSize.width, zoom]);

  const setHardwareEraserActive = useCallback((active: boolean) => {
    if (hardwareEraserRef.current === active) return;
    hardwareEraserRef.current = active;
    onHardwareEraserChange(active);
  }, [onHardwareEraserChange]);

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const viewport = viewportRef.current;
    const bounds = viewport?.getBoundingClientRect();
    const localX = navigationBounds.minX + (clientX - (bounds?.left ?? 0) + (viewport?.scrollLeft ?? 0)) / zoom;
    const localY = navigationBounds.minY + (clientY - (bounds?.top ?? 0) + (viewport?.scrollTop ?? 0)) / zoom;
    return {
      x: localX - WORLD_ORIGIN,
      y: localY - WORLD_ORIGIN,
    };
  }, [navigationBounds.minX, navigationBounds.minY, zoom]);

  const eraseAt = useCallback((point: Point) => {
    const currentPage = pageRef.current;
    const nextStrokes = currentPage.strokes.filter((stroke) => distanceToStroke(point, stroke) > 14 + stroke.width / 2);
    if (nextStrokes.length === currentPage.strokes.length) return;
    const nextPage = { ...currentPage, strokes: nextStrokes, updatedAt: new Date().toISOString() };
    pageRef.current = nextPage;
    onChange(nextPage);
  }, [onChange]);

  const restoreTemporaryTool = useCallback(() => {
    const restoreTool = pointerModeRef.current.restoreTool;
    gestureRef.current = null;
    pointerModeRef.current = { mode: "idle" };
    setDraftStroke(null);
    if (restoreTool) onToolChange(restoreTool);
  }, [onToolChange]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<boolean>("wacom-eraser-state", (event) => {
      nativeWacomEraserRef.current = event.payload;
      setHardwareEraserActive(event.payload);
      if (!event.payload) restoreTemporaryTool();
    }).then((remove) => {
      if (cancelled) remove();
      else unlisten = remove;
    }).catch(() => {
      // The Vite browser preview has no Tauri event bridge; native builds do.
    });
    return () => {
      cancelled = true;
      unlisten?.();
      nativeWacomEraserRef.current = false;
      setHardwareEraserActive(false);
    };
  }, [restoreTemporaryTool, setHardwareEraserActive]);

  const createTextBlock = useCallback((point: Point) => {
    const currentPage = pageRef.current;
    const block: TextBlock = { id: crypto.randomUUID(), x: point.x + WORLD_ORIGIN, y: point.y + WORLD_ORIGIN, width: 320, text: "" };
    const nextPage = { ...currentPage, textBlocks: [...currentPage.textBlocks, block], updatedAt: new Date().toISOString() };
    pageRef.current = nextPage;
    onChange(nextPage);
    setSelectedTextId(block.id);
  }, [onChange]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest(".text-block-shell")) return;
    event.preventDefault();
    const point = toWorld(event.clientX, event.clientY);

    const hardwareMode = getHardwarePointerMode({ pointerType: event.pointerType, button: event.button, buttons: event.buttons, eraser: (event as WacomPointerEvent).eraser });
    const isWacomEraser = nativeWacomEraserRef.current || hardwareMode === "eraser";
    setHardwareEraserActive(isWacomEraser);
    const isHardwarePanButton = !isWacomEraser && hardwareMode === "pan";

    if (tool === "pan" || event.shiftKey || isHardwarePanButton) {
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerModeRef.current = { mode: "pan", restoreTool: isHardwarePanButton && tool !== "pan" ? tool : undefined };
      if (isHardwarePanButton && tool !== "pan") onToolChange("pan");
      gestureRef.current = { startX: event.clientX, startY: event.clientY, scrollLeft: event.currentTarget.scrollLeft, scrollTop: event.currentTarget.scrollTop };
      setPanTarget({ left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop });
      return;
    }
    if (isWacomEraser || tool === "eraser") {
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerModeRef.current = { mode: "erase" };
      eraseAt(point);
      return;
    }
    if (tool === "text") {
      createTextBlock(point);
      return;
    }
    if (tool === "pen" || tool === "highlighter") {
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerModeRef.current = { mode: "draw" };
      setDraftStroke({
        id: crypto.randomUUID(),
        color: preset.color,
        colorRole: preset.id === "contrast" && preset.color === (theme === "dark" ? "#f4f6f8" : "#1c2228") ? "contrast" : undefined,
        width: preset.width,
        opacity: preset.opacity,
        points: [{ ...point, pressure: event.pressure || 0.5 }],
      });
      setSelectedTextId(null);
      return;
    }
    setSelectedTextId(null);
  };

  const handleDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (tool !== "select" || (event.target as HTMLElement).closest(".text-block-shell")) return;
    event.preventDefault();
    createTextBlock(toWorld(event.clientX, event.clientY));
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const hardwareMode = getHardwarePointerMode({ pointerType: event.pointerType, button: event.button, buttons: event.buttons, eraser: (event as WacomPointerEvent).eraser });
    const isWacomEraser = nativeWacomEraserRef.current || hardwareMode === "eraser";
    setHardwareEraserActive(isWacomEraser);
    const isHardwarePanButton = !isWacomEraser && hardwareMode === "pan";

    if (isWacomEraser && pointerModeRef.current.mode !== "erase") {
      pointerModeRef.current = { mode: "erase" };
      setDraftStroke(null);
    }
    if (!isWacomEraser && pointerModeRef.current.mode === "erase") {
      restoreTemporaryTool();
    }
    if (isHardwarePanButton && pointerModeRef.current.mode !== "pan") {
      pointerModeRef.current = { mode: "pan", restoreTool: tool !== "pan" ? tool : undefined };
      if (tool !== "pan") onToolChange("pan");
      const viewport = viewportRef.current;
      gestureRef.current = { startX: event.clientX, startY: event.clientY, scrollLeft: viewport?.scrollLeft ?? 0, scrollTop: viewport?.scrollTop ?? 0 };
      setPanTarget({ left: viewport?.scrollLeft ?? 0, top: viewport?.scrollTop ?? 0 });
    }

    if (pointerModeRef.current.mode === "pan" && gestureRef.current) {
      const gesture = gestureRef.current;
      const viewport = viewportRef.current;
      setPanTarget({
        left: gesture.scrollLeft - (event.clientX - gesture.startX),
        top: gesture.scrollTop - (event.clientY - gesture.startY),
      });
      return;
    }
    if (pointerModeRef.current.mode === "erase" || (tool === "eraser" && event.buttons !== 0)) {
      eraseAt(toWorld(event.clientX, event.clientY));
      return;
    }
    if (!draftStroke) return;
    const point = toWorld(event.clientX, event.clientY);
    setDraftStroke((stroke) => stroke ? { ...stroke, points: [...stroke.points, { ...point, pressure: event.pressure || 0.5 }] } : null);
  };

  const finishPointer = () => {
    gestureRef.current = null;
    if (draftStroke) {
      const currentPage = pageRef.current;
      if (draftStroke.points.length > 1) {
        const nextPage = { ...currentPage, strokes: [...currentPage.strokes, draftStroke], updatedAt: new Date().toISOString() };
        pageRef.current = nextPage;
        onChange(nextPage);
      }
      setDraftStroke(null);
    }
    const restoreTool = pointerModeRef.current.restoreTool;
    pointerModeRef.current = { mode: "idle" };
    if (restoreTool) onToolChange(restoreTool);
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const viewport = viewportRef.current;
    const bounds = viewport?.getBoundingClientRect();
    if (!viewport || !bounds) return;
    const nextZoom = Math.min(2, Math.max(0.45, zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
    if (nextZoom === zoom) return;
    const localX = event.clientX - bounds.left;
    const localY = event.clientY - bounds.top;
    zoomAnchorRef.current = {
      localX,
      localY,
      worldX: navigationBounds.minX + (viewport.scrollLeft + localX) / zoom,
      worldY: navigationBounds.minY + (viewport.scrollTop + localY) / zoom,
    };
    setZoom(nextZoom);
  };

  const updateText = (id: string, text: string) => {
    const currentPage = pageRef.current;
    const nextPage = {
      ...currentPage,
      textBlocks: currentPage.textBlocks.map((block) => block.id === id ? { ...block, text } : block),
      updatedAt: new Date().toISOString(),
    };
    pageRef.current = nextPage;
    onChange(nextPage);
  };

  const updateTable = (id: string, rows: string[][]) => {
    const currentPage = pageRef.current;
    const nextPage = { ...currentPage, tableBlocks: (currentPage.tableBlocks ?? []).map((block) => block.id === id ? { ...block, rows } : block), updatedAt: new Date().toISOString() };
    pageRef.current = nextPage;
    onChange(nextPage);
  };

  const removeBlock = useCallback((kind: "image" | "table" | "link", id: string) => {
    const currentPage = pageRef.current;
    const nextPage = {
      ...currentPage,
      imageBlocks: kind === "image" ? (currentPage.imageBlocks ?? []).filter((block) => block.id !== id) : currentPage.imageBlocks,
      tableBlocks: kind === "table" ? (currentPage.tableBlocks ?? []).filter((block) => block.id !== id) : currentPage.tableBlocks,
      linkBlocks: kind === "link" ? (currentPage.linkBlocks ?? []).filter((block) => block.id !== id) : currentPage.linkBlocks,
      updatedAt: new Date().toISOString(),
    };
    pageRef.current = nextPage;
    onChange(nextPage);
  }, [onChange]);

  const insertPastedImage = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (file.size > 12 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      const viewport = viewportRef.current;
      const center = viewport ? toWorld(viewport.getBoundingClientRect().left + viewport.clientWidth / 2, viewport.getBoundingClientRect().top + viewport.clientHeight / 2) : { x: 0, y: 0 };
      const currentPage = pageRef.current;
      const nextPage = { ...currentPage, imageBlocks: [...(currentPage.imageBlocks ?? []), { id: crypto.randomUUID(), x: center.x + WORLD_ORIGIN - 180, y: center.y + WORLD_ORIGIN - 120, width: 360, height: 240, src: reader.result, alt: file.name || "Pasted image" }], updatedAt: new Date().toISOString() };
      pageRef.current = nextPage;
      onChange(nextPage);
    };
    reader.readAsDataURL(file);
  }, [onChange, toWorld]);

  const handlePaste = useCallback((event: ReactClipboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("textarea, input, [contenteditable='true']")) return;
    const image = Array.from(event.clipboardData.files).find((file) => file.type.startsWith("image/"));
    if (image) { event.preventDefault(); insertPastedImage(image); return; }
    const value = event.clipboardData.getData("text/plain").trim();
    if (!/^https?:\/\/\S+$/i.test(value)) return;
    event.preventDefault();
    const viewport = viewportRef.current;
    const center = viewport ? toWorld(viewport.getBoundingClientRect().left + viewport.clientWidth / 2, viewport.getBoundingClientRect().top + viewport.clientHeight / 2) : { x: 0, y: 0 };
    const currentPage = pageRef.current;
    let label = value;
    try { label = new URL(value).hostname.replace(/^www\./, ""); } catch { /* validated above */ }
    const nextPage = { ...currentPage, linkBlocks: [...(currentPage.linkBlocks ?? []), { id: crypto.randomUUID(), x: center.x + WORLD_ORIGIN - 150, y: center.y + WORLD_ORIGIN - 28, width: 300, url: value, label }], updatedAt: new Date().toISOString() };
    pageRef.current = nextPage;
    onChange(nextPage);
  }, [insertPastedImage, onChange, toWorld]);

  const deleteTextBlock = useCallback((id: string) => {
    const currentPage = pageRef.current;
    if (!currentPage.textBlocks.some((block) => block.id === id)) return;
    const nextPage = { ...currentPage, textBlocks: currentPage.textBlocks.filter((block) => block.id !== id), updatedAt: new Date().toISOString() };
    pageRef.current = nextPage;
    onChange(nextPage);
    setSelectedTextId((currentId) => currentId === id ? null : currentId);
  }, [onChange]);

  const deleteSelected = () => {
    if (selectedTextId) deleteTextBlock(selectedTextId);
  };

  const contentWidth = navigationBounds.maxX - navigationBounds.minX;
  const contentHeight = navigationBounds.maxY - navigationBounds.minY;

  return (
    <>
      <div
        ref={viewportRef}
        className="canvas-viewport"
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={finishPointer}
        onWheel={handleWheel}
        onContextMenu={(event) => event.preventDefault()}
        onPaste={handlePaste}
        onKeyDown={(event) => {
          if (event.defaultPrevented || isEditingText(event.nativeEvent)) return;
          if ((event.key === "Backspace" || event.key === "Delete") && selectedTextId) {
            event.preventDefault();
            deleteSelected();
          }
        }}
        tabIndex={0}
      >
        <motion.div className="canvas-scroll-surface" key={page.id} style={{ width: surfaceSize.width, height: surfaceSize.height }} initial={{ opacity: 0, scale: 0.995 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.22, ease: "easeOut" }}>
          <div className={`canvas-world sheet-${sheetBackground}`} style={{ width: contentWidth, height: contentHeight, transform: `scale(${zoom})` }}>
            <svg className="stroke-layer" viewBox={`${navigationBounds.minX - WORLD_ORIGIN} ${navigationBounds.minY - WORLD_ORIGIN} ${contentWidth} ${contentHeight}`} aria-label="Drawing layer">
              {page.strokes.map((stroke) => (
                <path key={stroke.id} d={strokePath(stroke.points)} fill="none" stroke={strokeColor(stroke, theme)} strokeWidth={stroke.width} strokeOpacity={stroke.opacity} strokeLinecap="round" strokeLinejoin="round" />
              ))}
              {draftStroke ? <path d={strokePath(draftStroke.points)} fill="none" stroke={strokeColor(draftStroke, theme)} strokeWidth={draftStroke.width} strokeOpacity={draftStroke.opacity} strokeLinecap="round" strokeLinejoin="round" /> : null}
            </svg>
            {(page.imageBlocks ?? []).map((block) => (
              <figure key={block.id} className="image-block content-block" style={{ left: block.x - navigationBounds.minX, top: block.y - navigationBounds.minY, width: block.width, height: block.height }} onPointerDown={(event) => event.stopPropagation()}>
                <img src={block.src} alt={block.alt} draggable={false} />
                {block.source ? <figcaption>{block.source.title}</figcaption> : null}
                <button className="content-block-delete" type="button" onClick={() => removeBlock("image", block.id)} aria-label="Remove image"><Trash2 /></button>
              </figure>
            ))}
            {(page.tableBlocks ?? []).map((block: TableBlock) => (
              <div key={block.id} className="table-block content-block" style={{ left: block.x - navigationBounds.minX, top: block.y - navigationBounds.minY, width: block.width }} onPointerDown={(event) => event.stopPropagation()}>
                <table><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, columnIndex) => <td key={columnIndex}><input value={cell} aria-label={`Row ${rowIndex + 1}, column ${columnIndex + 1}`} onChange={(event) => updateTable(block.id, block.rows.map((item, itemIndex) => itemIndex === rowIndex ? item.map((value, valueIndex) => valueIndex === columnIndex ? event.target.value : value) : item))} placeholder={rowIndex === 0 ? "Heading" : "Type…"} /></td>)}</tr>)}</tbody></table>
                <button className="content-block-delete" type="button" onClick={() => removeBlock("table", block.id)} aria-label="Remove table"><Trash2 /></button>
              </div>
            ))}
            {(page.linkBlocks ?? []).map((block) => (
              <div key={block.id} className="link-block content-block" style={{ left: block.x - navigationBounds.minX, top: block.y - navigationBounds.minY, width: block.width }} onPointerDown={(event) => event.stopPropagation()}>
                <ExternalLink /><a href={block.url} target="_blank" rel="noreferrer" title={block.url}>{block.label}</a>
                <button className="content-block-delete" type="button" onClick={() => removeBlock("link", block.id)} aria-label="Remove link"><Trash2 /></button>
              </div>
            ))}
            <AnimatePresence initial={false}>
            {page.textBlocks.map((block) => (
              <motion.div
                key={block.id}
                className={`text-block-shell ${selectedTextId === block.id ? "selected" : ""}`}
                style={{ left: block.x - navigationBounds.minX, top: block.y - navigationBounds.minY, width: block.width, height: textBlockHeight(block) }}
                initial={{ opacity: 0, y: 7, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -5, scale: 0.97 }}
                transition={{ type: "spring", stiffness: 420, damping: 30 }}
              >
                <textarea
                  className="text-block"
                  style={{ left: 0, top: 0, width: "100%", height: "100%" }}
                  value={block.text}
                  placeholder="Type something…"
                  onPointerDown={(event) => { event.stopPropagation(); setSelectedTextId(block.id); }}
                  onFocus={() => setSelectedTextId(block.id)}
                  onChange={(event) => updateText(block.id, event.target.value)}
                  autoFocus={block.id === selectedTextId && block.text === ""}
                  aria-label="Canvas text block"
                />
                <motion.button
                  type="button"
                  className="text-block-delete"
                  aria-label="Remove text box"
                  title="Remove text box"
                  whileHover={{ scale: 1.08 }}
                  whileTap={{ scale: 0.9 }}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => { event.stopPropagation(); deleteTextBlock(block.id); }}
                >
                  <Trash2 />
                </motion.button>
              </motion.div>
            ))}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
      <motion.div className="zoom-chip" layout transition={{ type: "spring", stiffness: 400, damping: 30 }}>{Math.round(zoom * 100)}% · Ctrl / ⌘ scroll to zoom</motion.div>
    </>
  );
}
