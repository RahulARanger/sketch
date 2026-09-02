import type { NotePage, NoteSection, SketchDocument } from "./types";

export const WORKSPACE_MANIFEST = ".bosketchobs-index.json";
export const SECTION_MANIFEST = ".bosketchobs-section.json";
export const DRAFT_FILE = "bosketchobs-draft.json";
export const APP_CONFIG_FILE = "bosketchobs-config.json";

type StoredPage = Pick<NotePage, "id" | "title" | "parentId" | "updatedAt"> & { file: string };
type StoredSection = Omit<NoteSection, "pages"> & { folder: string; pages: StoredPage[] };

export type SectionSaveLocation =
  | { kind: "local"; folderPath: string }
  | { kind: "drive"; folderId: string; folderName: string; fileIds?: Record<string, string> };

export type SectionManifest = {
  version: 1;
  notebookId: string;
  notebookTitle: string;
  section: Omit<NoteSection, "pages">;
  pages: StoredPage[];
  sectionLocations: Record<string, SectionSaveLocation>;
};

export type WorkspaceManifest = Omit<SketchDocument, "sections" | "version"> & { version: 3; sections: StoredSection[] };

type ConfiguredSection = Omit<NoteSection, "pages"> & { location?: SectionSaveLocation };

export type AppWorkspaceConfig = {
  version: 1;
  document: Omit<SketchDocument, "sections"> & { sections?: never };
  sections: ConfiguredSection[];
};

export type DraftSnapshot = { version: 1; document: SketchDocument };

export function makeDraftSnapshot(document: SketchDocument): DraftSnapshot {
  return { version: 1, document };
}

export function makeAppWorkspaceConfig(document: SketchDocument, sectionLocations: Record<string, SectionSaveLocation>): AppWorkspaceConfig {
  return {
    version: 1,
    document: {
      version: document.version,
      id: document.id,
      title: document.title,
      activeSectionId: document.activeSectionId,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    },
    sections: document.sections.map(({ pages: _pages, ...section }) => ({
      ...section,
      ...(sectionLocations[section.id] ? { location: sectionLocations[section.id] } : {}),
    })),
  };
}

export function parseAppWorkspaceConfig(contents: string): AppWorkspaceConfig {
  const config = JSON.parse(contents) as Partial<AppWorkspaceConfig>;
  if (config.version !== 1 || !config.document || !Array.isArray(config.sections)) {
    throw new Error("This BoSketchObs config is not supported.");
  }
  return config as AppWorkspaceConfig;
}

export function sectionLocationKey(location: SectionSaveLocation): string {
  if (location.kind === "drive") return `drive:${location.folderId}`;
  return `local:${location.folderPath.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLocaleLowerCase()}`;
}

export function findSectionLocationConflict(
  sections: NoteSection[],
  locations: Record<string, SectionSaveLocation>,
  candidate: SectionSaveLocation,
  ignoredSectionId?: string,
): NoteSection | undefined {
  const candidateKey = sectionLocationKey(candidate);
  return sections.find((section) => section.id !== ignoredSectionId && locations[section.id] && sectionLocationKey(locations[section.id]) === candidateKey);
}

export async function loadLocalSectionsFromConfig(
  config: AppWorkspaceConfig,
  read: (path: string) => Promise<string>,
  join: (...parts: string[]) => string,
): Promise<{ sections: NoteSection[]; locations: Record<string, SectionSaveLocation> }> {
  const locations = Object.fromEntries(config.sections.flatMap((section): Array<[string, SectionSaveLocation]> => section.location ? [[section.id, section.location]] : []));
  const localSections = config.sections.filter((section): section is ConfiguredSection & { location: Extract<SectionSaveLocation, { kind: "local" }> } => section.location?.kind === "local");
  const sections = await Promise.all(localSections.map(async (configured) => {
    const location = configured.location;
    const loaded = await loadSection(
      (relativePath) => read(join(location.folderPath, relativePath)),
      (...parts) => parts.join("/"),
    );
    return loaded.section;
  }));
  return { sections, locations };
}

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
        ...(page.parentId ? { parentId: page.parentId } : {}),
        updatedAt: page.updatedAt,
        file: `${safeName(page.title, "Untitled page")}--${page.id}.bosketchobs.json`,
      })),
    })),
  };
}

export function makeSectionManifest(document: SketchDocument, section: NoteSection, sectionLocations: Record<string, SectionSaveLocation> = {}): SectionManifest {
  return {
    version: 1,
    notebookId: document.id,
    notebookTitle: document.title,
    section: {
      id: section.id,
      title: section.title,
      color: section.color,
      activePageId: section.activePageId,
    },
    pages: section.pages.map((page) => ({
      id: page.id,
      title: page.title,
      ...(page.parentId ? { parentId: page.parentId } : {}),
      updatedAt: page.updatedAt,
      file: `${safeName(page.title, "Untitled page")}--${page.id}.bosketchobs.json`,
    })),
    sectionLocations,
  };
}

export async function saveSection(
  document: SketchDocument,
  section: NoteSection,
  write: (path: string, contents: string) => Promise<void>,
  join: (...parts: string[]) => string,
  sectionLocations: Record<string, SectionSaveLocation> = {},
) {
  const manifest = makeSectionManifest(document, section, sectionLocations);
  await Promise.all(section.pages.map((page, index) => write(join(manifest.pages[index].file), JSON.stringify(page, null, 2))));
  await write(SECTION_MANIFEST, JSON.stringify(manifest, null, 2));
  return manifest;
}

export async function loadSection(
  read: (path: string) => Promise<string>,
  join: (...parts: string[]) => string,
): Promise<{ manifest: SectionManifest; section: NoteSection }> {
  const manifest = JSON.parse(await read(SECTION_MANIFEST)) as SectionManifest;
  if (manifest.version !== 1 || !manifest.section?.id || !Array.isArray(manifest.pages)) {
    throw new Error("This folder is not a BoSketchObs section.");
  }
  const pages = await Promise.all(manifest.pages.map(async (page) => JSON.parse(await read(join(page.file))) as NotePage));
  return { manifest, section: { ...manifest.section, pages } };
}

export async function saveWorkspace(
  document: SketchDocument,
  write: (path: string, contents: string) => Promise<void>,
  join: (...parts: string[]) => string,
) {
  const manifest = makeWorkspaceManifest(document);
  await Promise.all(document.sections.flatMap((section) => {
    const storedSection = manifest.sections.find((item) => item.id === section.id)!;
    return [
      ...section.pages.map((page) => {
        const storedPage = storedSection.pages.find((item) => item.id === page.id)!;
        return write(join(storedSection.folder, storedPage.file), JSON.stringify(page, null, 2));
      }),
      write(join(storedSection.folder, SECTION_MANIFEST), JSON.stringify(makeSectionManifest(document, section), null, 2)),
    ];
  }));
  await write(WORKSPACE_MANIFEST, JSON.stringify(manifest, null, 2));
  return manifest;
}

export async function loadWorkspace(
  read: (path: string) => Promise<string>,
  join: (...parts: string[]) => string,
): Promise<SketchDocument> {
  return (await loadWorkspaceWithManifest(read, join)).document;
}

export async function loadWorkspaceWithManifest(
  read: (path: string) => Promise<string>,
  join: (...parts: string[]) => string,
): Promise<{ document: SketchDocument; manifest: WorkspaceManifest }> {
  const manifest = JSON.parse(await read(WORKSPACE_MANIFEST)) as WorkspaceManifest;
  if (manifest.version !== 3) throw new Error("This folder is not a BoSketchObs workspace.");
  const sections = await Promise.all(manifest.sections.map(async (section) => ({
    id: section.id,
    title: section.title,
    color: section.color,
    activePageId: section.activePageId,
    pages: await Promise.all(section.pages.map(async (page) => JSON.parse(await read(join(section.folder, page.file))) as NotePage)),
  })));
  return { document: { ...manifest, version: 2, sections }, manifest };
}
