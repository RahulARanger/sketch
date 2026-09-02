import type { TLStoreSnapshot } from "tldraw";

export type Point = { x: number; y: number; pressure?: number };

export type Stroke = { id: string; color: string; colorRole?: "contrast"; width: number; opacity: number; points: Point[] };
export type TextBlock = { id: string; x: number; y: number; width: number; height?: number; text: string };
export type ImageSource = { url: string; title: string; author?: string; license?: string; sourcePage?: string };
export type ImageBlock = { id: string; x: number; y: number; width: number; height: number; src: string; alt: string; source?: ImageSource };
export type TableBlock = { id: string; x: number; y: number; width: number; rows: string[][] };
export type LinkBlock = { id: string; x: number; y: number; width: number; url: string; label: string };
export type CanvasBounds = { minX: number; maxX: number; minY: number; maxY: number };

export type NotePage = {
  id: string;
  title: string;
  /** The id of a top-level page when this is a single-level subpage. */
  parentId?: string;
  strokes: Stroke[];
  textBlocks: TextBlock[];
  imageBlocks?: ImageBlock[];
  tableBlocks?: TableBlock[];
  linkBlocks?: LinkBlock[];
  /** Native tldraw document state. Legacy block arrays remain for imports/agent compatibility. */
  tldrawSnapshot?: TLStoreSnapshot;
  canvasBounds?: CanvasBounds;
  updatedAt: string;
};

export type NoteSection = { id: string; title: string; color: string; pages: NotePage[]; activePageId: string };

export type SketchDocument = {
  version: 2;
  id: string;
  title: string;
  sections: NoteSection[];
  activeSectionId: string;
  createdAt: string;
  updatedAt: string;
};

export type LegacyNotebookDocument = {
  version: 1;
  id: string;
  title: string;
  pages: NotePage[];
  activePageId: string;
  createdAt: string;
  updatedAt: string;
};

export type ToolId = "select" | "lasso" | "text" | "pen" | "highlighter" | "eraser" | "pan";
export type PenPreset = { id: string; label: string; color: string; width: number; opacity: number; tool: "pen" | "highlighter"; shortcut: string };
export type PenSettings = Pick<PenPreset, "width" | "opacity" | "tool">;
