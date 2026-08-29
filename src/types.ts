export type Point = { x: number; y: number; pressure?: number };

export type Stroke = { id: string; color: string; colorRole?: "contrast"; width: number; opacity: number; points: Point[] };
export type TextBlock = { id: string; x: number; y: number; width: number; text: string };
export type ImageSource = { url: string; title: string; author?: string; license?: string; sourcePage?: string };
export type ImageBlock = { id: string; x: number; y: number; width: number; height: number; src: string; alt: string; source?: ImageSource };
export type TableBlock = { id: string; x: number; y: number; width: number; rows: string[][] };
export type LinkBlock = { id: string; x: number; y: number; width: number; url: string; label: string };
export type CanvasBounds = { minX: number; maxX: number; minY: number; maxY: number };

export type NotePage = {
  id: string;
  title: string;
  strokes: Stroke[];
  textBlocks: TextBlock[];
  imageBlocks?: ImageBlock[];
  tableBlocks?: TableBlock[];
  linkBlocks?: LinkBlock[];
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

export type ToolId = "select" | "text" | "pen" | "highlighter" | "eraser" | "pan";
export type PenPreset = { id: string; label: string; color: string; width: number; opacity: number; tool: "pen" | "highlighter"; shortcut: string };
export type PenSettings = Pick<PenPreset, "width" | "opacity" | "tool">;
