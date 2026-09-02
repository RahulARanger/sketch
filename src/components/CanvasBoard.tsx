import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { b64Vecs, createShapeId, createTLStore, defaultShapeUtils, DefaultColorStyle, DefaultSizeStyle, getSnapshot, renderPlaintextFromRichText, Tldraw, toRichText, type Editor, type TLBookmarkShape, type TLDefaultColorStyle, type TLDefaultSizeStyle, type TLDrawShape, type TLHighlightShape, type TLImageShape, type TLShape, type TLShapeId, type TLTextShape } from "tldraw";
import "tldraw/tldraw.css";
import { Eraser } from "lucide-react";
import { motion } from "motion/react";
import { getInitialScrollPosition, getNavigationBounds, getScrollSurfaceSize, WORLD_ORIGIN } from "../canvasNavigation";
import { isEditingText } from "../keyboardShortcuts";
import type { SheetBackground } from "./SettingsPanel";
import { IMAGE_SHAPE_TYPE, LINK_SHAPE_TYPE, TABLE_SHAPE_TYPE, ImageShapeUtil, LinkShapeUtil, TableShapeUtil, type ImageShape, type LinkShape, type TableShape } from "./CanvasShapeUtils";
import type { ImageBlock, LinkBlock, NotePage, PenPreset, Point, Stroke, TableBlock, TextBlock, ToolId } from "../types";

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

export type CanvasBoardHandle = {
  insertImage: (file: File) => Promise<boolean>;
  insertTable: () => void;
  insertLink: (url: string) => void;
};

type BoardShape = TLDrawShape | TLHighlightShape | TLTextShape | TLImageShape | TLBookmarkShape | TableShape | LinkShape | ImageShape;

const TLDRAW_COLORS: Array<{ name: TLDefaultColorStyle; hex: string }> = [
  { name: "black", hex: "#1c2228" }, { name: "blue", hex: "#2f7df4" }, { name: "red", hex: "#ef4e4e" }, { name: "green", hex: "#35ad66" },
  { name: "violet", hex: "#9a5de0" }, { name: "yellow", hex: "#f6c945" }, { name: "orange", hex: "#ef8b3f" }, { name: "white", hex: "#f4f6f8" },
];

function hexRgb(hex: string) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function closestTldrawColor(hex: string): TLDefaultColorStyle {
  const wanted = hexRgb(hex);
  return TLDRAW_COLORS.reduce((closest, candidate) => {
    const color = hexRgb(candidate.hex);
    const distance = (wanted.r - color.r) ** 2 + (wanted.g - color.g) ** 2 + (wanted.b - color.b) ** 2;
    return distance < closest.distance ? { name: candidate.name, distance } : closest;
  }, { name: TLDRAW_COLORS[0].name, distance: Number.POSITIVE_INFINITY }).name;
}

function hexForTldrawColor(color: string) { return TLDRAW_COLORS.find((candidate) => candidate.name === color)?.hex ?? "#1c2228"; }
function tldrawSizeForWidth(width: number): TLDefaultSizeStyle { return width <= 3 ? "s" : width <= 6 ? "m" : width <= 12 ? "l" : "xl"; }
function widthForTldrawSize(size: string) { return size === "s" ? 2 : size === "l" ? 8 : size === "xl" ? 18 : 4; }
function shapeIdForLegacyId(id: string) { return createShapeId(id); }
function legacyIdForShape(shape: TLShape) { return shape.id.replace(/^shape:/, ""); }

function pageElementsFingerprint(page: NotePage) {
  return JSON.stringify({ strokes: page.strokes, textBlocks: page.textBlocks, imageBlocks: page.imageBlocks ?? [], tableBlocks: page.tableBlocks ?? [], linkBlocks: page.linkBlocks ?? [] });
}

function strokeToTldrawShape(stroke: Stroke, bounds: { minX: number; minY: number }) {
  const absolutePoints = stroke.points.map((point) => ({ x: point.x + WORLD_ORIGIN - bounds.minX, y: point.y + WORLD_ORIGIN - bounds.minY, z: point.pressure ?? 0.5 }));
  const minX = Math.min(...absolutePoints.map((point) => point.x));
  const minY = Math.min(...absolutePoints.map((point) => point.y));
  const points = absolutePoints.map((point) => ({ x: point.x - minX, y: point.y - minY, z: point.z }));
  const isHighlighter = stroke.opacity < 0.9 || stroke.width > 10;
  return {
    id: shapeIdForLegacyId(stroke.id), type: isHighlighter ? "highlight" as const : "draw" as const, x: minX, y: minY, opacity: stroke.opacity,
    props: { color: closestTldrawColor(stroke.color), ...(isHighlighter ? {} : { fill: "none" as const }), dash: "draw" as const, size: tldrawSizeForWidth(stroke.width), segments: [{ type: "free" as const, path: b64Vecs.encodePoints(points) }], isComplete: true, isClosed: false, isPen: true, scale: 1, scaleX: 1, scaleY: 1 },
    meta: { bosketchColor: stroke.color, bosketchWidth: stroke.width, bosketchOpacity: stroke.opacity, bosketchColorRole: stroke.colorRole ?? null },
  };
}

function strokeFromTldrawShape(shape: TLDrawShape | TLHighlightShape, bounds: { minX: number; minY: number }): Stroke | null {
  const meta = shape.meta as { bosketchColor?: unknown; bosketchWidth?: unknown; bosketchOpacity?: unknown; bosketchColorRole?: unknown };
  const points = shape.props.segments.flatMap((segment) => b64Vecs.decodePoints(segment.path, segment.dim)).map((point) => ({ x: shape.x + point.x + bounds.minX - WORLD_ORIGIN, y: shape.y + point.y + bounds.minY - WORLD_ORIGIN, pressure: point.z }));
  if (points.length === 0) return null;
  return { id: legacyIdForShape(shape), color: typeof meta.bosketchColor === "string" ? meta.bosketchColor : hexForTldrawColor(shape.props.color), colorRole: meta.bosketchColorRole === "contrast" ? "contrast" : undefined, width: typeof meta.bosketchWidth === "number" ? meta.bosketchWidth : widthForTldrawSize(shape.props.size), opacity: typeof meta.bosketchOpacity === "number" ? meta.bosketchOpacity : shape.opacity, points };
}

function isBoardShape(shape: TLShape): shape is BoardShape {
  return shape.type === "draw" || shape.type === "highlight" || shape.type === "text" || shape.type === "image" || shape.type === "bookmark" || shape.type === IMAGE_SHAPE_TYPE || shape.type === LINK_SHAPE_TYPE || shape.type === TABLE_SHAPE_TYPE;
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

function textShapeFromBlock(block: TextBlock, bounds: { minX: number; minY: number }) {
  return { id: shapeIdForLegacyId(block.id), type: "text" as const, x: block.x - bounds.minX, y: block.y - bounds.minY, props: { color: "black" as const, size: "m" as const, font: "sans" as const, textAlign: "start" as const, w: Math.max(160, block.width), richText: toRichText(block.text), scale: 1, autoSize: false } };
}

function imageShapeFromBlock(block: ImageBlock, bounds: { minX: number; minY: number }) {
  return { id: shapeIdForLegacyId(block.id), type: IMAGE_SHAPE_TYPE, x: block.x - bounds.minX, y: block.y - bounds.minY, props: { w: block.width, h: block.height, src: block.src, alt: block.alt } } as const;
}

function tableShapeFromBlock(block: TableBlock, bounds: { minX: number; minY: number }) {
  return { id: shapeIdForLegacyId(block.id), type: TABLE_SHAPE_TYPE, x: block.x - bounds.minX, y: block.y - bounds.minY, props: { w: Math.max(240, block.width), h: Math.max(120, block.rows.length * 48), rows: block.rows } } as const;
}

function linkShapeFromBlock(block: LinkBlock, bounds: { minX: number; minY: number }) {
  return { id: shapeIdForLegacyId(block.id), type: LINK_SHAPE_TYPE, x: block.x - bounds.minX, y: block.y - bounds.minY, props: { w: Math.max(300, block.width), h: 92, url: block.url, label: block.label } } as const;
}

function capturePointer(target: Element, pointerId: number) {
  // A stylus can disappear between pointerdown and capture (for example when
  // it is lifted from a WebView). Pointer capture is helpful but must never be
  // allowed to take down the whole drawing surface.
  try { target.setPointerCapture(pointerId); } catch { /* the pointer is already gone */ }
}

function nativeShapesFromPage(page: NotePage, bounds: { minX: number; minY: number }) {
  return [...page.strokes.map((stroke) => strokeToTldrawShape(stroke, bounds)), ...page.textBlocks.map((block) => textShapeFromBlock(block, bounds)), ...(page.imageBlocks ?? []).map((block) => imageShapeFromBlock(block, bounds)), ...(page.tableBlocks ?? []).map((block) => tableShapeFromBlock(block, bounds)), ...(page.linkBlocks ?? []).map((block) => linkShapeFromBlock(block, bounds))];
}

function imageUrlFromShape(editor: Editor, shape: TLImageShape) {
  if (shape.props.url) return shape.props.url;
  if (!shape.props.assetId) return "";
  const asset = editor.getAsset(shape.props.assetId);
  return asset && "src" in asset.props ? asset.props.src ?? "" : "";
}

async function readImageFile(file: File) {
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Image data could not be read."));
    reader.onerror = () => reject(new Error("Image data could not be read."));
    reader.readAsDataURL(file);
  });
  const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => image.naturalWidth > 0 && image.naturalHeight > 0 ? resolve({ width: image.naturalWidth, height: image.naturalHeight }) : reject(new Error("Image has no usable dimensions."));
    image.onerror = () => reject(new Error("Image could not be decoded."));
    image.src = src;
  });
  return { src, ...size };
}

function pageElementsFromEditor(editor: Editor, bounds: { minX: number; minY: number }): Pick<NotePage, "strokes" | "textBlocks" | "imageBlocks" | "tableBlocks" | "linkBlocks"> {
  const strokes: Stroke[] = [], textBlocks: TextBlock[] = [], imageBlocks: ImageBlock[] = [], tableBlocks: TableBlock[] = [], linkBlocks: LinkBlock[] = [];
  for (const shape of editor.getCurrentPageShapes().filter(isBoardShape) as BoardShape[]) {
    if (shape.type === "draw" || shape.type === "highlight") {
      const stroke = strokeFromTldrawShape(shape, bounds); if (stroke) strokes.push(stroke);
    } else if (shape.type === "text") {
      textBlocks.push({ id: legacyIdForShape(shape), x: shape.x + bounds.minX, y: shape.y + bounds.minY, width: shape.props.w, text: renderPlaintextFromRichText(editor, shape.props.richText) });
    } else if (shape.type === "image") {
      imageBlocks.push({ id: legacyIdForShape(shape), x: shape.x + bounds.minX, y: shape.y + bounds.minY, width: shape.props.w, height: shape.props.h, src: imageUrlFromShape(editor, shape), alt: shape.props.altText });
    } else if (shape.type === IMAGE_SHAPE_TYPE) {
      imageBlocks.push({ id: legacyIdForShape(shape), x: shape.x + bounds.minX, y: shape.y + bounds.minY, width: shape.props.w, height: shape.props.h, src: shape.props.src, alt: shape.props.alt });
    } else if (shape.type === "bookmark") {
      const meta = shape.meta as { bosketchLabel?: unknown };
      let label = typeof meta.bosketchLabel === "string" ? meta.bosketchLabel : shape.props.url;
      try { label = new URL(shape.props.url).hostname.replace(/^www\./, ""); } catch { /* keep URL */ }
      linkBlocks.push({ id: legacyIdForShape(shape), x: shape.x + bounds.minX, y: shape.y + bounds.minY, width: shape.props.w, url: shape.props.url, label });
    } else if (shape.type === LINK_SHAPE_TYPE) {
      linkBlocks.push({ id: legacyIdForShape(shape), x: shape.x + bounds.minX, y: shape.y + bounds.minY, width: shape.props.w, url: shape.props.url, label: shape.props.label });
    } else {
      tableBlocks.push({ id: legacyIdForShape(shape), x: shape.x + bounds.minX, y: shape.y + bounds.minY, width: shape.props.w, rows: shape.props.rows });
    }
  }
  return { strokes, textBlocks, imageBlocks, tableBlocks, linkBlocks };
}

function isPointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index], previousPoint = polygon[previous];
    const intersects = (currentPoint.y > point.y) !== (previousPoint.y > point.y) && point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) / (previousPoint.y - currentPoint.y) + currentPoint.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function strokePath(points: Point[]) {
  if (points.length < 2) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) { const current = points[index], next = points[index + 1]; path += ` Q ${current.x} ${current.y} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`; }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

export const CanvasBoard = forwardRef<CanvasBoardHandle, CanvasBoardProps>(function CanvasBoard({ page, tool, preset, theme, sheetBackground, onChange, onToolChange, onHardwareEraserChange }, ref) {
  const viewportRef = useRef<HTMLDivElement>(null), canvasWorldRef = useRef<HTMLDivElement>(null), pageRef = useRef(page);
  const tldrawEditorRef = useRef<Editor | null>(null), tldrawEditorPageIdRef = useRef<string | null>(null), tldrawHydratingRef = useRef(false), tldrawSyncFrameRef = useRef<number | null>(null);
  const pendingTldrawEditorRef = useRef<Editor | null>(null), navigationBoundsRef = useRef({ minX: 0, minY: 0 }), onChangeRef = useRef(onChange);
  const pendingInsertionsRef = useRef<Array<{ pageId: string; action: (editor: Editor) => void }>>([]);
  const tldrawStateRef = useRef({ legacyFingerprint: "", minX: Number.NaN, minY: Number.NaN });
  const [zoom, setZoom] = useState(1), [viewportSize, setViewportSize] = useState({ width: 0, height: 0 }), [draftLasso, setDraftLasso] = useState<Point[] | null>(null), [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null), [tldrawMounted, setTldrawMounted] = useState(false);
  const pointerModeRef = useRef<"lasso" | "draw" | "erase" | "idle">("idle"), nativeWacomEraserRef = useRef(false), hardwareEraserRef = useRef(false);
  const draftStrokeRef = useRef<Stroke | null>(null);
  const [draftStroke, setDraftStroke] = useState<Stroke | null>(null);
  const previousLayoutRef = useRef<{ pageId: string; minX: number; minY: number; zoom: number } | null>(null), zoomAnchorRef = useRef<{ localX: number; localY: number; worldX: number; worldY: number } | null>(null);
  const shapeUtils = useMemo(() => [...defaultShapeUtils, TableShapeUtil, LinkShapeUtil, ImageShapeUtil], []);
  // Legacy page arrays are the durable source of truth. Snapshots written by
  // older packaged builds can be incomplete, so loading one directly can make
  // a release build show a blank board even though the page still has strokes.
  const tldrawStore = useMemo(() => createTLStore({ shapeUtils }), [page.id, shapeUtils]);
  const navigationBounds = useMemo(() => getNavigationBounds(page, viewportSize.width, viewportSize.height, zoom), [page, viewportSize.height, viewportSize.width, zoom]);
  const surfaceSize = useMemo(() => getScrollSurfaceSize(navigationBounds, zoom), [navigationBounds, zoom]);
  const legacyFingerprint = useMemo(() => pageElementsFingerprint(page), [page]);
  pageRef.current = page;
  navigationBoundsRef.current = navigationBounds;
  onChangeRef.current = onChange;

  const setHardwareEraserActive = useCallback((active: boolean) => { if (hardwareEraserRef.current === active) return; hardwareEraserRef.current = active; onHardwareEraserChange(active); }, [onHardwareEraserChange]);
  const erasing = tool === "eraser" || hardwareEraserRef.current || nativeWacomEraserRef.current;

  useEffect(() => { setZoom(1); setDraftLasso(null); setDraftStroke(null); draftStrokeRef.current = null; pointerModeRef.current = "idle"; setCursorPosition(null); }, [page.id]);
  useEffect(() => {
    const viewport = viewportRef.current; if (!viewport) return;
    const syncSize = () => { const rect = viewport.getBoundingClientRect(); setViewportSize({ width: rect.width, height: rect.height }); };
    syncSize(); const observer = new ResizeObserver(syncSize); observer.observe(viewport); return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const viewport = viewportRef.current; if (!viewportSize.width || !viewportSize.height || !viewport) return;
    const previous = previousLayoutRef.current, zoomAnchor = zoomAnchorRef.current;
    if (!previous || previous.pageId !== page.id) { const initial = getInitialScrollPosition(navigationBounds, zoom); viewport.scrollLeft = initial.left; viewport.scrollTop = initial.top; }
    else if (zoomAnchor) { viewport.scrollLeft = (zoomAnchor.worldX - navigationBounds.minX) * zoom - zoomAnchor.localX; viewport.scrollTop = (zoomAnchor.worldY - navigationBounds.minY) * zoom - zoomAnchor.localY; zoomAnchorRef.current = null; }
    else { viewport.scrollLeft += (previous.minX - navigationBounds.minX) * zoom; viewport.scrollTop += (previous.minY - navigationBounds.minY) * zoom; }
    previousLayoutRef.current = { pageId: page.id, minX: navigationBounds.minX, minY: navigationBounds.minY, zoom };
  }, [navigationBounds, page.id, viewportSize.height, viewportSize.width, zoom]);

  const updateCursorPosition = useCallback((event: ReactPointerEvent<HTMLDivElement>) => { const bounds = event.currentTarget.getBoundingClientRect(); setCursorPosition({ x: event.clientX - bounds.left + event.currentTarget.scrollLeft, y: event.clientY - bounds.top + event.currentTarget.scrollTop }); }, []);
  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    const viewport = viewportRef.current, bounds = viewport?.getBoundingClientRect(), canvasBounds = canvasWorldRef.current?.getBoundingClientRect();
    return { x: canvasBounds ? navigationBounds.minX - WORLD_ORIGIN + (clientX - canvasBounds.left) / zoom : navigationBounds.minX + (clientX - (bounds?.left ?? 0) + (viewport?.scrollLeft ?? 0)) / zoom - WORLD_ORIGIN, y: canvasBounds ? navigationBounds.minY - WORLD_ORIGIN + (clientY - canvasBounds.top) / zoom : navigationBounds.minY + (clientY - (bounds?.top ?? 0) + (viewport?.scrollTop ?? 0)) / zoom - WORLD_ORIGIN };
  }, [navigationBounds.minX, navigationBounds.minY, zoom]);
  const toTldrawPoint = useCallback((clientX: number, clientY: number) => {
    const worldPoint = toWorld(clientX, clientY);
    return { x: worldPoint.x + WORLD_ORIGIN, y: worldPoint.y + WORLD_ORIGIN };
  }, [toWorld]);
  const visibleCanvasCenter = useCallback(() => {
    const viewport = viewportRef.current;
    const bounds = viewport?.getBoundingClientRect();
    return bounds ? toTldrawPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2) : { x: 0, y: 0 };
  }, [toTldrawPoint]);

  const runWhenEditorReady = useCallback((action: (editor: Editor) => void) => {
    const editor = tldrawEditorRef.current;
    if (editor && tldrawEditorPageIdRef.current === pageRef.current.id) {
      action(editor);
      return;
    }
    pendingInsertionsRef.current.push({ pageId: pageRef.current.id, action });
  }, []);

  const syncPageFromEditor = useCallback((editor: Editor) => {
    if (tldrawHydratingRef.current) return;
    // A store event can be queued just before a native pen stroke is
    // committed. In that case the editor still contains the previous page and
    // must not overwrite the newer legacy arrays with stale content.
    if (tldrawStateRef.current.legacyFingerprint !== pageElementsFingerprint(pageRef.current)) return;
    const bounds = navigationBoundsRef.current;
    const nextPage: NotePage = { ...pageRef.current, ...pageElementsFromEditor(editor, bounds), tldrawSnapshot: getSnapshot(editor.store).document, updatedAt: new Date().toISOString() };
    tldrawStateRef.current = { legacyFingerprint: pageElementsFingerprint(nextPage), minX: bounds.minX, minY: bounds.minY }; pageRef.current = nextPage; onChangeRef.current(nextPage);
  }, []);

  const cancelQueuedTldrawSync = useCallback(() => {
    pendingTldrawEditorRef.current = null;
    if (tldrawSyncFrameRef.current !== null) {
      window.cancelAnimationFrame(tldrawSyncFrameRef.current);
      tldrawSyncFrameRef.current = null;
    }
  }, []);

  const eraseAt = useCallback((point: Point) => {
    const currentPage = pageRef.current;
    const nextStrokes = currentPage.strokes.filter((stroke) => distanceToStroke(point, stroke) > 14 + stroke.width / 2);
    if (nextStrokes.length === currentPage.strokes.length) return;
    const nextPage = { ...currentPage, strokes: nextStrokes, updatedAt: new Date().toISOString() };
    const editor = tldrawEditorRef.current;
    if (editor) {
      const removedIds = currentPage.strokes.filter((stroke) => !nextStrokes.some((candidate) => candidate.id === stroke.id)).map((stroke) => shapeIdForLegacyId(stroke.id));
      editor.deleteShapes(removedIds);
      cancelQueuedTldrawSync();
      nextPage.tldrawSnapshot = getSnapshot(editor.store).document;
      tldrawStateRef.current = { legacyFingerprint: pageElementsFingerprint(nextPage), minX: navigationBoundsRef.current.minX, minY: navigationBoundsRef.current.minY };
    }
    pageRef.current = nextPage;
    onChangeRef.current(nextPage);
  }, [cancelQueuedTldrawSync]);
  const schedulePageSync = useCallback((editor: Editor) => {
    pendingTldrawEditorRef.current = editor;
    if (tldrawSyncFrameRef.current !== null) return;
    tldrawSyncFrameRef.current = window.requestAnimationFrame(() => {
      tldrawSyncFrameRef.current = null;
      const pendingEditor = pendingTldrawEditorRef.current;
      pendingTldrawEditorRef.current = null;
      if (pendingEditor && pendingEditor === tldrawEditorRef.current) syncPageFromEditor(pendingEditor);
    });
  }, [syncPageFromEditor]);
  const applyTldrawTool = useCallback((editor: Editor) => {
    const nextTool = tool === "pen" ? "draw" : tool === "highlighter" ? "highlight" : tool === "eraser" ? "eraser" : tool === "pan" ? "hand" : tool === "text" ? "text" : "select";
    editor.setCurrentTool(nextTool); editor.setStyleForNextShapes(DefaultColorStyle, closestTldrawColor(preset.color)); editor.setStyleForNextShapes(DefaultSizeStyle, tldrawSizeForWidth(preset.width)); editor.setOpacityForNextShapes(preset.opacity); if (tool !== "select" && tool !== "text") editor.selectNone();
  }, [preset.color, preset.opacity, preset.width, tool]);

  const handleTldrawMount = useCallback((editor: Editor) => {
    tldrawEditorRef.current = editor; tldrawEditorPageIdRef.current = pageRef.current.id; setTldrawMounted(true); tldrawHydratingRef.current = true; editor.setCamera({ x: 0, y: 0, z: 1 }); applyTldrawTool(editor); editor.createShapes(nativeShapesFromPage(pageRef.current, navigationBounds));
    tldrawStateRef.current = { legacyFingerprint, minX: navigationBounds.minX, minY: navigationBounds.minY }; tldrawHydratingRef.current = false;
    const pendingInsertions = pendingInsertionsRef.current;
    pendingInsertionsRef.current = [];
    pendingInsertions.filter((pending) => pending.pageId === pageRef.current.id).forEach((pending) => pending.action(editor));
    const unlisten = editor.store.listen((entry) => {
      const removedShapeIds = Object.keys(entry.changes.removed).filter((id) => id.startsWith("shape:"));
      const changedIds = [...Object.keys(entry.changes.added), ...Object.keys(entry.changes.updated), ...Object.keys(entry.changes.removed)];

      if (removedShapeIds.length) {
        // tldraw normally removes deleted shapes from the selection in its
        // operation-complete side effect. That cleanup happens after the
        // document store notification, though, so the overlay canvas can
        // paint the selection indicator once more using the deleted geometry.
        // Remove the ids eagerly so deletion never leaves a visible ghost.
        editor.deselect(...removedShapeIds as TLShapeId[]);
        editor.updateCurrentPageState({ hoveredShapeId: null, hintingShapeIds: [] });
      }

      if (changedIds.some((id) => id.startsWith("shape:"))) schedulePageSync(editor);
    }, { scope: "document", source: "user" });
    // tldraw's store listener reports the finalized shape after pointer-up.
    // Do not snapshot from a global pointer-up capture listener: that runs
    // before tldraw finalizes the gesture and can overwrite the page with an
    // empty/partial store.
    queueMicrotask(() => syncPageFromEditor(editor));
    return () => {
      unlisten();
      if (pendingTldrawEditorRef.current === editor) {
        pendingTldrawEditorRef.current = null;
        if (tldrawSyncFrameRef.current !== null) { window.cancelAnimationFrame(tldrawSyncFrameRef.current); tldrawSyncFrameRef.current = null; }
      }
      if (tldrawEditorRef.current === editor) { tldrawEditorRef.current = null; tldrawEditorPageIdRef.current = null; setTldrawMounted(false); }
    };
  }, [applyTldrawTool, legacyFingerprint, navigationBounds, schedulePageSync, syncPageFromEditor]);
  useEffect(() => { const editor = tldrawEditorRef.current; if (editor) applyTldrawTool(editor); }, [applyTldrawTool]);
  useEffect(() => {
    let unlisten: (() => void) | undefined, cancelled = false;
    listen<boolean>("wacom-eraser-state", (event) => { nativeWacomEraserRef.current = event.payload; setHardwareEraserActive(event.payload); const editor = tldrawEditorRef.current; if (event.payload) editor?.setCurrentTool("eraser"); else if (editor) applyTldrawTool(editor); }).then((remove) => { if (cancelled) remove(); else unlisten = remove; }).catch(() => { /* Native Tauri builds provide this event; Vite preview does not. */ });
    return () => { cancelled = true; unlisten?.(); nativeWacomEraserRef.current = false; setHardwareEraserActive(false); };
  }, [applyTldrawTool, setHardwareEraserActive]);
  useEffect(() => {
    const editor = tldrawEditorRef.current; if (!editor || tldrawHydratingRef.current) return;
    // A stroke changes the navigation bounds as it grows. Rehydrating the
    // editor for that layout-only change deletes the live shapes and can make
    // a just-finished stroke disappear until the page is reloaded. The
    // fingerprint is the actual external-content signal; bounds are handled
    // by the viewport layout effect above.
    const state = tldrawStateRef.current; if (state.legacyFingerprint === legacyFingerprint) return;
    tldrawHydratingRef.current = true; const existingIds = editor.getCurrentPageShapes().filter(isBoardShape).map((shape) => shape.id); if (existingIds.length) editor.deleteShapes(existingIds); editor.createShapes(nativeShapesFromPage(page, navigationBounds)); tldrawStateRef.current = { legacyFingerprint, minX: navigationBounds.minX, minY: navigationBounds.minY }; tldrawHydratingRef.current = false;
    // Programmatic hydration may not be reported as a user store event. Save
    // the rebuilt document snapshot explicitly so the stroke survives reloads
    // and page switches as well as the current render.
    queueMicrotask(() => { if (tldrawEditorRef.current === editor) syncPageFromEditor(editor); });
  }, [legacyFingerprint, navigationBounds, page]);

  useImperativeHandle(ref, () => ({
    insertImage: async (file) => {
      try {
        const image = await readImageFile(file);
        const maxWidth = 720, maxHeight = 520;
        const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
        let inserted = false;
        runWhenEditorReady((editor) => {
          const center = visibleCanvasCenter();
          editor.createShape({ id: createShapeId(), type: IMAGE_SHAPE_TYPE, x: center.x - image.width * scale / 2, y: center.y - image.height * scale / 2, props: { w: image.width * scale, h: image.height * scale, src: image.src, alt: file.name } });
          inserted = true;
        });
        return inserted;
      } catch {
        return false;
      }
    },
    insertTable: () => runWhenEditorReady((editor) => { const center = visibleCanvasCenter(); editor.createShape({ id: createShapeId(), type: TABLE_SHAPE_TYPE, x: center.x - 240, y: center.y - 90, props: { w: 480, h: 180, rows: [["Heading", "Heading", "Heading"], ["", "", ""], ["", "", ""]] } }); }),
    insertLink: (url) => runWhenEditorReady((editor) => {
      const center = visibleCanvasCenter();
      let label = url;
      try { label = new URL(url).hostname.replace(/^www\./, ""); } catch { /* App validates links before they reach the board. */ }
      editor.createShape({ id: createShapeId(), type: LINK_SHAPE_TYPE, x: center.x - 180, y: center.y - 46, props: { w: 360, h: 92, url, label } });
    }),
  }), [ref, runWhenEditorReady, visibleCanvasCenter]);

  const selectShapesInLasso = useCallback((lasso: Point[]) => {
    const editor = tldrawEditorRef.current; if (!editor || lasso.length < 3) return;
    const selectedIds = editor.getCurrentPageShapes().filter(isBoardShape).filter((shape) => { const bounds = editor.getShapePageBounds(shape); if (!bounds) return false; return isPointInPolygon({ x: bounds.x + bounds.w / 2 + navigationBounds.minX - WORLD_ORIGIN, y: bounds.y + bounds.h / 2 + navigationBounds.minY - WORLD_ORIGIN }, lasso); }).map((shape) => shape.id);
    editor.select(...selectedIds); onToolChange("select");
  }, [navigationBounds.minX, navigationBounds.minY, onToolChange]);

  const startNativeInk = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    capturePointer(event.currentTarget, event.pointerId);
    const point = toWorld(event.clientX, event.clientY);
    if (erasing) {
      pointerModeRef.current = "erase";
      eraseAt(point);
      return;
    }
    const stroke: Stroke = {
      id: crypto.randomUUID(),
      color: preset.color,
      colorRole: preset.id === "contrast" && preset.color === (theme === "dark" ? "#f4f6f8" : "#1c2228") ? "contrast" : undefined,
      width: preset.width,
      opacity: preset.opacity,
      points: [{ ...point, pressure: event.pressure || 0.5 }],
    };
    pointerModeRef.current = "draw";
    draftStrokeRef.current = stroke;
    setDraftStroke(stroke);
    tldrawEditorRef.current?.selectNone();
  }, [eraseAt, erasing, preset.color, preset.id, preset.opacity, preset.width, theme, toWorld]);

  const moveNativeInk = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerModeRef.current === "idle" && (event.buttons !== 0 || event.pressure > 0)) {
      startNativeInk(event);
      return;
    }
    if (pointerModeRef.current === "erase") {
      eraseAt(toWorld(event.clientX, event.clientY));
      return;
    }
    if (pointerModeRef.current !== "draw") return;
    const point = toWorld(event.clientX, event.clientY);
    setDraftStroke((current) => {
      if (!current) return current;
      const next = { ...current, points: [...current.points, { ...point, pressure: event.pressure || 0.5 }] };
      draftStrokeRef.current = next;
      return next;
    });
  }, [eraseAt, startNativeInk, toWorld]);

  const finishNativeInk = useCallback(() => {
    if (pointerModeRef.current === "draw") {
      const stroke = draftStrokeRef.current;
      if (stroke && stroke.points.length > 1) {
        const nextPage = { ...pageRef.current, strokes: [...pageRef.current.strokes, stroke], updatedAt: new Date().toISOString() };
        const editor = tldrawEditorRef.current;
        if (editor) {
          // Append to the live store so the existing board remains painted
          // while React persists the new legacy stroke. Rebuilding the entire
          // store on pointer-up exposes an empty frame in packaged WKWebView.
          editor.createShapes([strokeToTldrawShape(stroke, navigationBoundsRef.current)]);
          cancelQueuedTldrawSync();
          nextPage.tldrawSnapshot = getSnapshot(editor.store).document;
          tldrawStateRef.current = { legacyFingerprint: pageElementsFingerprint(nextPage), minX: navigationBoundsRef.current.minX, minY: navigationBoundsRef.current.minY };
        }
        pageRef.current = nextPage;
        onChangeRef.current(nextPage);
      }
      draftStrokeRef.current = null;
      setDraftStroke(null);
    }
    pointerModeRef.current = "idle";
  }, [cancelQueuedTldrawSync]);

  const handlePointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (tool === "lasso") {
      if (!target.closest(".tl-container")) return;
      const point = toWorld(event.clientX, event.clientY);
      event.preventDefault();
      event.stopPropagation();
      capturePointer(event.currentTarget, event.pointerId);
      pointerModeRef.current = "lasso";
      setDraftLasso([point]);
      tldrawEditorRef.current?.selectNone();
      return;
    }
  }, [toWorld, tool]);
  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => { updateCursorPosition(event); }, [updateCursorPosition]);
  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    updateCursorPosition(event);
    if (pointerModeRef.current === "lasso") {
      setDraftLasso((lasso) => lasso ? [...lasso, toWorld(event.clientX, event.clientY)] : null);
    }
  }, [toWorld, updateCursorPosition]);
  const finishPointer = useCallback(() => {
    if (pointerModeRef.current === "lasso") {
      const lasso = draftLasso;
      if (lasso) selectShapesInLasso(lasso);
      setDraftLasso(null);
    }
    pointerModeRef.current = "idle";
  }, [draftLasso, selectShapesInLasso]);
  const handleWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (!(event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      viewport.scrollLeft += event.deltaX;
      viewport.scrollTop += event.deltaY;
      return;
    }
    event.preventDefault();
    const bounds = viewport.getBoundingClientRect();
    const nextZoom = Math.min(2, Math.max(0.45, zoom * (event.deltaY > 0 ? 0.92 : 1.08)));
    if (nextZoom === zoom) return;
    const localX = event.clientX - bounds.left, localY = event.clientY - bounds.top;
    zoomAnchorRef.current = { localX, localY, worldX: navigationBounds.minX + (viewport.scrollLeft + localX) / zoom, worldY: navigationBounds.minY + (viewport.scrollTop + localY) / zoom };
    setZoom(nextZoom);
  }, [navigationBounds.minX, navigationBounds.minY, zoom]);

  return <>
      <div ref={viewportRef} className={`canvas-viewport ${erasing || tool === "pen" || tool === "highlighter" ? "canvas-tool-cursor" : ""}`} onPointerDownCapture={handlePointerDownCapture} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerLeave={() => setCursorPosition(null)} onPointerUp={finishPointer} onPointerCancel={finishPointer} onWheelCapture={handleWheel} onContextMenu={(event) => event.preventDefault()} tabIndex={0}>
      <motion.div className="canvas-scroll-surface" key={page.id} style={{ width: surfaceSize.width, height: surfaceSize.height }} initial={{ opacity: 0, scale: 0.995 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.22, ease: "easeOut" }}>
          <div ref={canvasWorldRef} className={`canvas-world sheet-${sheetBackground}`} style={{ width: navigationBounds.maxX - navigationBounds.minX, height: navigationBounds.maxY - navigationBounds.minY, transform: `scale(${zoom})` }}>
            <div className="tldraw-canvas-shell" aria-label="Drawing layer"><Tldraw key={page.id} store={tldrawStore} shapeUtils={shapeUtils} onMount={handleTldrawMount} hideUi colorScheme={theme} /></div>
            {(tool === "pen" || tool === "highlighter" || erasing) ? <div className="native-ink-layer" onPointerDown={startNativeInk} onPointerMove={moveNativeInk} onPointerUp={finishNativeInk} onPointerCancel={finishNativeInk} onLostPointerCapture={finishNativeInk} onMouseDown={startNativeInk} onMouseMove={moveNativeInk} onMouseUp={finishNativeInk} aria-hidden="true" /> : null}
            {!tldrawMounted && page.strokes.length ? <svg className="legacy-stroke-overlay" viewBox={`${navigationBounds.minX - WORLD_ORIGIN} ${navigationBounds.minY - WORLD_ORIGIN} ${navigationBounds.maxX - navigationBounds.minX} ${navigationBounds.maxY - navigationBounds.minY}`} aria-hidden="true">{page.strokes.map((stroke) => <path key={stroke.id} d={strokePath(stroke.points)} fill="none" stroke={stroke.color} strokeWidth={stroke.width} strokeOpacity={stroke.opacity} strokeLinecap="round" strokeLinejoin="round" />)}</svg> : null}
            {draftStroke ? <svg className="legacy-stroke-overlay" viewBox={`${navigationBounds.minX - WORLD_ORIGIN} ${navigationBounds.minY - WORLD_ORIGIN} ${navigationBounds.maxX - navigationBounds.minX} ${navigationBounds.maxY - navigationBounds.minY}`} aria-hidden="true"><path d={strokePath(draftStroke.points)} fill="none" stroke={draftStroke.color} strokeWidth={draftStroke.width} strokeOpacity={draftStroke.opacity} strokeLinecap="round" strokeLinejoin="round" /></svg> : null}
          {draftLasso ? <svg className="lasso-selection-layer" viewBox={`${navigationBounds.minX - WORLD_ORIGIN} ${navigationBounds.minY - WORLD_ORIGIN} ${navigationBounds.maxX - navigationBounds.minX} ${navigationBounds.maxY - navigationBounds.minY}`} aria-hidden="true"><path d={`${strokePath(draftLasso)} Z`} /></svg> : null}
        </div>
      </motion.div>
      {((erasing || tool === "pen" || tool === "highlighter") && cursorPosition) ? <div className={`canvas-cursor ${erasing ? "eraser-cursor" : "dot-cursor"}`} style={{ left: cursorPosition.x, top: cursorPosition.y }} aria-hidden="true">{erasing ? <Eraser /> : <span style={{ width: Math.max(5, preset.width * zoom), height: Math.max(5, preset.width * zoom), background: preset.color, opacity: preset.opacity }} />}</div> : null}
    </div>
    <motion.div className="zoom-chip" layout transition={{ type: "spring", stiffness: 400, damping: 30 }}>tldraw canvas · scroll to zoom</motion.div>
  </>;
});
