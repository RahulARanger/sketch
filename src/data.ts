import type { LegacyNotebookDocument, NotePage, NoteSection, PenPreset, SketchDocument } from "./types.ts";

export const PEN_PRESETS: PenPreset[] = [
  { id: "contrast", label: "Contrast pen", color: "#1c2228", width: 3.2, opacity: 1, tool: "pen", shortcut: "1" },
  { id: "blue", label: "Blue pen", color: "#2f7df4", width: 3.2, opacity: 1, tool: "pen", shortcut: "2" },
  { id: "red", label: "Red pen", color: "#ef4e4e", width: 3.2, opacity: 1, tool: "pen", shortcut: "3" },
  { id: "green", label: "Green pen", color: "#35ad66", width: 3.2, opacity: 1, tool: "pen", shortcut: "4" },
  { id: "purple", label: "Purple pen", color: "#9a5de0", width: 3.2, opacity: 1, tool: "pen", shortcut: "5" },
  { id: "yellow", label: "Yellow highlighter", color: "#f6c945", width: 18, opacity: 0.42, tool: "highlighter", shortcut: "6" },
];

const now = new Date().toISOString();

export function createBlankPage(title = "Untitled page"): NotePage {
  return { id: crypto.randomUUID(), title, strokes: [], textBlocks: [], imageBlocks: [], tableBlocks: [], linkBlocks: [], updatedAt: new Date().toISOString() };
}

export function createSection(title = "Untitled section", color = "#5a8ff0"): NoteSection {
  const page = createBlankPage();
  return { id: crypto.randomUUID(), title, color, pages: [page], activePageId: page.id };
}

const quantumPages: NotePage[] = [
  { id: "page-intro", title: "Introduction", strokes: [], textBlocks: [], updatedAt: now },
  {
    id: "page-qubits",
    title: "Week 2 — Qubits",
    strokes: [],
    textBlocks: [
      { id: "welcome-block", x: 110, y: 90, width: 420, text: "Qubit state\n\n|ψ⟩ = α|0⟩ + β|1⟩\n\n|α|² + |β|² = 1" },
      { id: "tip-block", x: 610, y: 160, width: 340, text: "Superposition\n\nA qubit can be in a linear combination of |0⟩ and |1⟩ simultaneously." },
    ],
    updatedAt: now,
  },
  { id: "page-gates", title: "Gates", strokes: [], textBlocks: [], updatedAt: now },
  { id: "page-measurement", title: "Measurement", strokes: [], textBlocks: [], updatedAt: now },
];

export const STARTER_DOCUMENT: SketchDocument = {
  version: 2,
  id: crypto.randomUUID(),
  title: "BoSketchObs",
  activeSectionId: "section-quantum",
  createdAt: now,
  updatedAt: now,
  sections: [
    { id: "section-quantum", title: "Quantum Information", color: "#45b875", pages: quantumPages, activePageId: "page-qubits" },
    { id: "section-thesis", title: "Thesis Ideas", color: "#e95b9a", pages: [createBlankPage("Research questions"), createBlankPage("Outline")], activePageId: "" },
    { id: "section-ml", title: "Machine Learning", color: "#ef8b3f", pages: [createBlankPage("Reading list"), createBlankPage("Experiments")], activePageId: "" },
  ],
};

function normalizeDocument(document: SketchDocument): SketchDocument {
  const sections = document.sections.length ? document.sections : [createSection()];
  for (const section of sections) {
    if (!section.pages.length) section.pages = [createBlankPage()];
    if (!section.pages.some((page) => page.id === section.activePageId)) section.activePageId = section.pages[0].id;
    for (const page of section.pages) {
      page.imageBlocks = Array.isArray(page.imageBlocks) ? page.imageBlocks : [];
      page.tableBlocks = Array.isArray(page.tableBlocks) ? page.tableBlocks : [];
      page.linkBlocks = Array.isArray(page.linkBlocks) ? page.linkBlocks : [];
    }
  }
  return { ...document, version: 2, sections, activeSectionId: sections.some((section) => section.id === document.activeSectionId) ? document.activeSectionId : sections[0].id };
}

export function migrateDocument(document: SketchDocument | LegacyNotebookDocument): SketchDocument {
  if (document.version === 2) return normalizeDocument(document);
  const section: NoteSection = {
    id: crypto.randomUUID(),
    title: document.title,
    color: "#45b875",
    pages: document.pages.length ? document.pages : [createBlankPage()],
    activePageId: document.pages.some((page) => page.id === document.activePageId) ? document.activePageId : document.pages[0]?.id ?? "",
  };
  return normalizeDocument({ version: 2, id: document.id, title: "BoSketchObs", sections: [section], activeSectionId: section.id, createdAt: document.createdAt, updatedAt: document.updatedAt });
}

for (const section of STARTER_DOCUMENT.sections) if (!section.activePageId) section.activePageId = section.pages[0].id;
