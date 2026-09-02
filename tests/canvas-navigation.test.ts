import assert from "node:assert/strict";
import test from "node:test";
import { CONTENT_MARGIN, getInitialScrollPosition, getNavigationBounds, getScrollSurfaceSize, textBlockHeight } from "../src/canvasNavigation.ts";
import type { NotePage } from "../src/types.ts";

const emptyPage: NotePage = { id: "empty", title: "Empty", strokes: [], textBlocks: [], updatedAt: "2026-08-29T00:00:00.000Z" };

test("an empty page creates a finite native scroll surface with forward room", () => {
  const bounds = getNavigationBounds(emptyPage, 900, 600, 1);
  assert.deepEqual(bounds, { minX: 0, maxX: 900 + CONTENT_MARGIN, minY: 0, maxY: 600 + CONTENT_MARGIN });
  assert.deepEqual(getScrollSurfaceSize(bounds, 1), { width: 900 + CONTENT_MARGIN, height: 600 + CONTENT_MARGIN });
  assert.deepEqual(getInitialScrollPosition(bounds, 1), { left: 0, top: 0 });
});

test("navigation bounds expand around real content instead of empty space", () => {
  const page: NotePage = { ...emptyPage, textBlocks: [{ id: "text", x: 1200, y: 900, width: 320, text: "Content" }] };
  const bounds = getNavigationBounds(page, 900, 600, 1);
  assert.equal(bounds.maxX, 1520 + CONTENT_MARGIN);
  assert.equal(bounds.maxY, 992 + CONTENT_MARGIN);
});

test("zoom changes the native surface dimensions without changing canvas units", () => {
  const bounds = getNavigationBounds(emptyPage, 900, 600, 1);
  assert.deepEqual(getScrollSurfaceSize(bounds, 1.5), { width: (900 + CONTENT_MARGIN) * 1.5, height: (600 + CONTENT_MARGIN) * 1.5 });
});

test("navigation bounds include inserted tables and links", () => {
  const page: NotePage = {
    ...emptyPage,
    tableBlocks: [{ id: "table", x: 1000, y: 700, width: 480, rows: [["A", "B"], ["", ""]] }],
    linkBlocks: [{ id: "link", x: -300, y: -200, width: 280, url: "https://example.com", label: "example.com" }],
  };
  const bounds = getNavigationBounds(page, 900, 600, 1);
  assert.equal(bounds.minX, -300);
  assert.equal(bounds.minY, -200);
  assert.equal(bounds.maxX, 1480 + CONTENT_MARGIN);
  assert.equal(bounds.maxY, 796 + CONTENT_MARGIN);
});

test("text blocks reserve room for display equations", () => {
  const plainHeight = textBlockHeight({ id: "plain", x: 0, y: 0, width: 320, text: "Display:" });
  const equationHeight = textBlockHeight({ id: "equation", x: 0, y: 0, width: 320, text: "Display:\n$$x^2 + y^2 = z^2$$" });
  assert.ok(equationHeight > plainHeight);
});
