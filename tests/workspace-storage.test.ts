import assert from "node:assert/strict";
import test from "node:test";
import { createBlankPage, normalizeDocument } from "../src/data.ts";
import { findSectionLocationConflict, loadLocalSectionsFromConfig, loadSection, makeAppWorkspaceConfig, makeDraftSnapshot, saveSection, SECTION_MANIFEST, type SectionSaveLocation } from "../src/workspaceStorage.ts";
import type { NoteSection, SketchDocument } from "../src/types.ts";

function fixtureSection(id: string, title: string): NoteSection {
  const pageId = `${id}-page`;
  return {
    id,
    title,
    color: "#45b875",
    activePageId: pageId,
    pages: [{ id: pageId, title: `${title} notes`, strokes: [], textBlocks: [], updatedAt: "2026-01-01T00:00:00.000Z" }],
  };
}

const document: SketchDocument = {
  version: 2,
  id: "notebook-1",
  title: "Notebook",
  sections: [fixtureSection("section-a", "Folder A"), fixtureSection("section-b", "Folder B")],
  activeSectionId: "section-a",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("section storage keeps each section independent and self-describing", async () => {
  const folders = new Map<string, Map<string, string>>();
  const writeFolder = (folder: string) => async (path: string, contents: string) => {
    const files = folders.get(folder) ?? new Map<string, string>();
    files.set(path, contents);
    folders.set(folder, files);
  };

  const locations: Record<string, SectionSaveLocation> = {
    "section-a": { kind: "local", folderPath: "/notebook/A" },
    "section-b": { kind: "local", folderPath: "/notebook/B" },
  };
  await saveSection(document, document.sections[0], writeFolder("A"), (...parts) => parts.join("/"), locations);
  await saveSection(document, document.sections[1], writeFolder("B"), (...parts) => parts.join("/"), locations);

  assert.ok(folders.get("A")?.has(SECTION_MANIFEST));
  assert.ok(folders.get("B")?.has(SECTION_MANIFEST));
  assert.notEqual(folders.get("A")?.get(SECTION_MANIFEST), folders.get("B")?.get(SECTION_MANIFEST));

  const loadedA = await loadSection(
    async (path) => folders.get("A")?.get(path) ?? (() => { throw new Error(`missing ${path}`); })(),
    (...parts) => parts.join("/"),
  );
  const loadedB = await loadSection(
    async (path) => folders.get("B")?.get(path) ?? (() => { throw new Error(`missing ${path}`); })(),
    (...parts) => parts.join("/"),
  );

  assert.equal(loadedA.manifest.notebookId, document.id);
  assert.deepEqual(loadedA.manifest.sectionLocations, locations);
  assert.equal(loadedA.section.id, "section-a");
  assert.equal(loadedB.section.id, "section-b");
  assert.equal(loadedA.section.pages[0].title, "Folder A notes");
  assert.equal(loadedB.section.pages[0].title, "Folder B notes");
});

test("page hierarchy supports one subpage level and flattens deeper pages", () => {
  const parent = createBlankPage("Parent");
  const child = createBlankPage("Child", parent.id);
  const grandchild = createBlankPage("Grandchild", child.id);
  const normalized = normalizeDocument({
    ...document,
    sections: [{ ...document.sections[0], pages: [parent, child, grandchild], activePageId: parent.id }],
    activeSectionId: document.sections[0].id,
  });
  const pages = normalized.sections[0].pages;

  assert.equal(pages.find((page) => page.id === child.id)?.parentId, parent.id);
  assert.equal(pages.find((page) => page.id === grandchild.id)?.parentId, undefined);
});

test("draft snapshots preserve the complete document for recovery", () => {
  const snapshot = makeDraftSnapshot(document);
  assert.equal(snapshot.version, 1);
  assert.deepEqual(snapshot.document, document);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot)).document, document);
});

test("app config restores pages from every configured local section folder", async () => {
  const folders = new Map<string, Map<string, string>>();
  const locations: Record<string, SectionSaveLocation> = {
    "section-a": { kind: "local", folderPath: "/notebook/A" },
    "section-b": { kind: "local", folderPath: "/notebook/B" },
  };
  const config = makeAppWorkspaceConfig(document, locations);
  const writeFolder = (folder: string) => async (path: string, contents: string) => {
    const files = folders.get(folder) ?? new Map<string, string>();
    files.set(path, contents);
    folders.set(folder, files);
  };
  await saveSection(document, document.sections[0], writeFolder("/notebook/A"), (...parts) => parts.join("/"), locations);
  await saveSection(document, document.sections[1], writeFolder("/notebook/B"), (...parts) => parts.join("/"), locations);

  const loaded = await loadLocalSectionsFromConfig(
    config,
    async (path) => folders.get(path.split("/").slice(0, 3).join("/"))?.get(path.split("/").slice(3).join("/")) ?? (() => { throw new Error(`missing ${path}`); })(),
    (...parts) => parts.join("/"),
  );
  assert.deepEqual(loaded.sections.map((section) => section.id), ["section-a", "section-b"]);
  assert.equal(loaded.sections[0].pages[0].title, "Folder A notes");
  assert.equal(loaded.sections[1].pages[0].title, "Folder B notes");
  assert.deepEqual(loaded.locations, locations);
});

test("section locations cannot be shared by different sections", () => {
  const conflict = findSectionLocationConflict(document.sections, {
    "section-a": { kind: "local", folderPath: "/Users/Rahul/Documents/masters" },
  }, { kind: "local", folderPath: "/Users/rahul/Documents/masters/" }, "section-b");
  assert.equal(conflict?.id, "section-a");
});
