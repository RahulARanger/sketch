import type { CanvasBounds, NotePage, Stroke, TextBlock } from "./types.ts";

export const WORLD_ORIGIN = 50_000;
export const CONTENT_MARGIN = 96;

export function textBlockHeight(block: TextBlock) {
  const estimatedRows = block.text.split("\n").reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / 34)), 0);
  return Math.max(92, estimatedRows * 28 + 30);
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
    minX: minX - CONTENT_MARGIN,
    maxX: maxX + CONTENT_MARGIN,
    minY: minY - CONTENT_MARGIN,
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
