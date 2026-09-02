import type { CanvasBounds, NotePage, Stroke, TextBlock } from "./types.ts";

export const WORLD_ORIGIN = 50_000;
// Keep a generous empty canvas buffer after the content so panning/scrolling
// can continue as the board grows. This is intentionally in canvas units and
// scales with zoom along with the surface; the top/left edges stay anchored.
export const CONTENT_MARGIN = 640;

export function textBlockHeight(block: TextBlock) {
  if (typeof block.height === "number" && Number.isFinite(block.height)) return Math.max(92, block.height);
  // Keep enough room for long URLs, which browsers wrap at punctuation and
  // therefore occupy more rows than ordinary prose of the same length.
  const estimatedRows = block.text.split("\n").reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / 24)), 0);
  const displayMathBlocks = (block.text.match(/(?:\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\])/g) ?? []).length;
  return Math.max(92, estimatedRows * 28 + 30 + displayMathBlocks * 28);
}

export function getNavigationBounds(page: NotePage, viewportWidth: number, viewportHeight: number, zoom: number): CanvasBounds {
  const safeZoom = Math.max(zoom, 0.01);
  let minX = 0;
  let minY = 0;
  let maxX = viewportWidth / safeZoom;
  let maxY = viewportHeight / safeZoom;

  const includeStroke = (stroke: Stroke) => {
    for (const point of stroke.points) {
      minX = Math.min(minX, point.x + WORLD_ORIGIN);
      maxX = Math.max(maxX, point.x + WORLD_ORIGIN);
      minY = Math.min(minY, point.y + WORLD_ORIGIN);
      maxY = Math.max(maxY, point.y + WORLD_ORIGIN);
    }
  };

  page.strokes.forEach(includeStroke);
  for (const block of page.textBlocks) {
    minX = Math.min(minX, block.x);
    maxX = Math.max(maxX, block.x + block.width);
    minY = Math.min(minY, block.y);
    maxY = Math.max(maxY, block.y + textBlockHeight(block));
  }
  for (const block of page.imageBlocks ?? []) {
    minX = Math.min(minX, block.x);
    maxX = Math.max(maxX, block.x + block.width);
    minY = Math.min(minY, block.y);
    maxY = Math.max(maxY, block.y + block.height);
  }
  for (const block of page.tableBlocks ?? []) {
    const height = Math.max(96, block.rows.length * 38);
    minX = Math.min(minX, block.x);
    maxX = Math.max(maxX, block.x + block.width);
    minY = Math.min(minY, block.y);
    maxY = Math.max(maxY, block.y + height);
  }
  for (const block of page.linkBlocks ?? []) {
    minX = Math.min(minX, block.x);
    maxX = Math.max(maxX, block.x + block.width);
    minY = Math.min(minY, block.y);
    maxY = Math.max(maxY, block.y + 56);
  }

  return {
    minX,
    maxX: maxX + CONTENT_MARGIN,
    minY,
    maxY: maxY + CONTENT_MARGIN,
  };
}

export function getScrollSurfaceSize(bounds: CanvasBounds, zoom: number) {
  return {
    width: Math.max(1, (bounds.maxX - bounds.minX) * zoom),
    height: Math.max(1, (bounds.maxY - bounds.minY) * zoom),
  };
}

export function getInitialScrollPosition(bounds: CanvasBounds, zoom: number, pageInset = 24) {
  return {
    left: Math.max(0, -bounds.minX * zoom - pageInset),
    top: Math.max(0, -bounds.minY * zoom - pageInset),
  };
}
