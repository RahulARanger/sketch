import type { NotePage, NoteSection, SketchDocument } from "./types";

export const WORKSPACE_MANIFEST = ".bosketchobs-index.json";

type StoredPage = Pick<NotePage, "id" | "title" | "updatedAt"> & { file: string };
type StoredSection = Omit<NoteSection, "pages"> & { folder: string; pages: StoredPage[] };

export type WorkspaceManifest = Omit<SketchDocument, "sections" | "version"> & { version: 3; sections: StoredSection[] };

function safeName(value: string, fallback: string) {
  const normalized = value.normalize("NFKD").replace(/[^a-zA-Z0-9 _.-]/g, "").trim().replace(/\s+/g, " ");
  return (normalized || fallback).slice(0, 70);
}

export function makeWorkspaceManifest(document: SketchDocument): WorkspaceManifest {
  return {
    ...document,
    version: 3,
    sections: document.sections.map((section) => ({
      ...section,
      folder: `${safeName(section.title, "Untitled section")}--${section.id}`,
      pages: section.pages.map((page) => ({
        id: page.id,
        title: page.title,
        updatedAt: page.updatedAt,
        file: `${safeName(page.title, "Untitled page")}--${page.id}.bosketchobs.json`,
      })),
    })),
  };
}

export async function saveWorkspace(
  document: SketchDocument,
  write: (path: string, contents: string) => Promise<void>,
  join: (...parts: string[]) => string,
) {
  const manifest = makeWorkspaceManifest(document);
  await Promise.all(document.sections.flatMap((section) => {
    const storedSection = manifest.sections.find((item) => item.id === section.id)!;
    return section.pages.map((page) => {
      const storedPage = storedSection.pages.find((item) => item.id === page.id)!;
      return write(join(storedSection.folder, storedPage.file), JSON.stringify(page, null, 2));
    });
  }));
  await write(WORKSPACE_MANIFEST, JSON.stringify(manifest, null, 2));
  return manifest;
}

export async function loadWorkspace(
  read: (path: string) => Promise<string>,
  join: (...parts: string[]) => string,
): Promise<SketchDocument> {
  const manifest = JSON.parse(await read(WORKSPACE_MANIFEST)) as WorkspaceManifest;
  if (manifest.version !== 3) throw new Error("This folder is not a BoSketchObs workspace.");
  const sections = await Promise.all(manifest.sections.map(async (section) => ({
    id: section.id,
    title: section.title,
    color: section.color,
    activePageId: section.activePageId,
    pages: await Promise.all(section.pages.map(async (page) => JSON.parse(await read(join(section.folder, page.file))) as NotePage)),
  })));
  return { ...manifest, version: 2, sections };
}
