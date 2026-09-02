import type { AgentContextRef } from "./types.ts";
import type { NotePage, SketchDocument } from "../types.ts";

function pageSummary(page: NotePage) {
  return {
    id: page.id,
    title: page.title,
    textBlocks: page.textBlocks,
    imageBlocks: (page.imageBlocks ?? []).map(({ src: _src, ...metadata }) => metadata),
    tableBlocks: page.tableBlocks ?? [],
    linkBlocks: page.linkBlocks ?? [],
    drawing: {
      strokeCount: page.strokes.length,
      pointCount: page.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0),
    },
  };
}

export function collectContextPages(document: SketchDocument, contextRefs: AgentContextRef[], includeEntireBoard: boolean) {
  const wanted = new Set(contextRefs.map((ref) => `${ref.sectionId}/${ref.pageId}`));
  return document.sections.flatMap((section) => section.pages.flatMap((page) => {
    if (!includeEntireBoard && !wanted.has(`${section.id}/${page.id}`)) return [];
    return [{ sectionId: section.id, sectionTitle: section.title, ...pageSummary(page) }];
  }));
}

export function buildBoardContext(document: SketchDocument, activeSectionId: string, activePageId: string, contextRefs: AgentContextRef[] = [], includeEntireBoard = false) {
  const activeSection = document.sections.find((section) => section.id === activeSectionId);
  const activePage = activeSection?.pages.find((page) => page.id === activePageId);
  const referencedPages = collectContextPages(document, contextRefs, includeEntireBoard);
  const activeKey = activeSection && activePage ? `${activeSection.id}/${activePage.id}` : "";
  if (activeSection && activePage && !referencedPages.some((page) => `${page.sectionId}/${page.id}` === activeKey)) {
    referencedPages.unshift({ sectionId: activeSection.id, sectionTitle: activeSection.title, ...pageSummary(activePage) });
  }
  return {
    documentTitle: document.title,
    activeSection: activeSection?.title,
    activePage: activePage ? { id: activePage.id, title: activePage.title } : undefined,
    contextMode: includeEntireBoard ? "entire-board" : contextRefs.length ? "selected-pages" : "active-page",
    referencedPages,
  };
}

export function serializeBoardContext(document: SketchDocument, activeSectionId: string, activePageId: string, contextRefs: AgentContextRef[] = [], includeEntireBoard = false) {
  return JSON.stringify(buildBoardContext(document, activeSectionId, activePageId, contextRefs, includeEntireBoard), null, 2);
}
