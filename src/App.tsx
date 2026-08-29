import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { AlertCircle, Bot, CheckCircle2, ChevronDown, Download, FolderOpen, Maximize2, Minus, Save as SaveIcon, Settings2, X } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { CanvasBoard } from "./components/CanvasBoard";
import { AssistantPanel } from "./components/AssistantPanel";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { PageList } from "./components/PageList";
import { SectionList } from "./components/SectionList";
import { SettingsPanel, type FontStyle, type InterfaceSize, type SheetBackground } from "./components/SettingsPanel";
import { SaveLocationDialog, type SaveLocation } from "./components/SaveLocationDialog";
import { Toolbar } from "./components/Toolbar";
import { createBlankPage, createSection, migrateDocument, PEN_PRESETS, STARTER_DOCUMENT } from "./data";
import { getToolShortcut, isEditingText, shouldSkipShortcut } from "./keyboardShortcuts";
import { createDriveFolder, downloadDriveText, listDriveEntries, uploadDriveDocument } from "./googleDrive";
import type { LegacyNotebookDocument, NotePage, NoteSection, PenSettings, SketchDocument, ToolId } from "./types";
import { loadWorkspace, makeWorkspaceManifest, saveWorkspace, WORKSPACE_MANIFEST, type WorkspaceManifest } from "./workspaceStorage";
import { BoardAgent } from "./agent/boardAgent";
import { listOllamaModels, testOllama } from "./agent/ollama";
import type { AgentMessage, AgentPendingAction, AgentSettings, AgentStatus } from "./agent/types";
import "./styles.css";

const STORAGE_KEY = "bosketchobs-session-v2";
const LEGACY_STORAGE_KEY = "marginalia-session-v1";
const THEME_KEY = "bosketchobs-theme-v1";
const ACCENT_KEY = "bosketchobs-accent-v1";
const FONT_KEY = "bosketchobs-font-v1";
const INTERFACE_SIZE_KEY = "bosketchobs-interface-size-v1";
const SHEET_BACKGROUND_KEY = "bosketchobs-sheet-background-v1";
const WINDOW_TRANSPARENCY_KEY = "bosketchobs-window-transparency-v4";
const PEN_COLORS_KEY = "bosketchobs-pen-colors-v1";
const PEN_SETTINGS_KEY = "bosketchobs-pen-settings-v1";
const AGENT_SETTINGS_KEY = "bosketchobs-agent-settings-v1";
const SECTION_COLORS = ["#45b875", "#e95b9a", "#ef8b3f", "#4d8fe8", "#9a70df", "#34a9b8"];

type DeleteTarget = { kind: "page" | "section"; id: string; title: string };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function loadDocument(): SketchDocument {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    return stored ? migrateDocument(JSON.parse(stored) as SketchDocument | LegacyNotebookDocument) : clone(STARTER_DOCUMENT);
  } catch {
    return clone(STARTER_DOCUMENT);
  }
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

function loadPenColors(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PEN_COLORS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([id, color]) => PEN_PRESETS.some((preset) => preset.id === id) && isHexColor(color)),
    );
  } catch {
    return {};
  }
}

function loadPenSettings(): Record<string, Partial<PenSettings>> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PEN_SETTINGS_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([id, value]) => {
        if (!PEN_PRESETS.some((preset) => preset.id === id) || !value || typeof value !== "object" || Array.isArray(value)) return [];
        const settings = value as Partial<PenSettings>;
        const width = typeof settings.width === "number" && Number.isFinite(settings.width) ? Math.min(40, Math.max(1, settings.width)) : undefined;
        const opacity = typeof settings.opacity === "number" && Number.isFinite(settings.opacity) ? Math.min(1, Math.max(0.1, settings.opacity)) : undefined;
        const tool = settings.tool === "pen" || settings.tool === "highlighter" ? settings.tool : undefined;
        if (width === undefined && opacity === undefined && tool === undefined) return [];
        return [[id, { width, opacity, tool } as PenSettings]];
      }),
    );
  } catch {
    return {};
  }
}

function loadAgentSettings(): AgentSettings {
  const defaults: AgentSettings = { enabled: false, endpoint: "http://localhost:11434", model: "", visionModel: "", maxSteps: 6, autoApplySafe: true, allowOnlineImages: false, includePageImage: true };
  try {
    const parsed = JSON.parse(localStorage.getItem(AGENT_SETTINGS_KEY) ?? "null") as Partial<AgentSettings> | null;
    if (!parsed || typeof parsed !== "object") return defaults;
    return { ...defaults, ...parsed, maxSteps: Math.min(12, Math.max(1, Number(parsed.maxSteps) || defaults.maxSteps)) };
  } catch { return defaults; }
}

export default function App() {
  const [sketchDoc, setSketchDoc] = useState<SketchDocument>(loadDocument);
  const [tool, setTool] = useState<ToolId>("pen");
  const [hardwareEraserActive, setHardwareEraserActive] = useState(false);
  const [presetId, setPresetId] = useState("contrast");
  const [saveLocation, setSaveLocation] = useState<SaveLocation | null>(null);
  const [saveLocationOpen, setSaveLocationOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved">("unsaved");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") return stored;
    return "dark";
  });
  const [history, setHistory] = useState<SketchDocument[]>([]);
  const [future, setFuture] = useState<SketchDocument[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [sectionsOpen, setSectionsOpen] = useState(true);
  const [pagesOpen, setPagesOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [agentSettings, setAgentSettings] = useState<AgentSettings>(loadAgentSettings);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaConnection, setOllamaConnection] = useState<"idle" | "testing" | "connected" | "error">("idle");
  const [ollamaError, setOllamaError] = useState("");
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [agentPendingAction, setAgentPendingAction] = useState<AgentPendingAction | undefined>();
  const [accent, setAccent] = useState(() => {
    const stored = localStorage.getItem(ACCENT_KEY);
    return isHexColor(stored) ? stored : "#3478f6";
  });
  const [penColors, setPenColors] = useState<Record<string, string>>(loadPenColors);
  const [penSettings, setPenSettings] = useState<Record<string, Partial<PenSettings>>>(loadPenSettings);
  const [fontStyle, setFontStyle] = useState<FontStyle>(() => {
    const stored = localStorage.getItem(FONT_KEY);
    return stored === "rounded" || stored === "serif" || stored === "mono" ? stored : "system";
  });
  const [interfaceSize, setInterfaceSize] = useState<InterfaceSize>(() => localStorage.getItem(INTERFACE_SIZE_KEY) === "comfortable" ? "comfortable" : "compact");
  const [sheetBackground, setSheetBackground] = useState<SheetBackground>(() => {
    const stored = localStorage.getItem(SHEET_BACKGROUND_KEY);
    return stored === "plain" || stored === "ruled" || stored === "dotted" ? stored : "plain";
  });
  const [windowTransparency, setWindowTransparency] = useState(() => {
    const stored = Number(localStorage.getItem(WINDOW_TRANSPARENCY_KEY));
    return Number.isFinite(stored) ? Math.min(20, Math.max(0, stored)) : 0;
  });
  const saveTimer = useRef<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const documentRef = useRef(sketchDoc);
  documentRef.current = sketchDoc;
  const agentRef = useRef(new BoardAgent());

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void invoke<void>("auto_update").catch((error) => console.error("Automatic update check failed", error));
  }, []);

  const activeSection = useMemo(
    () => sketchDoc.sections.find((section) => section.id === sketchDoc.activeSectionId) ?? sketchDoc.sections[0],
    [sketchDoc],
  );
  const activePage = useMemo(
    () => activeSection.pages.find((page) => page.id === activeSection.activePageId) ?? activeSection.pages[0],
    [activeSection],
  );
  const preset = useMemo(() => {
    const base = PEN_PRESETS.find((item) => item.id === presetId) ?? PEN_PRESETS[0];
    const settings = penSettings[base.id];
    return {
      ...base,
      color: penColors[base.id] ?? (base.id === "contrast" ? (theme === "dark" ? "#f4f6f8" : "#1c2228") : base.color),
      width: settings?.width ?? base.width,
      opacity: settings?.opacity ?? base.opacity,
      tool: settings?.tool ?? base.tool,
    };
  }, [penColors, penSettings, presetId, theme]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    const dark = theme === "dark";
    const root = document.documentElement;
    const tokens: Record<string, string> = {
      "--background": dark ? "#151a1f" : "#f7fbff",
      "--foreground": dark ? "#f1f4f6" : "#152536",
      "--card": dark ? "#181e23" : "#ffffff",
      "--card-foreground": dark ? "#f1f4f6" : "#152536",
      "--popover": dark ? "#1b2228" : "#ffffff",
      "--popover-foreground": dark ? "#f1f4f6" : "#152536",
      "--primary": accent,
      "--primary-foreground": "#ffffff",
      "--secondary": dark ? "#222a31" : "#edf1f5",
      "--secondary-foreground": dark ? "#f1f4f6" : "#152536",
      "--muted": dark ? "#20272d" : "#eef1f4",
      "--muted-foreground": dark ? "#adb6bd" : "#60758c",
      "--border": dark ? "#2d353c" : "#d8dee4",
      "--input": dark ? "#3a444c" : "#c7cfd7",
      "--ring": accent,
    };
    Object.entries(tokens).forEach(([name, value]) => root.style.setProperty(name, value));
  }, [accent, theme]);

  useEffect(() => { localStorage.setItem(ACCENT_KEY, accent); }, [accent]);
  useEffect(() => { localStorage.setItem(PEN_COLORS_KEY, JSON.stringify(penColors)); }, [penColors]);
  useEffect(() => { localStorage.setItem(PEN_SETTINGS_KEY, JSON.stringify(penSettings)); }, [penSettings]);
  useEffect(() => { localStorage.setItem(FONT_KEY, fontStyle); }, [fontStyle]);
  useEffect(() => { localStorage.setItem(INTERFACE_SIZE_KEY, interfaceSize); }, [interfaceSize]);
  useEffect(() => { localStorage.setItem(SHEET_BACKGROUND_KEY, sheetBackground); }, [sheetBackground]);
  useEffect(() => { localStorage.setItem(WINDOW_TRANSPARENCY_KEY, String(windowTransparency)); }, [windowTransparency]);
  useEffect(() => { localStorage.setItem(AGENT_SETTINGS_KEY, JSON.stringify(agentSettings)); }, [agentSettings]);
  const commit = useCallback((next: SketchDocument, recordHistory = true) => {
    if (recordHistory) setHistory((items) => [...items.slice(-49), clone(documentRef.current)]);
    setFuture([]);
    setSketchDoc(next);
    setSaveState("unsaved");
  }, []);

  const updateActiveSection = useCallback((updater: (section: NoteSection) => NoteSection, recordHistory = true) => {
    const current = documentRef.current;
    const next = {
      ...current,
      sections: current.sections.map((section) => section.id === current.activeSectionId ? updater(section) : section),
      updatedAt: new Date().toISOString(),
    };
    commit(next, recordHistory);
  }, [commit]);

  const updatePage = useCallback((nextPage: NotePage) => {
    updateActiveSection((section) => ({ ...section, pages: section.pages.map((page) => page.id === nextPage.id ? nextPage : page) }));
  }, [updateActiveSection]);

  const updateAgentSettings = useCallback((next: Partial<AgentSettings>) => {
    setAgentSettings((current) => ({ ...current, ...next }));
  }, []);

  const refreshOllamaModels = useCallback(async () => {
    try {
      const models = await listOllamaModels(agentSettings.endpoint);
      const names = models.map((model) => model.name || model.model).filter(Boolean);
      setOllamaModels(names);
      setOllamaConnection("connected");
      setOllamaError("");
      if (!agentSettings.model && names[0]) updateAgentSettings({ model: names[0] });
      if (!agentSettings.visionModel && names[0]) updateAgentSettings({ visionModel: names[0] });
    } catch (error) {
      console.error(error);
      setOllamaConnection("error");
      setOllamaError(error instanceof Error ? error.message : String(error));
    }
  }, [agentSettings.endpoint, agentSettings.model, agentSettings.visionModel, updateAgentSettings]);

  const checkOllama = useCallback(async () => {
    setOllamaConnection("testing");
    try {
      await testOllama(agentSettings.endpoint);
      setOllamaConnection("connected");
      setOllamaError("");
      await refreshOllamaModels();
    } catch (error) {
      console.error(error);
      setOllamaConnection("error");
      setOllamaError(error instanceof Error ? error.message : String(error));
    }
  }, [agentSettings.endpoint, refreshOllamaModels]);

  const applyAgentResult = useCallback((result: Awaited<ReturnType<BoardAgent["run"]>>) => {
    if (result.status === "completed" && agentRef.current.isStaleAgainst(documentRef.current)) {
      setAgentMessages([...result.messages, { role: "assistant", content: "I did not apply the result because the board changed while I was working. Please run the request again." }]);
      setAgentStatus("failed");
      setAgentPendingAction(undefined);
      return;
    }
    setAgentMessages(result.messages);
    setAgentStatus(result.status);
    setAgentPendingAction(result.pendingAction);
    if (result.status === "completed" && JSON.stringify(documentRef.current) !== JSON.stringify(result.document)) commit(result.document);
  }, [commit]);

  const runAgent = useCallback(async (prompt: string) => {
    if (!agentSettings.enabled) {
      setAgentMessages([{ role: "user", content: prompt }, { role: "assistant", content: "Enable the board agent in Settings first." }]);
      setAgentStatus("failed");
      return;
    }
    if (!agentSettings.model) {
      setAgentMessages([{ role: "user", content: prompt }, { role: "assistant", content: "Choose an Ollama agent model in Settings first." }]);
      setAgentStatus("failed");
      return;
    }
    setAgentPendingAction(undefined);
    setAgentStatus("running");
    const result = await agentRef.current.run(prompt, documentRef.current, activeSection.id, activePage.id, agentSettings, (messages) => setAgentMessages(messages));
    applyAgentResult(result);
  }, [activePage.id, activeSection.id, agentSettings, applyAgentResult]);

  const resumeAgent = useCallback(async (approved: boolean) => {
    setAgentPendingAction(undefined);
    setAgentStatus("running");
    const result = await agentRef.current.resume(approved);
    if (result) applyAgentResult(result);
  }, [applyAgentResult]);

  const writeDocument = useCallback(async (location: SaveLocation, contents: SketchDocument) => {
    setSaveState("saving");
    if (location.kind === "local") {
      await saveWorkspace(
        contents,
        (relativePath, savedContents) => invoke("save_note", { path: `${location.folderPath}/${relativePath}`, contents: savedContents }),
        (...parts) => parts.join("/"),
      );
    } else {
      const manifest = makeWorkspaceManifest(contents);
      const nextFileIds = { ...location.fileIds };
      const nextSectionFolders = { ...location.sectionFolders };
      await Promise.all(contents.sections.map(async (section) => {
        const storedSection = manifest.sections.find((item) => item.id === section.id)!;
        const sectionFolderId = nextSectionFolders[section.id] ?? createDriveFolder(location.folderId, storedSection.folder).then((folder) => folder.id);
        nextSectionFolders[section.id] = await sectionFolderId;
        await Promise.all(section.pages.map(async (page) => {
          const storedPage = storedSection.pages.find((item) => item.id === page.id)!;
          const key = `${section.id}/${page.id}`;
          const uploaded = await uploadDriveDocument(JSON.stringify(page, null, 2), storedPage.file, nextSectionFolders[section.id], nextFileIds[key]);
          nextFileIds[key] = uploaded.id;
        }));
      }));
      const manifestUpload = await uploadDriveDocument(JSON.stringify(manifest, null, 2), WORKSPACE_MANIFEST, location.folderId, nextFileIds.__manifest__);
      nextFileIds.__manifest__ = manifestUpload.id;
      setSaveLocation({ ...location, fileIds: nextFileIds, sectionFolders: nextSectionFolders });
    }
    setSaveState("saved");
    setNotice({ tone: "success", message: location.kind === "drive" ? "Workspace synced to Google Drive." : "Workspace saved on this computer." });
  }, []);

  const saveDocument = useCallback(async () => {
    try {
      const target = saveLocation;
      if (!target) {
        setSaveLocationOpen(true);
        return;
      }
      await writeDocument(target, documentRef.current);
    } catch (error) {
      console.error(error);
      setSaveState("unsaved");
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "The workspace could not be saved." });
    }
  }, [saveLocation, writeDocument]);

  const pickLocalLocation = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false, title: "Choose a folder for this notebook" });
    return typeof selected === "string" ? selected : null;
  }, []);

  const chooseSaveLocation = useCallback(async (location: SaveLocation) => {
    setSaveLocation(location);
    setSaveLocationOpen(false);
    
    await writeDocument(location, documentRef.current);
  }, [writeDocument]);

  const openDocument = useCallback(async () => {
    try {
      const source = await open({ directory: true, multiple: false, title: "Open a BoSketchObs workspace folder" });
      if (!source || Array.isArray(source)) return;
      const parsed = migrateDocument(await loadWorkspace(
        (relativePath) => invoke<string>("read_note", { path: `${source}/${relativePath}` }),
        (...parts) => parts.join("/"),
      ));
      setSketchDoc(parsed);
      setHistory([]);
      setFuture([]);
      setSaveLocation({ kind: "local", folderPath: source });
      setSaveState("saved");
      setNotice({ tone: "success", message: "Local workspace opened." });
    } catch (error) {
      console.error(error);
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "The local workspace could not be opened." });
    }
  }, []);

  const openDriveWorkspace = useCallback(async (folderId: string, folderName: string) => {
    try {
      const rootEntries = await listDriveEntries(folderId);
      const manifestFile = rootEntries.find((entry) => entry.name === WORKSPACE_MANIFEST);
      if (!manifestFile) throw new Error("This Google Drive folder does not contain a BoSketchObs workspace.");
      const manifest = JSON.parse(await downloadDriveText(manifestFile.id)) as WorkspaceManifest;
      if (manifest.version !== 3) throw new Error("This Google Drive workspace uses an unsupported format.");
      const fileIds: Record<string, string> = { __manifest__: manifestFile.id };
      const sectionFolders: Record<string, string> = {};
      const sections = await Promise.all(manifest.sections.map(async (section) => {
        const folder = rootEntries.find((entry) => entry.name === section.folder && entry.mimeType === "application/vnd.google-apps.folder");
        if (!folder) throw new Error(`The section folder “${section.title}” is missing from Google Drive.`);
        sectionFolders[section.id] = folder.id;
        const entries = await listDriveEntries(folder.id);
        const pages = await Promise.all(section.pages.map(async (page) => {
          const file = entries.find((entry) => entry.name === page.file);
          if (!file) throw new Error(`The page “${page.title}” is missing from Google Drive.`);
          fileIds[`${section.id}/${page.id}`] = file.id;
          return JSON.parse(await downloadDriveText(file.id)) as NotePage;
        }));
        return { id: section.id, title: section.title, color: section.color, activePageId: section.activePageId, pages };
      }));
      const parsed = migrateDocument({ ...manifest, version: 2, sections });
      setSketchDoc(parsed);
      setHistory([]);
      setFuture([]);
      setSaveLocation({ kind: "drive", folderId, folderName, fileIds, sectionFolders });
      setSaveState("saved");
      setSaveLocationOpen(false);
      setNotice({ tone: "success", message: `Opened “${folderName}” from Google Drive.` });
    } catch (error) {
      console.error(error);
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "The Google Drive workspace could not be opened." });
    }
  }, []);

  const insertImageFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) { setNotice({ tone: "error", message: "Choose a PNG, JPEG, GIF, WebP, or SVG image." }); return; }
    if (file.size > 12 * 1024 * 1024) { setNotice({ tone: "error", message: "Images must be smaller than 12 MB." }); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      updateActiveSection((section) => ({ ...section, pages: section.pages.map((page) => page.id === section.activePageId ? { ...page, imageBlocks: [...(page.imageBlocks ?? []), { id: crypto.randomUUID(), x: 160, y: 140, width: 380, height: 260, src: reader.result as string, alt: file.name }], updatedAt: new Date().toISOString() } : page) }));
      setNotice({ tone: "success", message: "Image added to the current page." });
    };
    reader.readAsDataURL(file);
  }, [updateActiveSection]);

  const insertTable = useCallback(() => {
    updateActiveSection((section) => ({ ...section, pages: section.pages.map((page) => page.id === section.activePageId ? { ...page, tableBlocks: [...(page.tableBlocks ?? []), { id: crypto.randomUUID(), x: 160, y: 140, width: 480, rows: [["Heading", "Heading", "Heading"], ["", "", ""], ["", "", ""]] }], updatedAt: new Date().toISOString() } : page) }));
  }, [updateActiveSection]);

  const insertLink = useCallback(() => {
    const entered = window.prompt("Paste a web link");
    if (!entered) return;
    const normalized = /^https?:\/\//i.test(entered.trim()) ? entered.trim() : `https://${entered.trim()}`;
    try {
      const url = new URL(normalized);
      updateActiveSection((section) => ({ ...section, pages: section.pages.map((page) => page.id === section.activePageId ? { ...page, linkBlocks: [...(page.linkBlocks ?? []), { id: crypto.randomUUID(), x: 160, y: 140, width: 320, url: url.toString(), label: url.hostname.replace(/^www\./, "") }], updatedAt: new Date().toISOString() } : page) }));
    } catch { setNotice({ tone: "error", message: "Enter a valid web address." }); }
  }, [updateActiveSection]);

  const exportPdf = useCallback(async () => {
    setExportOpen(false);
    try {
      const path = await save({ defaultPath: `${activePage.title}.pdf`, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (!path) return;
      await invoke("export_page_pdf", { path, page: activePage, dark: theme === "dark" });
    } catch (error) {
      console.error(error);
    }
  }, [activePage, theme]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sketchDoc));
    if (!saveLocation || saveState !== "unsaved") return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void writeDocument(saveLocation, sketchDoc), 900);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [sketchDoc, saveLocation, saveState, writeDocument]);

  const undo = useCallback(() => {
    setHistory((items) => {
      const previous = items.at(-1);
      if (!previous) return items;
      setFuture((nextItems) => [clone(documentRef.current), ...nextItems].slice(0, 50));
      setSketchDoc(previous);
      setSaveState("unsaved");
      return items.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((items) => {
      const next = items[0];
      if (!next) return items;
      setHistory((previousItems) => [...previousItems, clone(documentRef.current)].slice(-50));
      setSketchDoc(next);
      setSaveState("unsaved");
      return items.slice(1);
    });
  }, []);

  const selectSection = (id: string) => setSketchDoc((current) => ({ ...current, activeSectionId: id }));
  const selectPage = (id: string) => updateActiveSection((section) => ({ ...section, activePageId: id }), false);

  const addSection = useCallback(() => {
    const current = documentRef.current;
    const section = createSection(`Untitled section ${current.sections.length + 1}`, SECTION_COLORS[current.sections.length % SECTION_COLORS.length]);
    commit({ ...current, sections: [...current.sections, section], activeSectionId: section.id, updatedAt: new Date().toISOString() });
  }, [commit]);

  const addPage = useCallback(() => {
    const page = createBlankPage(`Untitled page ${activeSection.pages.length + 1}`);
    updateActiveSection((section) => ({ ...section, pages: [...section.pages, page], activePageId: page.id }));
  }, [activeSection.pages.length, updateActiveSection]);

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    const current = documentRef.current;
    if (deleteTarget.kind === "page") {
      const section = current.sections.find((item) => item.id === current.activeSectionId) ?? current.sections[0];
      const index = section.pages.findIndex((page) => page.id === deleteTarget.id);
      const remaining = section.pages.filter((page) => page.id !== deleteTarget.id);
      const pages = remaining.length ? remaining : [createBlankPage()];
      const activePageId = section.activePageId === deleteTarget.id ? pages[Math.min(Math.max(index, 0), pages.length - 1)].id : section.activePageId;
      commit({ ...current, sections: current.sections.map((item) => item.id === section.id ? { ...item, pages, activePageId } : item), updatedAt: new Date().toISOString() }, false);
    } else {
      const index = current.sections.findIndex((section) => section.id === deleteTarget.id);
      const remaining = current.sections.filter((section) => section.id !== deleteTarget.id);
      const sections = remaining.length ? remaining : [createSection()];
      const activeSectionId = current.activeSectionId === deleteTarget.id ? sections[Math.min(Math.max(index, 0), sections.length - 1)].id : current.activeSectionId;
      commit({ ...current, sections, activeSectionId, updatedAt: new Date().toISOString() }, false);
    }
    setDeleteTarget(null);
  }, [commit, deleteTarget]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldSkipShortcut(event, isEditingText(event))) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void saveDocument(); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") { event.preventDefault(); addPage(); return; }
      const foundPreset = PEN_PRESETS.find((item) => item.shortcut === event.key);
      if (foundPreset) { setPresetId(foundPreset.id); setTool(penSettings[foundPreset.id]?.tool ?? foundPreset.tool); return; }
      const nextTool = getToolShortcut(event);
      if (nextTool) setTool(nextTool);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [addPage, penSettings, redo, saveDocument, undo]);

  const selectPreset = (id: string) => {
    const nextPreset = PEN_PRESETS.find((item) => item.id === id);
    if (!nextPreset) return;
    setPresetId(id);
    setTool(penSettings[id]?.tool ?? nextPreset.tool);
  };

  const updatePenColor = useCallback((id: string, color: string) => {
    if (!isHexColor(color) || !PEN_PRESETS.some((preset) => preset.id === id)) return;
    setPenColors((current) => ({ ...current, [id]: color }));
  }, []);

  const updatePenSettings = useCallback((id: string, settings: Partial<PenSettings>) => {
    if (!PEN_PRESETS.some((preset) => preset.id === id)) return;
    setPenSettings((current) => ({ ...current, [id]: { ...current[id], ...settings } }));
    if (id === presetId && settings.tool) setTool(settings.tool);
  }, [presetId]);

  const updatePenMode = useCallback((id: string, mode: "pen" | "highlighter") => {
    if (!PEN_PRESETS.some((preset) => preset.id === id)) return;
    setPresetId(id);
    setPenSettings((current) => ({ ...current, [id]: { ...current[id], tool: mode } }));
    setTool(mode);
  }, []);

  const handleWindowDrag = useCallback((event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, [data-no-window-drag]")) return;
    const currentWindow = getCurrentWindow();
    if (event.detail === 2) {
      void currentWindow.toggleMaximize().catch((error) => console.error("Could not toggle window maximize", error));
      return;
    }
    void currentWindow.startDragging().catch((error) => console.error("Could not start window drag", error));
  }, []);

  const closeWindow = useCallback(() => { void getCurrentWindow().close(); }, []);
  const minimizeWindow = useCallback(() => { void getCurrentWindow().minimize(); }, []);
  const toggleMaximize = useCallback(() => { void getCurrentWindow().toggleMaximize(); }, []);

  const deleteDescription = deleteTarget?.kind === "section"
    ? "This removes the section, all of its pages, and their drawings. This action cannot be undone."
    : "This removes the page and its drawings from this section. This action cannot be undone.";

  return (
    <MotionConfig reducedMotion="user">
    <main className={`app-shell theme-${theme} font-${fontStyle} density-${interfaceSize} ${sectionsOpen ? "" : "sections-collapsed"} ${pagesOpen ? "" : "pages-collapsed"}`} style={{ "--accent": accent, "--window-transparency": windowTransparency / 100 } as CSSProperties}>
      <header
        className="app-header"
      >
        <div className="window-controls" data-no-window-drag>
          <motion.button className="window-control window-control-close" type="button" onClick={closeWindow} aria-label="Close window" title="Close window" whileTap={{ scale: 0.9 }}><X /></motion.button>
          <motion.button className="window-control window-control-minimize" type="button" onClick={minimizeWindow} aria-label="Minimize window" title="Minimize window" whileTap={{ scale: 0.9 }}><Minus /></motion.button>
          <motion.button className="window-control window-control-maximize" type="button" onClick={toggleMaximize} aria-label="Maximize window" title="Maximize window" whileTap={{ scale: 0.9 }}><Maximize2 /></motion.button>
        </div>
        <div className="window-handle" title="Drag to move window" onMouseDown={handleWindowDrag}>
          <button className="window-menu-button" type="button" data-no-window-drag onClick={() => setPagesOpen((open) => !open)} aria-label={pagesOpen ? "Close pages sidebar" : "Open pages sidebar"} title={pagesOpen ? "Close pages sidebar" : "Open pages sidebar"}>
            <span className="window-handle-grip" aria-hidden="true"><span /><span /><span /></span>
          </button>
          <div className="window-title">
            <strong className="app-name">BoSketchObs</strong>
            <span className={`workspace-label ${saveState}`}><span>{saveLocation?.kind === "drive" ? "Google Drive" : "Local workspace"}</span><i />{saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : "Unsaved"}</span>
          </div>
        </div>
        <div className="header-drag-zone" aria-hidden="true" onMouseDown={handleWindowDrag} />
        <div className="header-actions" data-no-window-drag>
          <motion.button className="header-button" type="button" onClick={() => void openDocument()} aria-label="Open document" title="Open document" whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}><FolderOpen /><span className="button-label">Open</span></motion.button>
          <motion.button className="header-button" type="button" onClick={() => { setExportOpen(false); setSaveLocationOpen(true); }} aria-label="Choose save location" title="Choose save location" whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}><FolderOpen /><span className="button-label">Save as</span></motion.button>
          <div className="export-menu"><motion.button className="header-button" type="button" onClick={() => setExportOpen((open) => !open)} aria-expanded={exportOpen} aria-label="Export" title="Export" whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}><Download /><span className="button-label">Export</span><ChevronDown /></motion.button>{exportOpen ? <div className="export-popover"><button type="button" onClick={() => void exportPdf()}>Save current page as PDF</button></div> : null}</div>
          <motion.button className="save-button" type="button" onClick={() => void saveDocument()} aria-label="Save document" title="Save document" whileHover={{ y: -1, boxShadow: "0 8px 18px color-mix(in srgb, var(--accent) 36%, transparent)" }} whileTap={{ scale: 0.97 }}><SaveIcon /><span className="button-label">Save</span></motion.button>
          <motion.button className={`theme-toggle agent-toggle ${assistantOpen ? "active" : ""}`} type="button" onClick={() => setAssistantOpen((open) => !open)} aria-label="Open board assistant" title="Board assistant" whileHover={{ y: -1 }} whileTap={{ scale: 0.92 }}><Bot /></motion.button>
          <motion.button className="theme-toggle" type="button" onClick={() => setSettingsOpen(true)} aria-label="Open settings" title="Settings" whileHover={{ rotate: 12 }} whileTap={{ scale: 0.92 }}><Settings2 /></motion.button>
        </div>
      </header>
      <SectionList sections={sketchDoc.sections} activeSectionId={sketchDoc.activeSectionId} onSelect={selectSection} onAdd={addSection} onDelete={(section) => setDeleteTarget({ kind: "section", id: section.id, title: section.title })} onClose={() => setSectionsOpen(false)} isOpen={sectionsOpen} />
      <PageList pages={activeSection.pages} activePageId={activeSection.activePageId} onSelect={selectPage} onAdd={addPage} onDelete={(page) => setDeleteTarget({ kind: "page", id: page.id, title: page.title })} sectionsOpen={sectionsOpen} onToggleSections={() => setSectionsOpen((open) => !open)} />
      <section className="workspace">
        <div className="canvas-wrap">
          <CanvasBoard page={activePage} tool={tool} preset={preset} theme={theme} sheetBackground={sheetBackground} onChange={updatePage} onToolChange={setTool} onHardwareEraserChange={setHardwareEraserActive} />
          <Toolbar tool={tool} hardwareEraserActive={hardwareEraserActive} presetId={presetId} theme={theme} penColors={penColors} penSettings={penSettings} onToolChange={setTool} onPresetChange={selectPreset} onPresetColorChange={updatePenColor} onPresetSettingsChange={updatePenSettings} onPresetModeChange={updatePenMode} onInsertImage={() => imageInputRef.current?.click()} onInsertTable={insertTable} onInsertLink={insertLink} onUndo={undo} onRedo={redo} canUndo={history.length > 0} canRedo={future.length > 0} />
          <input ref={imageInputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" onChange={(event) => { const file = event.target.files?.[0]; if (file) insertImageFile(file); event.currentTarget.value = ""; }} />
        </div>
      </section>
      <AnimatePresence>
        {deleteTarget ? <ConfirmDialog key="delete-dialog" title={`Delete “${deleteTarget.title}”?`} description={deleteDescription} confirmLabel={deleteTarget.kind === "section" ? "Delete section" : "Delete page"} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} /> : null}
        {saveLocationOpen ? <SaveLocationDialog key="save-location-dialog" currentLocation={saveLocation} defaultFileName={`${sketchDoc.title}.bosketchobs.json`} onChoose={(location) => void chooseSaveLocation(location)} onOpenDrive={openDriveWorkspace} onClose={() => setSaveLocationOpen(false)} onPickLocal={pickLocalLocation} /> : null}
        {settingsOpen ? <SettingsPanel key="settings-panel" theme={theme} accent={accent} fontStyle={fontStyle} interfaceSize={interfaceSize} sheetBackground={sheetBackground} windowTransparency={windowTransparency} agentSettings={agentSettings} ollamaModels={ollamaModels} ollamaConnection={ollamaConnection} ollamaError={ollamaError} onThemeChange={setTheme} onAccentChange={setAccent} onFontStyleChange={setFontStyle} onInterfaceSizeChange={setInterfaceSize} onSheetBackgroundChange={setSheetBackground} onWindowTransparencyChange={setWindowTransparency} onAgentSettingsChange={updateAgentSettings} onTestOllama={() => void checkOllama()} onRefreshOllamaModels={() => void refreshOllamaModels()} onClose={() => setSettingsOpen(false)} /> : null}
      </AnimatePresence>
      <AnimatePresence>{assistantOpen ? <AssistantPanel key="assistant-panel" status={agentStatus} messages={agentMessages} pendingAction={agentPendingAction} connection={ollamaConnection} model={agentSettings.model} onSubmit={(prompt) => void runAgent(prompt)} onCancel={() => agentRef.current.cancel()} onApprove={() => void resumeAgent(true)} onReject={() => void resumeAgent(false)} onClose={() => setAssistantOpen(false)} /> : null}</AnimatePresence>
      <AnimatePresence>{notice ? <motion.div className={`app-notice ${notice.tone}`} role="status" initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} onAnimationComplete={() => window.setTimeout(() => setNotice(null), 4200)}>{notice.tone === "success" ? <CheckCircle2 /> : <AlertCircle />}<span>{notice.message}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message"><X /></button></motion.div> : null}</AnimatePresence>
    </main>
    </MotionConfig>
  );
}
