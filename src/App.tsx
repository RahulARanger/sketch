import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join as joinPath } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { confirm, open, save } from "@tauri-apps/plugin-dialog";
import { AlertCircle, CheckCircle2, ChevronDown, Cloud, Download, FolderOpen, Info, LogOut, Maximize2, Minus, RefreshCw, Save as SaveIcon, Settings2, UserRound, X } from "lucide-react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { CanvasBoard, type CanvasBoardHandle } from "./components/CanvasBoard";
import { AssistantPanel } from "./components/AssistantPanel";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { PageList } from "./components/PageList";
import { LinkDialog } from "./components/LinkDialog";
import { RenameDialog } from "./components/RenameDialog";
import { SectionList } from "./components/SectionList";
import { SettingsPanel, type FontStyle, type InterfaceSize, type SheetBackground } from "./components/SettingsPanel";
import { SaveLocationDialog, type SaveLocation } from "./components/SaveLocationDialog";
import { Toolbar } from "./components/Toolbar";
import { createBlankPage, createSection, migrateDocument, PEN_PRESETS, STARTER_DOCUMENT } from "./data";
import { readBrowserDraft, removeBrowserDraft, writeBrowserDraft } from "./draftStorage";
import { getToolShortcut, isEditingText, shouldSkipShortcut } from "./keyboardShortcuts";
import { disconnectGoogleDrive, downloadDriveText, getGoogleDriveAccount, isGoogleDriveConfigured, listDriveEntries, listDriveNotebooks, restoreGoogleDriveSession, type DriveAccount, type DriveNotebook, uploadDriveDocument } from "./googleDrive";
import type { LegacyNotebookDocument, NotePage, NoteSection, PenSettings, SketchDocument, ToolId } from "./types";
import { APP_CONFIG_FILE, DRAFT_FILE, findSectionLocationConflict, loadLocalSectionsFromConfig, loadSection, loadWorkspaceWithManifest, makeAppWorkspaceConfig, makeDraftSnapshot, makeSectionManifest, parseAppWorkspaceConfig, saveSection, SECTION_MANIFEST, WORKSPACE_MANIFEST, type DraftSnapshot, type SectionManifest, type SectionSaveLocation, type WorkspaceManifest } from "./workspaceStorage";
import { serializeBoardContext } from "./agent/boardContext";
import { OpenClawGateway } from "./agent/openclaw";
import type { AgentContextRef, AgentMessage, AgentSettings, AgentStatus, BoardChatSession } from "./agent/types";
import "./styles.css";

const STORAGE_KEY = "bosketchobs-session-v2";
const DRAFT_STORAGE_KEY = "bosketchobs-draft-v1";
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
const CHAT_SESSIONS_KEY = "bosketchobs-chat-sessions-v1";
const ACTIVE_CHAT_SESSION_KEY = "bosketchobs-active-chat-session-v1";
const SECTION_LOCATIONS_KEY = "bosketchobs-section-locations-v1";
const SECTION_COLORS = ["#45b875", "#e95b9a", "#ef8b3f", "#4d8fe8", "#9a70df", "#34a9b8"];

type DeleteTarget = { kind: "page" | "section"; id: string; title: string };
type RenameTarget = { kind: "page" | "section"; id: string; title: string };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type InitialSession = { document: SketchDocument; hasDraft: boolean };

function parseDraft(value: string | null): SketchDocument | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<DraftSnapshot>;
    if (parsed.version !== 1 || !parsed.document || typeof parsed.document !== "object") return null;
    return migrateDocument(parsed.document as SketchDocument);
  } catch {
    return null;
  }
}

function loadInitialSession(): InitialSession {
  try {
    const draft = parseDraft(localStorage.getItem(DRAFT_STORAGE_KEY));
    const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if ("__TAURI_INTERNALS__" in window) {
      return { document: stored ? migrateDocument(JSON.parse(stored) as SketchDocument | LegacyNotebookDocument) : clone(STARTER_DOCUMENT), hasDraft: false };
    }
    if (draft) return { document: draft, hasDraft: true };
    return { document: stored ? migrateDocument(JSON.parse(stored) as SketchDocument | LegacyNotebookDocument) : clone(STARTER_DOCUMENT), hasDraft: false };
  } catch {
    return { document: clone(STARTER_DOCUMENT), hasDraft: false };
  }
}

function loadSectionLocations(): Record<string, SectionSaveLocation> {
  try {
    const parsed = JSON.parse(localStorage.getItem(SECTION_LOCATIONS_KEY) ?? "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).flatMap(([sectionId, value]): Array<[string, SectionSaveLocation]> => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const location = value as Partial<SectionSaveLocation>;
      if (location.kind === "local" && typeof location.folderPath === "string" && location.folderPath) return [[sectionId, { kind: "local", folderPath: location.folderPath }]];
      if (location.kind === "drive" && typeof location.folderId === "string" && typeof location.folderName === "string") {
        const fileIds = location.fileIds && typeof location.fileIds === "object" && !Array.isArray(location.fileIds) ? Object.fromEntries(Object.entries(location.fileIds).filter(([, id]) => typeof id === "string")) : undefined;
        return [[sectionId, { kind: "drive", folderId: location.folderId, folderName: location.folderName, fileIds }]];
      }
      return [];
    })) as Record<string, SectionSaveLocation>;
  } catch {
    return {};
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
  const defaults: AgentSettings = { enabled: false, provider: "openclaw", endpoint: "http://localhost:11434", openclawEndpoint: "ws://127.0.0.1:18789", openclawToken: "", model: "", visionModel: "", maxSteps: 6, autoApplySafe: true, allowOnlineImages: false, includePageImage: true };
  try {
    const parsed = JSON.parse(localStorage.getItem(AGENT_SETTINGS_KEY) ?? "null") as Partial<AgentSettings> | null;
    if (!parsed || typeof parsed !== "object") return defaults;
    return { ...defaults, ...parsed, provider: "openclaw", maxSteps: Math.min(12, Math.max(1, Number(parsed.maxSteps) || defaults.maxSteps)) };
  } catch { return defaults; }
}

function createChatSession(): BoardChatSession {
  const timestamp = new Date().toISOString();
  return { id: crypto.randomUUID(), title: "New board chat", provider: "openclaw", contextRefs: [], includeEntireBoard: false, messages: [], createdAt: timestamp, updatedAt: timestamp };
}

function loadChatSessions(): BoardChatSession[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_SESSIONS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [createChatSession()];
    const sessions = parsed.filter((item): item is BoardChatSession => Boolean(item && typeof item === "object" && typeof (item as BoardChatSession).id === "string" && typeof (item as BoardChatSession).title === "string"));
    return sessions.length ? sessions.map((session) => ({ ...session, provider: "openclaw" })) : [createChatSession()];
  } catch { return [createChatSession()]; }
}

export default function App() {
  const [initialSession] = useState<InitialSession>(loadInitialSession);
  const [sketchDoc, setSketchDoc] = useState<SketchDocument>(initialSession.document);
  const [tool, setTool] = useState<ToolId>("pen");
  const [hardwareEraserActive, setHardwareEraserActive] = useState(false);
  const [presetId, setPresetId] = useState("contrast");
  const [sectionLocations, setSectionLocations] = useState<Record<string, SectionSaveLocation>>(loadSectionLocations);
  const [saveLocationOpen, setSaveLocationOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "unsaved">("unsaved");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(initialSession.hasDraft);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "dark" || stored === "light") return stored;
    return "dark";
  });
  const [history, setHistory] = useState<SketchDocument[]>([]);
  const [future, setFuture] = useState<SketchDocument[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [sectionsOpen, setSectionsOpen] = useState(true);
  const [pagesOpen, setPagesOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [googleAccount, setGoogleAccount] = useState<DriveAccount | null>(getGoogleDriveAccount());
  const [googleNotebooks, setGoogleNotebooks] = useState<DriveNotebook[]>([]);
  const [googleProfileOpen, setGoogleProfileOpen] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [agentSettings, setAgentSettings] = useState<AgentSettings>(loadAgentSettings);
  const [openclawConnection, setOpenclawConnection] = useState<"idle" | "testing" | "connected" | "error">("idle");
  const [openclawError, setOpenclawError] = useState("");
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("idle");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [chatSessions, setChatSessions] = useState<BoardChatSession[]>(loadChatSessions);
  const [activeChatSessionId, setActiveChatSessionId] = useState(() => localStorage.getItem(ACTIVE_CHAT_SESSION_KEY) ?? "");
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
  const draftPathRef = useRef<Promise<string> | null>(null);
  const appConfigPathRef = useRef<Promise<string> | null>(null);
  const draftWriteRef = useRef<Promise<void> | null>(null);
  const pendingDraftRef = useRef<string | null>(null);
  const draftTimerRef = useRef<number | null>(null);
  const closeInProgressRef = useRef(false);
  const hasUnsavedChangesRef = useRef(initialSession.hasDraft);
  const dirtySectionIdsRef = useRef(new Set(initialSession.hasDraft ? initialSession.document.sections.map((section) => section.id) : []));
  const dirtyRevisionRef = useRef(new Map<string, number>());
  const imageInputRef = useRef<HTMLInputElement>(null);
  const canvasBoardRef = useRef<CanvasBoardHandle>(null);
  const documentRef = useRef(sketchDoc);
  documentRef.current = sketchDoc;
  hasUnsavedChangesRef.current = hasUnsavedChanges;
  const openclawRef = useRef(new OpenClawGateway());

  const refreshGoogleNotebooks = useCallback(async () => {
    if (!googleAccount) return;
    setGoogleLoading(true);
    try { setGoogleNotebooks(await listDriveNotebooks()); }
    catch (error) { setNotice({ tone: "error", message: error instanceof Error ? error.message : "Could not load Google Drive notebooks." }); }
    finally { setGoogleLoading(false); }
  }, [googleAccount]);

  useEffect(() => {
    if (!isGoogleDriveConfigured()) return;
    void restoreGoogleDriveSession().then((restored) => {
      if (restored) { setGoogleAccount(restored); }
    });
  }, []);

  useEffect(() => { void refreshGoogleNotebooks(); }, [refreshGoogleNotebooks]);

  const getDraftPath = useCallback(async () => {
    if (!draftPathRef.current) draftPathRef.current = appDataDir().then((directory) => joinPath(directory, DRAFT_FILE));
    return draftPathRef.current;
  }, []);

  const getAppConfigPath = useCallback(async () => {
    if (!appConfigPathRef.current) appConfigPathRef.current = appDataDir().then((directory) => joinPath(directory, APP_CONFIG_FILE));
    return appConfigPathRef.current;
  }, []);

  const [storageHydrated, setStorageHydrated] = useState(() => !("__TAURI_INTERNALS__" in window));

  const persistAppConfig = useCallback(async (contents: SketchDocument, locations: Record<string, SectionSaveLocation>) => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    await invoke("save_note", { path: await getAppConfigPath(), contents: JSON.stringify(makeAppWorkspaceConfig(contents, locations), null, 2) });
  }, [getAppConfigPath]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let cancelled = false;
    void (async () => {
      let loadedSavedSections = false;
      try {
        const configContents = await invoke<string>("read_note", { path: await getAppConfigPath() });
        const config = parseAppWorkspaceConfig(configContents);
        const loaded = await loadLocalSectionsFromConfig(
          config,
          (path) => invoke<string>("read_note", { path }),
          (...parts) => parts.join("/"),
        );
        if (!loaded.sections.length) throw new Error("No local section folders are configured yet.");
        const parsed = migrateDocument({ ...config.document, sections: loaded.sections });
        if (cancelled) return;
        setSketchDoc(parsed);
        setSectionLocations(loaded.locations);
        setHistory([]);
        setFuture([]);
        dirtySectionIdsRef.current.clear();
        dirtyRevisionRef.current.clear();
        setHasUnsavedChanges(false);
        setSaveState("saved");
        setNotice({ tone: "success", message: `Loaded ${loaded.sections.length} saved ${loaded.sections.length === 1 ? "section" : "sections"}.` });
        loadedSavedSections = true;
      } catch (error) {
        // A missing config is expected on first launch. The local draft
        // recovery effect below remains responsible for unsaved work.
        try {
          const fallbackLocations = loadSectionLocations();
          if (!Object.keys(fallbackLocations).length) throw error;
          const fallbackConfig = makeAppWorkspaceConfig(documentRef.current, fallbackLocations);
          const loaded = await loadLocalSectionsFromConfig(
            fallbackConfig,
            (path) => invoke<string>("read_note", { path }),
            (...parts) => parts.join("/"),
          );
          if (!loaded.sections.length) throw error;
          const parsed = migrateDocument({ ...fallbackConfig.document, sections: loaded.sections });
          if (cancelled) return;
          await persistAppConfig(parsed, loaded.locations);
          setSketchDoc(parsed);
          setSectionLocations(loaded.locations);
          setHistory([]);
          setFuture([]);
          dirtySectionIdsRef.current.clear();
          dirtyRevisionRef.current.clear();
          setHasUnsavedChanges(false);
          setSaveState("saved");
          setNotice({ tone: "success", message: `Recovered ${loaded.sections.length} saved ${loaded.sections.length === 1 ? "section" : "sections"} from their folders.` });
          loadedSavedSections = true;
        } catch (recoveryError) {
          if (recoveryError instanceof Error && !/not found|no such file|No local section folders/i.test(recoveryError.message)) console.warn("Could not load saved sections", recoveryError);
        }
      } finally {
        if (!cancelled) {
          if (!loadedSavedSections) {
            setHasUnsavedChanges(false);
            setSaveState("saved");
          }
          setStorageHydrated(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [getAppConfigPath]);

  const writeDraft = useCallback((contents: SketchDocument) => {
    if (draftTimerRef.current !== null) {
      window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    const serialized = JSON.stringify(makeDraftSnapshot(contents), null, 2);
    pendingDraftRef.current = serialized;
    if ("__TAURI_INTERNALS__" in window && !draftWriteRef.current) {
      draftWriteRef.current = (async () => {
        while (pendingDraftRef.current !== null) {
          const latest = pendingDraftRef.current;
          pendingDraftRef.current = null;
          if ("__TAURI_INTERNALS__" in window) await invoke("save_note", { path: await getDraftPath(), contents: latest });
          else await writeBrowserDraft(latest);
          try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* ignore unavailable storage */ }
        }
      })().finally(() => {
        draftWriteRef.current = null;
        if (pendingDraftRef.current !== null) void writeDraft(documentRef.current).catch((error) => console.error("Draft backup failed", error));
      });
    } else if (!("__TAURI_INTERNALS__" in window) && !draftWriteRef.current) {
      draftWriteRef.current = (async () => {
        while (pendingDraftRef.current !== null) {
          const latest = pendingDraftRef.current;
          pendingDraftRef.current = null;
          await writeBrowserDraft(latest);
          try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* ignore unavailable storage */ }
        }
      })().finally(() => {
        draftWriteRef.current = null;
        if (pendingDraftRef.current !== null) void writeDraft(documentRef.current).catch((error) => console.error("Draft backup failed", error));
      });
    }
    return draftWriteRef.current ?? Promise.resolve();
  }, [getDraftPath]);

  const scheduleDraft = useCallback((contents: SketchDocument) => {
    if (draftTimerRef.current !== null) window.clearTimeout(draftTimerRef.current);
    draftTimerRef.current = window.setTimeout(() => {
      draftTimerRef.current = null;
      void writeDraft(contents).catch((error) => console.error("Draft backup failed", error));
    }, 180);
  }, [writeDraft]);

  const clearDraft = useCallback(async () => {
    if (draftTimerRef.current !== null) {
      window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    pendingDraftRef.current = null;
    try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch { /* ignore unavailable storage */ }
    await draftWriteRef.current?.catch(() => undefined);
    draftWriteRef.current = null;
    if ("__TAURI_INTERNALS__" in window) await invoke("remove_note", { path: await getDraftPath() });
    else await removeBrowserDraft();
  }, [getDraftPath]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void invoke<void>("auto_update").catch((error) => console.error("Automatic update check failed", error));
  }, []);

  useEffect(() => {
    if (!storageHydrated) return;
    const legacyDraft = parseDraft(localStorage.getItem(DRAFT_STORAGE_KEY));
    if (!("__TAURI_INTERNALS__" in window) && legacyDraft) return;
    let cancelled = false;
    void (async () => {
      try {
        const serializedDraft = "__TAURI_INTERNALS__" in window
          ? await invoke<string>("read_note", { path: await getDraftPath() }).catch(() => "")
          : await readBrowserDraft();
        const storedDraft = parseDraft(serializedDraft);
        const draft = [storedDraft, legacyDraft].filter((item): item is SketchDocument => Boolean(item)).sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)).at(-1) ?? null;
        if (cancelled || !draft || draft.updatedAt <= documentRef.current.updatedAt) return;
        setSketchDoc(draft);
        dirtySectionIdsRef.current = new Set(draft.sections.map((section) => section.id));
        setHasUnsavedChanges(true);
        setSaveState("unsaved");
        setNotice({ tone: "success", message: "Recovered your unsaved local draft." });
      } catch {
        // A missing draft is the normal first-launch case.
      }
    })();
    return () => { cancelled = true; };
  }, [getDraftPath, storageHydrated]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const activeSection = useMemo(
    () => sketchDoc.sections.find((section) => section.id === sketchDoc.activeSectionId) ?? sketchDoc.sections[0],
    [sketchDoc],
  );
  const activePage = useMemo(
    () => activeSection.pages.find((page) => page.id === activeSection.activePageId) ?? activeSection.pages[0],
    [activeSection],
  );
  const activeSectionLocation = sectionLocations[activeSection.id];
  const activeChatSession = useMemo(
    () => chatSessions.find((session) => session.id === activeChatSessionId) ?? chatSessions[0],
    [activeChatSessionId, chatSessions],
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
  useEffect(() => { localStorage.setItem(SECTION_LOCATIONS_KEY, JSON.stringify(sectionLocations)); }, [sectionLocations]);
  useEffect(() => {
    localStorage.setItem(CHAT_SESSIONS_KEY, JSON.stringify(chatSessions.map((session) => ({ ...session, messages: session.messages.slice(-100) }))));
    if (activeChatSession) localStorage.setItem(ACTIVE_CHAT_SESSION_KEY, activeChatSession.id);
  }, [activeChatSession, chatSessions]);
  useEffect(() => {
    if (!activeChatSession) return;
    setActiveChatSessionId((current) => current || activeChatSession.id);
    setAgentMessages(activeChatSession.messages);
  }, [activeChatSession]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    scheduleDraft(sketchDoc);
    return () => {
      if (draftTimerRef.current !== null) {
        window.clearTimeout(draftTimerRef.current);
        draftTimerRef.current = null;
      }
    };
  }, [hasUnsavedChanges, scheduleDraft, sketchDoc]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const currentWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void currentWindow.onCloseRequested(async (event) => {
      if (closeInProgressRef.current || !hasUnsavedChangesRef.current) return;
      event.preventDefault();
      const shouldClose = await confirm("You have unsaved changes. Keep them as a local draft and close BoSketchObs?", { title: "Unsaved changes", kind: "warning" });
      if (!shouldClose) return;
      try {
        await writeDraft(documentRef.current);
        closeInProgressRef.current = true;
        await currentWindow.close();
      } catch (error) {
        console.error("Could not preserve draft before closing", error);
        setNotice({ tone: "error", message: "I could not preserve the draft, so the app will stay open." });
      }
    }).then((remove) => { unlisten = remove; }).catch((error) => console.error("Could not listen for window close", error));
    return () => unlisten?.();
  }, [writeDraft]);

  const commit = useCallback((next: SketchDocument, recordHistory = true, markDirty = recordHistory) => {
    if (recordHistory) setHistory((items) => [...items.slice(-49), clone(documentRef.current)]);
    setFuture([]);
    setSketchDoc(next);
    if (markDirty) {
      const changedSectionIds = next.sections.filter((section) => documentRef.current.sections.find((currentSection) => currentSection.id === section.id) !== section).map((section) => section.id);
      changedSectionIds.forEach((sectionId) => dirtySectionIdsRef.current.add(sectionId));
      changedSectionIds.forEach((sectionId) => dirtyRevisionRef.current.set(sectionId, (dirtyRevisionRef.current.get(sectionId) ?? 0) + 1));
      setHasUnsavedChanges(true);
      setSaveState("unsaved");
    }
  }, []);

  const updateActiveSection = useCallback((updater: (section: NoteSection) => NoteSection, recordHistory = true) => {
    const current = documentRef.current;
    const next = {
      ...current,
      sections: current.sections.map((section) => section.id === current.activeSectionId ? updater(section) : section),
      updatedAt: new Date().toISOString(),
    };
    commit(next, recordHistory, recordHistory);
  }, [commit]);

  const updatePage = useCallback((nextPage: NotePage) => {
    updateActiveSection((section) => ({ ...section, pages: section.pages.map((page) => page.id === nextPage.id ? nextPage : page) }));
  }, [updateActiveSection]);

  const updateAgentSettings = useCallback((next: Partial<AgentSettings>) => {
    setAgentSettings((current) => ({ ...current, ...next }));
  }, []);

  const updateChatSession = useCallback((sessionId: string, updater: (session: BoardChatSession) => BoardChatSession) => {
    setChatSessions((sessions) => sessions.map((session) => session.id === sessionId ? updater({ ...session, updatedAt: new Date().toISOString() }) : session));
  }, []);

  const updateSessionMessages = useCallback((sessionId: string, messages: AgentMessage[]) => {
    setAgentMessages(messages);
    updateChatSession(sessionId, (session) => ({ ...session, messages: messages.slice(-100) }));
  }, [updateChatSession]);

  const createNewChatSession = useCallback(() => {
    const session = createChatSession();
    setChatSessions((sessions) => [...sessions, session]);
    setActiveChatSessionId(session.id);
    setAgentMessages([]);
    setAgentStatus("idle");
    setAssistantOpen(true);
  }, []);

  const selectChatSession = useCallback((sessionId: string) => {
    if (agentStatus === "running" || agentStatus === "waiting") return;
    const session = chatSessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveChatSessionId(session.id);
    setAgentMessages(session.messages);
    setAgentStatus("idle");
  }, [agentStatus, chatSessions]);

  const toggleEntireBoardContext = useCallback((enabled: boolean) => {
    if (!activeChatSession) return;
    updateChatSession(activeChatSession.id, (session) => ({ ...session, includeEntireBoard: enabled }));
  }, [activeChatSession, updateChatSession]);

  const toggleContextRef = useCallback((ref: AgentContextRef) => {
    if (!activeChatSession) return;
    updateChatSession(activeChatSession.id, (session) => {
      const exists = session.contextRefs.some((item) => item.sectionId === ref.sectionId && item.pageId === ref.pageId);
      return { ...session, contextRefs: exists ? session.contextRefs.filter((item) => item.sectionId !== ref.sectionId || item.pageId !== ref.pageId) : [...session.contextRefs, ref] };
    });
  }, [activeChatSession, updateChatSession]);

  const checkOpenClaw = useCallback(async () => {
    setOpenclawConnection("testing");
    try {
      await openclawRef.current.test(agentSettings.openclawEndpoint, agentSettings.openclawToken);
      setOpenclawConnection("connected");
      setOpenclawError("");
    } catch (error) {
      console.error(error);
      setOpenclawConnection("error");
      setOpenclawError(error instanceof Error ? error.message : String(error));
    }
  }, [agentSettings.openclawEndpoint, agentSettings.openclawToken]);

  const runAgent = useCallback(async (prompt: string) => {
    const session = activeChatSession;
    if (!session) return;
    if (!agentSettings.enabled) {
      updateSessionMessages(session.id, [...session.messages, { role: "user", content: prompt }, { role: "assistant", content: "Enable the board agent in Settings first." }]);
      setAgentStatus("failed");
      return;
    }
    const previousMessages = session.messages;
    const userMessage: AgentMessage = { role: "user", content: prompt };
    const startingMessages = [...previousMessages, userMessage];
    updateSessionMessages(session.id, startingMessages);
    if (session.title === "New board chat") updateChatSession(session.id, (current) => ({ ...current, title: prompt.trim().slice(0, 42) || "Board chat" }));
    setAgentStatus("running");
    try {
      let sessionKey = session.openclawSessionKey;
      if (!sessionKey) {
        sessionKey = await openclawRef.current.createSession(agentSettings.openclawEndpoint, agentSettings.openclawToken, session.title === "New board chat" ? prompt.slice(0, 42) : session.title);
        updateChatSession(session.id, (current) => ({ ...current, openclawSessionKey: sessionKey }));
      }
      const context = serializeBoardContext(documentRef.current, activeSection.id, activePage.id, session.contextRefs, session.includeEntireBoard);
      const answer = await openclawRef.current.send(agentSettings.openclawEndpoint, agentSettings.openclawToken, sessionKey, `${prompt}\n\nBoSketchObs context:\n${context}\n\nBoard changes require the BoSketchObs OpenClaw tool plugin.`, (partial) => updateSessionMessages(session.id, [...startingMessages, { role: "assistant", content: partial }]));
      updateSessionMessages(session.id, [...startingMessages, { role: "assistant", content: answer }]);
      setAgentStatus("completed");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      updateSessionMessages(session.id, [...startingMessages, { role: "assistant", content: "I couldn’t complete that board task.", error: detail }]);
      setAgentStatus("failed");
    }
  }, [activeChatSession, activePage.id, activeSection.id, agentSettings, updateChatSession, updateSessionMessages]);

  const writeDocument = useCallback(async (locations: Record<string, SectionSaveLocation>, contents: SketchDocument) => {
    const writableSections = contents.sections.filter((section) => locations[section.id]);
    if (!writableSections.length) throw new Error("Choose a folder for this section before saving.");
    const conflicts = writableSections
      .map((section) => findSectionLocationConflict(contents.sections, locations, locations[section.id], section.id))
      .filter((section): section is NoteSection => Boolean(section));
    if (conflicts.length) throw new Error(`Each section needs its own folder. “${conflicts[0].title}” is already assigned to the selected folder.`);
    const revisionsAtStart = new Map([...dirtySectionIdsRef.current].map((sectionId) => [sectionId, dirtyRevisionRef.current.get(sectionId)]));
    setSaveState("saving");
    try {
      const savedLocations = await Promise.all(writableSections.map(async (section) => {
        const location = locations[section.id];
        if (location.kind === "local") {
          await saveSection(
            contents,
            section,
            (relativePath, savedContents) => invoke("save_note", { path: `${location.folderPath}/${relativePath}`, contents: savedContents }),
            (...parts) => parts.join("/"),
            locations,
          );
          return [section.id, location] as const;
        }

        const manifest = makeSectionManifest(contents, section, locations);
        const nextFileIds = { ...location.fileIds };
        await Promise.all(section.pages.map(async (page, index) => {
          const storedPage = manifest.pages[index];
          const uploaded = await uploadDriveDocument(JSON.stringify(page, null, 2), storedPage.file, location.folderId, nextFileIds[page.id]);
          nextFileIds[page.id] = uploaded.id;
        }));
        const updatedManifest = makeSectionManifest(contents, section, { ...locations, [section.id]: { ...location, fileIds: nextFileIds } });
        const manifestUpload = await uploadDriveDocument(JSON.stringify(updatedManifest, null, 2), SECTION_MANIFEST, location.folderId, nextFileIds.__section__);
        nextFileIds.__section__ = manifestUpload.id;
        return [section.id, { ...location, fileIds: nextFileIds }] as const;
      }));
      const nextLocations = { ...locations, ...Object.fromEntries(savedLocations) };
      await persistAppConfig(contents, nextLocations);
      setSectionLocations((current) => ({ ...current, ...Object.fromEntries(savedLocations) }));
      const savedSectionIds = new Set(savedLocations.map(([sectionId]) => sectionId).filter((sectionId) => dirtyRevisionRef.current.get(sectionId) === revisionsAtStart.get(sectionId)));
      savedSectionIds.forEach((sectionId) => dirtyRevisionRef.current.delete(sectionId));
      dirtySectionIdsRef.current = new Set([...dirtySectionIdsRef.current].filter((sectionId) => !savedSectionIds.has(sectionId)));
      const draftRemains = dirtySectionIdsRef.current.size > 0;
      setHasUnsavedChanges(draftRemains);
      setSaveState(draftRemains ? "unsaved" : "saved");
      if (!draftRemains) {
        try { await clearDraft(); } catch (draftError) { console.error("Could not clear the saved draft", draftError); }
      }
    } catch (error) {
      setSaveState("unsaved");
      throw error;
    }
  }, [clearDraft, persistAppConfig]);

  const saveDocument = useCallback(async () => {
    try {
      if (!sectionLocations[activeSection.id]) {
        setSaveLocationOpen(true);
        return;
      }
      await writeDocument(sectionLocations, documentRef.current);
    } catch (error) {
      console.error(error);
      setSaveState("unsaved");
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "The workspace could not be saved." });
    }
  }, [activeSection.id, sectionLocations, writeDocument]);

  const pickLocalLocation = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false, title: "Choose a folder for this notebook" });
    return typeof selected === "string" ? selected : null;
  }, []);

  const chooseSaveLocation = useCallback(async (location: SaveLocation) => {
    const conflict = findSectionLocationConflict(sketchDoc.sections, sectionLocations, location, activeSection.id);
    if (conflict) {
      setNotice({ tone: "error", message: `This folder is already assigned to “${conflict.title}”. Each section must use its own folder.` });
      return;
    }
    const nextLocations = { ...sectionLocations, [activeSection.id]: location };
    setSectionLocations(nextLocations);
    setSaveLocationOpen(false);
    try {
      await writeDocument(nextLocations, documentRef.current);
    } catch (error) {
      console.error(error);
      setSaveState("unsaved");
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "The section could not be saved." });
    }
  }, [activeSection.id, sectionLocations, writeDocument]);

  const openDocument = useCallback(async () => {
    try {
      const source = await open({ directory: true, multiple: false, title: "Open a BoSketchObs workspace folder" });
      if (!source || Array.isArray(source)) return;
      const read = (relativePath: string) => invoke<string>("read_note", { path: `${source}/${relativePath}` });
      let parsed: SketchDocument;
      let nextLocations: Record<string, SectionSaveLocation>;
      try {
        const loaded = await loadWorkspaceWithManifest(read, (...parts) => parts.join("/"));
        parsed = migrateDocument(loaded.document);
        nextLocations = Object.fromEntries(loaded.manifest.sections.map((section) => [section.id, { kind: "local", folderPath: `${source}/${section.folder}` }]));
      } catch {
        const loaded = await loadSection(read, (...parts) => parts.join("/"));
        parsed = {
          version: 2,
          id: loaded.manifest.notebookId,
          title: loaded.manifest.notebookTitle,
          sections: [loaded.section],
          activeSectionId: loaded.section.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        nextLocations = { ...(loaded.manifest.sectionLocations ?? {}), [loaded.section.id]: { kind: "local", folderPath: source } };
      }
      await persistAppConfig(parsed, nextLocations);
      setSketchDoc(parsed);
      setSectionLocations(nextLocations);
      setHistory([]);
      setFuture([]);
      dirtySectionIdsRef.current.clear();
      dirtyRevisionRef.current.clear();
      setHasUnsavedChanges(false);
      setSaveState("saved");
      setNotice({ tone: "success", message: "Local workspace opened." });
    } catch (error) {
      console.error(error);
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "The local workspace could not be opened." });
    }
  }, [persistAppConfig]);

  const openDriveWorkspace = useCallback(async (folderId: string, folderName: string) => {
    try {
      const rootEntries = await listDriveEntries(folderId);
      const manifestFile = rootEntries.find((entry) => entry.name === WORKSPACE_MANIFEST);
      if (!manifestFile) {
        const sectionFile = rootEntries.find((entry) => entry.name === SECTION_MANIFEST);
        if (!sectionFile) throw new Error("This Google Drive folder does not contain a BoSketchObs workspace or section.");
        const sectionManifest = JSON.parse(await downloadDriveText(sectionFile.id)) as SectionManifest;
        if (sectionManifest.version !== 1) throw new Error("This Google Drive section uses an unsupported format.");
        const pages = await Promise.all(sectionManifest.pages.map(async (page) => {
          const file = rootEntries.find((entry) => entry.name === page.file);
          if (!file) throw new Error(`The page “${page.title}” is missing from Google Drive.`);
          return JSON.parse(await downloadDriveText(file.id)) as NotePage;
        }));
        const section = { ...sectionManifest.section, pages };
        const parsed: SketchDocument = { version: 2, id: sectionManifest.notebookId, title: sectionManifest.notebookTitle, sections: [section], activeSectionId: section.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        const fileIds: Record<string, string> = { __section__: sectionFile.id };
        sectionManifest.pages.forEach((page) => {
          const file = rootEntries.find((entry) => entry.name === page.file);
          if (file) fileIds[page.id] = file.id;
        });
        setSketchDoc(migrateDocument(parsed));
        setSectionLocations({ [section.id]: { kind: "drive", folderId, folderName, fileIds } });
        setHistory([]);
        setFuture([]);
        dirtySectionIdsRef.current.clear();
        dirtyRevisionRef.current.clear();
        setHasUnsavedChanges(false);
        setSaveState("saved");
        setSaveLocationOpen(false);
        await persistAppConfig(migrateDocument(parsed), { [section.id]: { kind: "drive", folderId, folderName, fileIds } });
        setNotice({ tone: "success", message: `Opened section “${section.title}” from Google Drive.` });
        return;
      }
      const manifest = JSON.parse(await downloadDriveText(manifestFile.id)) as WorkspaceManifest;
      if (manifest.version !== 3) throw new Error("This Google Drive workspace uses an unsupported format.");
      const nextLocations: Record<string, SectionSaveLocation> = {};
      const sections = await Promise.all(manifest.sections.map(async (section) => {
        const folder = rootEntries.find((entry) => entry.name === section.folder && entry.mimeType === "application/vnd.google-apps.folder");
        if (!folder) throw new Error(`The section folder “${section.title}” is missing from Google Drive.`);
        const entries = await listDriveEntries(folder.id);
        const sectionFile = entries.find((entry) => entry.name === SECTION_MANIFEST);
        const fileIdsForSection: Record<string, string> = sectionFile ? { __section__: sectionFile.id } : {};
        const pages = await Promise.all(section.pages.map(async (page) => {
          const file = entries.find((entry) => entry.name === page.file);
          if (!file) throw new Error(`The page “${page.title}” is missing from Google Drive.`);
          fileIdsForSection[page.id] = file.id;
          return JSON.parse(await downloadDriveText(file.id)) as NotePage;
        }));
        nextLocations[section.id] = { kind: "drive", folderId: folder.id, folderName: folder.name, fileIds: fileIdsForSection };
        return { id: section.id, title: section.title, color: section.color, activePageId: section.activePageId, pages };
      }));
      const parsed = migrateDocument({ ...manifest, version: 2, sections });
      setSketchDoc(parsed);
      setSectionLocations(nextLocations);
      setHistory([]);
      setFuture([]);
      dirtySectionIdsRef.current.clear();
      dirtyRevisionRef.current.clear();
      setHasUnsavedChanges(false);
      setSaveState("saved");
      setSaveLocationOpen(false);
      await persistAppConfig(parsed, nextLocations);
      setNotice({ tone: "success", message: `Opened “${folderName}” from Google Drive.` });
    } catch (error) {
      console.error(error);
      setNotice({ tone: "error", message: error instanceof Error ? error.message : "The Google Drive workspace could not be opened." });
    }
  }, [persistAppConfig]);

  const insertImageFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) { setNotice({ tone: "error", message: "Choose a PNG, JPEG, GIF, WebP, or SVG image." }); return; }
    if (file.size > 12 * 1024 * 1024) { setNotice({ tone: "error", message: "Images must be smaller than 12 MB." }); return; }
    const inserted = await canvasBoardRef.current?.insertImage(file);
    setNotice(inserted ? { tone: "success", message: "Image added to the current page." } : { tone: "error", message: "That image could not be decoded." });
  }, []);

  const insertTable = useCallback(() => {
    canvasBoardRef.current?.insertTable();
  }, []);

  const insertLink = useCallback(() => setLinkDialogOpen(true), []);

  const saveLink = useCallback((entered: string) => {
    const normalized = /^https?:\/\//i.test(entered.trim()) ? entered.trim() : `https://${entered.trim()}`;
    try {
      const url = new URL(normalized);
      canvasBoardRef.current?.insertLink(url.toString());
      setLinkDialogOpen(false);
      setNotice({ tone: "success", message: "Link added to the current page." });
    } catch { setNotice({ tone: "error", message: "Enter a valid web address." }); }
  }, []);

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
    if (!storageHydrated) return;
    if (!sectionLocations[sketchDoc.activeSectionId] || saveState !== "unsaved") return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void writeDocument(sectionLocations, sketchDoc).catch((error) => console.error("Autosave failed", error)), 900);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [sectionLocations, sketchDoc, saveState, storageHydrated, writeDocument]);

  const undo = useCallback(() => {
    setHistory((items) => {
      const previous = items.at(-1);
      if (!previous) return items;
      setFuture((nextItems) => [clone(documentRef.current), ...nextItems].slice(0, 50));
      dirtySectionIdsRef.current.add(documentRef.current.activeSectionId);
      dirtyRevisionRef.current.set(documentRef.current.activeSectionId, (dirtyRevisionRef.current.get(documentRef.current.activeSectionId) ?? 0) + 1);
      setSketchDoc(previous);
      setHasUnsavedChanges(true);
      setSaveState("unsaved");
      return items.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((items) => {
      const next = items[0];
      if (!next) return items;
      setHistory((previousItems) => [...previousItems, clone(documentRef.current)].slice(-50));
      dirtySectionIdsRef.current.add(documentRef.current.activeSectionId);
      dirtyRevisionRef.current.set(documentRef.current.activeSectionId, (dirtyRevisionRef.current.get(documentRef.current.activeSectionId) ?? 0) + 1);
      setSketchDoc(next);
      setHasUnsavedChanges(true);
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

  const addSubpage = useCallback((parentPage: NotePage) => {
    if (parentPage.parentId) return;
    const current = documentRef.current;
    const section = current.sections.find((item) => item.id === current.activeSectionId) ?? current.sections[0];
    if (!section || !section.pages.some((page) => page.id === parentPage.id)) return;
    const childCount = section.pages.filter((page) => page.parentId === parentPage.id).length;
    const page = createBlankPage(`Untitled subpage ${childCount + 1}`, parentPage.id);
    updateActiveSection((item) => ({ ...item, pages: [...item.pages, page], activePageId: page.id }));
  }, [updateActiveSection]);

  const renameSection = useCallback((id: string, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    const current = documentRef.current;
    const section = current.sections.find((item) => item.id === id);
    if (!section || section.title === nextTitle) return;
    commit({
      ...current,
      sections: current.sections.map((item) => item.id === id ? { ...item, title: nextTitle } : item),
      updatedAt: new Date().toISOString(),
    });
  }, [commit]);

  const updateSectionColor = useCallback((id: string, color: string) => {
    if (!isHexColor(color)) return;
    const current = documentRef.current;
    const section = current.sections.find((item) => item.id === id);
    if (!section || section.color === color) return;
    commit({
      ...current,
      sections: current.sections.map((item) => item.id === id ? { ...item, color } : item),
      updatedAt: new Date().toISOString(),
    });
  }, [commit]);

  const renamePage = useCallback((id: string, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) return;
    const current = documentRef.current;
    const section = current.sections.find((item) => item.id === current.activeSectionId) ?? current.sections[0];
    const page = section?.pages.find((item) => item.id === id);
    if (!page || page.title === nextTitle) return;
    updateActiveSection((item) => ({
      ...item,
      pages: item.pages.map((candidate) => candidate.id === id ? { ...candidate, title: nextTitle, updatedAt: new Date().toISOString() } : candidate),
    }));
  }, [updateActiveSection]);

  const saveRename = useCallback((title: string) => {
    if (!renameTarget) return;
    if (renameTarget.kind === "section") renameSection(renameTarget.id, title);
    else renamePage(renameTarget.id, title);
    setRenameTarget(null);
  }, [renamePage, renameSection, renameTarget]);

  const confirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    const current = documentRef.current;
    if (deleteTarget.kind === "page") {
      const section = current.sections.find((item) => item.id === current.activeSectionId) ?? current.sections[0];
      const index = section.pages.findIndex((page) => page.id === deleteTarget.id);
      const removedIds = new Set([deleteTarget.id, ...section.pages.filter((page) => page.parentId === deleteTarget.id).map((page) => page.id)]);
      const remaining = section.pages.filter((page) => !removedIds.has(page.id));
      const pages = remaining.length ? remaining : [createBlankPage()];
      const activePageId = removedIds.has(section.activePageId) ? pages[Math.min(Math.max(index, 0), pages.length - 1)].id : section.activePageId;
      commit({ ...current, sections: current.sections.map((item) => item.id === section.id ? { ...item, pages, activePageId } : item), updatedAt: new Date().toISOString() }, false, true);
    } else {
      const index = current.sections.findIndex((section) => section.id === deleteTarget.id);
      const remaining = current.sections.filter((section) => section.id !== deleteTarget.id);
      const sections = remaining.length ? remaining : [createSection()];
      const activeSectionId = current.activeSectionId === deleteTarget.id ? sections[Math.min(Math.max(index, 0), sections.length - 1)].id : current.activeSectionId;
      commit({ ...current, sections, activeSectionId, updatedAt: new Date().toISOString() }, false, true);
      setSectionLocations((locations) => {
        const next = { ...locations };
        delete next[deleteTarget.id];
        return next;
      });
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
    : deleteTarget && activeSection.pages.some((page) => page.parentId === deleteTarget.id)
      ? "This removes the page, its subpages, and their drawings from this section. This action cannot be undone."
      : "This removes the page and its drawings from this section. This action cannot be undone.";
  const savePathLabel = activeSectionLocation?.kind === "drive"
    ? `Google Drive folder: ${activeSectionLocation.folderName}`
    : activeSectionLocation?.kind === "local"
      ? `Local folder: ${activeSectionLocation.folderPath}`
      : "This section has not been assigned a save folder yet.";

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
            <span className={`workspace-label ${saveState}`}><span>{activeSectionLocation?.kind === "drive" ? "Google Drive" : activeSectionLocation ? "Local folder" : "Folder not set"}</span><i />{saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : "Unsaved"}</span>
            <span className="save-path-info" data-tooltip={savePathLabel} tabIndex={0} aria-label={savePathLabel}><Info /></span>
          </div>
        </div>
        <div className="header-drag-zone" aria-hidden="true" onMouseDown={handleWindowDrag} />
        <div className="header-actions" data-no-window-drag>
          <motion.button className="header-button" type="button" onClick={() => void openDocument()} aria-label="Open document" title="Open document" whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}><FolderOpen /><span className="button-label">Open</span></motion.button>
          <motion.button className="header-button" type="button" onClick={() => { setExportOpen(false); setSaveLocationOpen(true); }} aria-label="Choose save location" title="Choose save location" whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}><FolderOpen /><span className="button-label">Save as</span></motion.button>
          <div className="export-menu"><motion.button className="header-button" type="button" onClick={() => setExportOpen((open) => !open)} aria-expanded={exportOpen} aria-label="Export" title="Export" whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}><Download /><span className="button-label">Export</span><ChevronDown /></motion.button>{exportOpen ? <div className="export-popover"><button type="button" onClick={() => void exportPdf()}>Save current page as PDF</button></div> : null}</div>
          <motion.button className="save-button" type="button" onClick={() => void saveDocument()} aria-label="Save document" title="Save document" whileHover={{ y: -1, boxShadow: "0 8px 18px color-mix(in srgb, var(--accent) 36%, transparent)" }} whileTap={{ scale: 0.97 }}><SaveIcon /><span className="button-label">Save</span></motion.button>
          {googleAccount ? <div className="google-profile-wrap">
            <motion.button className="google-profile-button" type="button" onClick={() => setGoogleProfileOpen((open) => !open)} aria-expanded={googleProfileOpen} aria-label="Open Google profile" title="Google account" whileHover={{ y: -1 }} whileTap={{ scale: 0.96 }}>
              {googleAccount.picture ? <img src={googleAccount.picture} alt="" /> : <span><UserRound /></span>}<ChevronDown />
            </motion.button>
            {googleProfileOpen ? <div className="google-profile-menu" role="menu" aria-label="Google account menu">
              <div className="google-profile-heading">{googleAccount.picture ? <img src={googleAccount.picture} alt="" /> : <span className="google-profile-avatar"><UserRound /></span>}<div><strong>{googleAccount.name}</strong><small>{googleAccount.email}</small></div></div>
              <div className="google-menu-divider" />
              <div className="google-notebook-heading"><span><Cloud /> Saved notebooks</span><button type="button" onClick={() => void refreshGoogleNotebooks()} aria-label="Refresh saved notebooks" title="Refresh"><RefreshCw /></button></div>
              <div className="google-notebook-list">{googleLoading ? <span className="google-notebook-empty">Loading from Drive…</span> : googleNotebooks.length ? googleNotebooks.map((notebook) => <button key={notebook.id} type="button" onClick={() => { setGoogleProfileOpen(false); void openDriveWorkspace(notebook.id, notebook.name); }}><span className="google-notebook-icon"><FolderOpen /></span><span><strong>{notebook.name}</strong><small>{notebook.kind === "workspace" ? "Notebook" : "Section"}</small></span></button>) : <span className="google-notebook-empty">No BoSketchObs notebooks found.</span>}</div>
              <button className="google-signout" type="button" onClick={() => { disconnectGoogleDrive(); setGoogleAccount(null); setGoogleNotebooks([]); setGoogleProfileOpen(false); }}><LogOut /> Sign out of Google</button>
            </div> : null}
          </div> : <button className="google-connect-compact" type="button" onClick={() => setSaveLocationOpen(true)} aria-label="Connect Google Drive" title="Connect Google Drive"><Cloud /></button>}
          <motion.button className="theme-toggle" type="button" onClick={() => setSettingsOpen(true)} aria-label="Open settings" title="Settings" whileHover={{ rotate: 12 }} whileTap={{ scale: 0.92 }}><Settings2 /></motion.button>
        </div>
      </header>
      <SectionList sections={sketchDoc.sections} activeSectionId={sketchDoc.activeSectionId} onSelect={selectSection} onAdd={addSection} onRename={(section) => setRenameTarget({ kind: "section", id: section.id, title: section.title })} onColorChange={(section, color) => updateSectionColor(section.id, color)} onDelete={(section) => setDeleteTarget({ kind: "section", id: section.id, title: section.title })} onClose={() => setSectionsOpen(false)} isOpen={sectionsOpen} />
      <PageList pages={activeSection.pages} activePageId={activeSection.activePageId} onSelect={selectPage} onAdd={addPage} onAddSubpage={addSubpage} onRename={(page) => setRenameTarget({ kind: "page", id: page.id, title: page.title })} onDelete={(page) => setDeleteTarget({ kind: "page", id: page.id, title: page.title })} sectionsOpen={sectionsOpen} onToggleSections={() => setSectionsOpen((open) => !open)} />
      <section className="workspace">
        <div className="canvas-wrap">
          <CanvasBoard ref={canvasBoardRef} page={activePage} tool={tool} preset={preset} theme={theme} sheetBackground={sheetBackground} onChange={updatePage} onToolChange={setTool} onHardwareEraserChange={setHardwareEraserActive} />
          <Toolbar tool={tool} hardwareEraserActive={hardwareEraserActive} presetId={presetId} theme={theme} penColors={penColors} penSettings={penSettings} onToolChange={setTool} onPresetChange={selectPreset} onPresetColorChange={updatePenColor} onPresetSettingsChange={updatePenSettings} onPresetModeChange={updatePenMode} onInsertImage={() => imageInputRef.current?.click()} onInsertTable={insertTable} onInsertLink={insertLink} onUndo={undo} onRedo={redo} canUndo={history.length > 0} canRedo={future.length > 0} />
          <input ref={imageInputRef} className="visually-hidden" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" onChange={(event) => { const file = event.target.files?.[0]; if (file) insertImageFile(file); event.currentTarget.value = ""; }} />
        </div>
      </section>
      <AnimatePresence>
        {renameTarget ? <RenameDialog key="rename-dialog" kind={renameTarget.kind} currentTitle={renameTarget.title} onCancel={() => setRenameTarget(null)} onSave={saveRename} /> : null}
        {linkDialogOpen ? <LinkDialog key="link-dialog" onCancel={() => setLinkDialogOpen(false)} onSave={saveLink} /> : null}
        {deleteTarget ? <ConfirmDialog key="delete-dialog" title={`Delete “${deleteTarget.title}”?`} description={deleteDescription} confirmLabel={deleteTarget.kind === "section" ? "Delete section" : "Delete page"} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} /> : null}
        {saveLocationOpen ? <SaveLocationDialog key="save-location-dialog" sectionTitle={activeSection.title} currentLocation={activeSectionLocation ?? null} onChoose={(location) => void chooseSaveLocation(location)} onOpenDrive={openDriveWorkspace} onDriveConnected={setGoogleAccount} onClose={() => setSaveLocationOpen(false)} onPickLocal={pickLocalLocation} /> : null}
        {settingsOpen ? <SettingsPanel key="settings-panel" theme={theme} accent={accent} fontStyle={fontStyle} interfaceSize={interfaceSize} sheetBackground={sheetBackground} windowTransparency={windowTransparency} agentSettings={agentSettings} openclawConnection={openclawConnection} openclawError={openclawError} onThemeChange={setTheme} onAccentChange={setAccent} onFontStyleChange={setFontStyle} onInterfaceSizeChange={setInterfaceSize} onSheetBackgroundChange={setSheetBackground} onWindowTransparencyChange={setWindowTransparency} onAgentSettingsChange={updateAgentSettings} onTestOpenClaw={() => void checkOpenClaw()} onClose={() => setSettingsOpen(false)} /> : null}
      </AnimatePresence>
      <AnimatePresence>{assistantOpen && activeChatSession ? <AssistantPanel key="assistant-panel" status={agentStatus} messages={agentMessages} pendingAction={undefined} connection={openclawConnection} model="Gateway session" sections={sketchDoc.sections} sessions={chatSessions} activeSession={activeChatSession} onSessionSelect={selectChatSession} onNewSession={createNewChatSession} onSubmit={(prompt) => void runAgent(prompt)} onCancel={() => void openclawRef.current.abort(agentSettings.openclawEndpoint, agentSettings.openclawToken, activeChatSession.openclawSessionKey ?? "")} onApprove={() => undefined} onReject={() => undefined} onClose={() => setAssistantOpen(false)} /> : null}</AnimatePresence>
      <AnimatePresence>{notice ? <motion.div className={`app-notice ${notice.tone}`} role="status" initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} onAnimationComplete={() => window.setTimeout(() => setNotice(null), 4200)}>{notice.tone === "success" ? <CheckCircle2 /> : <AlertCircle />}<span>{notice.message}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message"><X /></button></motion.div> : null}</AnimatePresence>
    </main>
    </MotionConfig>
  );
}
