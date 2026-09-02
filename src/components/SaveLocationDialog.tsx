import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Check, ChevronRight, Cloud, ExternalLink, Folder, FolderPlus, HardDrive, LoaderCircle, LogOut, RefreshCw, X } from "lucide-react";
import { motion } from "motion/react";
import { connectGoogleDrive, createDriveFolder, disconnectGoogleDrive, getGoogleDriveAccount, isGoogleDriveConfigured, listDriveEntries, restoreGoogleDriveSession, type DriveAccount, type DriveFolder } from "../googleDrive";
import { SECTION_MANIFEST, WORKSPACE_MANIFEST, type SectionSaveLocation } from "../workspaceStorage";

export type SaveLocation = SectionSaveLocation;

type Props = { sectionTitle?: string; defaultFileName?: string; currentLocation: SaveLocation | null; onChoose: (location: SaveLocation) => void; onOpenDrive: (folderId: string, folderName: string) => Promise<void>; onDriveConnected?: (account: DriveAccount) => void; onClose: () => void; onPickLocal: () => Promise<string | null> };
type DriveView = { id: string; name: string };

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return fallback;
}

export function SaveLocationDialog({ sectionTitle = "this section", currentLocation, onOpenDrive, onDriveConnected, onClose, onPickLocal, onChoose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<"choose" | "drive">(currentLocation?.kind === "drive" ? "drive" : "choose");
  const [account, setAccount] = useState<DriveAccount | null>(null);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [hasWorkspace, setHasWorkspace] = useState(false);
  const [folderStack, setFolderStack] = useState<DriveView[]>([{ id: "root", name: "My Drive" }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const activeFolder = folderStack.at(-1) ?? { id: "root", name: "My Drive" };

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const loadFolders = async (folderId = activeFolder.id) => {
    setLoading(true); setError("");
    try {
      const entries = await listDriveEntries(folderId);
      setFolders(entries.filter((entry) => entry.mimeType === "application/vnd.google-apps.folder"));
      setHasWorkspace(entries.some((entry) => entry.name === WORKSPACE_MANIFEST || entry.name === SECTION_MANIFEST));
    }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load Google Drive folders."); }
    finally { setLoading(false); }
  };

  const openDrive = async () => {
    setMode("drive");
    if (!isGoogleDriveConfigured()) { setError("Google Drive is ready to connect. Add VITE_GOOGLE_CLIENT_ID to your environment first."); return; }
    setLoading(true); setError("");
    try {
      const restoredAccount = await restoreGoogleDriveSession();
      const nextAccount = restoredAccount ?? getGoogleDriveAccount() ?? await connectGoogleDrive();
      setAccount(nextAccount);
      onDriveConnected?.(nextAccount);
      await loadFolders("root");
    }
    catch (connectError) { setError(errorMessage(connectError, "Could not connect to Google Drive.")); setLoading(false); }
  };

  const selectFolder = async (folder: DriveFolder) => { setFolderStack((stack) => [...stack, { id: folder.id, name: folder.name }]); await loadFolders(folder.id); };
  const goToFolder = async (index: number) => { const nextStack = folderStack.slice(0, index + 1); setFolderStack(nextStack); await loadFolders(nextStack.at(-1)?.id ?? "root"); };
  const chooseDrive = () => onChoose({ kind: "drive", folderId: activeFolder.id, folderName: activeFolder.name, fileIds: currentLocation?.kind === "drive" ? currentLocation.fileIds : undefined });
  const addDriveFolder = async () => {
    if (!newFolderName.trim()) return;
    setLoading(true); setError("");
    try { const folder = await createDriveFolder(activeFolder.id, newFolderName.trim()); setNewFolderName(""); await selectFolder(folder); }
    catch (createError) { setError(createError instanceof Error ? createError.message : "Could not create the folder."); }
    finally { setLoading(false); }
  };

  return <motion.div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
    <motion.section className="save-location-dialog" role="dialog" aria-modal="true" aria-labelledby="save-location-title" initial={{ opacity: 0, y: 8, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.985 }} transition={{ type: "spring", stiffness: 420, damping: 30 }}>
      <header className="save-location-header"><div className="save-location-heading"><span className="save-location-icon"><Cloud /></span><div><h2 id="save-location-title">Choose folder for {sectionTitle}</h2><p>Each section keeps its own folder and save settings.</p></div></div><motion.button ref={closeRef} className="dialog-close" type="button" onClick={onClose} aria-label="Close save location" whileHover={{ rotate: 90 }} whileTap={{ scale: 0.9 }}><X /></motion.button></header>
      {mode === "choose" ? <div className="save-location-options">
        <motion.button className="location-option" type="button" onClick={async () => { const folderPath = await onPickLocal(); if (folderPath) onChoose({ kind: "local", folderPath }); }} whileHover={{ x: 4 }} whileTap={{ scale: 0.985 }}><span className="location-option-icon local"><HardDrive /></span><span><strong>On this computer</strong><small>Choose a folder for your sections and pages</small></span><ChevronRight /></motion.button>
        <motion.button className="location-option" type="button" onClick={() => void openDrive()} whileHover={{ x: 4 }} whileTap={{ scale: 0.985 }}><span className="location-option-icon drive"><Cloud /></span><span><strong>Google Drive</strong><small>Choose a Drive folder and sync from anywhere</small></span><ChevronRight /></motion.button>
      </div> : <div className="drive-picker">
        <div className="drive-picker-toolbar"><motion.button className="back-link" type="button" onClick={() => { setMode("choose"); setError(""); }} whileTap={{ scale: 0.97 }}><ArrowLeft /> Locations</motion.button><div className="drive-account">{account ? <><span className="account-avatar">{account.name.slice(0, 1).toUpperCase()}</span><span><strong>{account.name}</strong><small>{account.email}</small></span><motion.button className="icon-button" type="button" onClick={() => { disconnectGoogleDrive(); setAccount(null); setFolders([]); setError(""); }} aria-label="Disconnect Google Drive" title="Disconnect" whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.9 }}><LogOut /></motion.button></> : <span className="drive-not-connected">Google Drive</span>}</div></div>
        {!account && !loading ? <div className="drive-connect-state"><span className="drive-connect-icon"><Cloud /></span><h3>Connect Google Drive</h3><p>Sign in once to browse folders and save your sketch directly to Drive.</p>{error ? <div className="integration-alert"><AlertCircle /><span>{error}</span></div> : null}<button className="google-connect-button" type="button" onClick={() => void openDrive()} disabled={!isGoogleDriveConfigured()}><span className="google-glyph">G</span>{isGoogleDriveConfigured() ? "Continue with Google" : "Add Google client ID to connect"}</button><small className="integration-note">Uses Drive file access only. Your other Drive files stay private.</small></div> : <>
          <div className="drive-breadcrumbs">{folderStack.map((folder, index) => <span key={folder.id}><button type="button" onClick={() => void goToFolder(index)}>{folder.name}</button>{index < folderStack.length - 1 ? <ChevronRight /> : null}</span>)}</div>
          {error ? <div className="integration-alert"><AlertCircle /><span>{error}</span></div> : null}
          <div className="folder-list" aria-live="polite">{loading ? <div className="folder-loading"><LoaderCircle /><span>Loading folders…</span></div> : folders.length ? folders.map((folder) => <motion.button className="folder-row" key={folder.id} type="button" onClick={() => void selectFolder(folder)} whileHover={{ x: 3 }} whileTap={{ scale: 0.985 }}><Folder /><span>{folder.name}</span><ChevronRight /></motion.button>) : <div className="folder-empty"><Folder /><strong>No folders here yet</strong><span>Create a folder or save this notebook in {activeFolder.name}.</span></div>}</div>
          <div className="save-location-footer"><label className="file-name-field"><span>New folder</span><input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void addDriveFolder(); }} placeholder="e.g. Semester 1" spellCheck={false} /></label><motion.button className="drive-new-folder-button" type="button" onClick={() => void addDriveFolder()} disabled={loading || !newFolderName.trim()} whileTap={{ scale: 0.97 }}><FolderPlus /> Create folder</motion.button>{hasWorkspace ? <motion.button className="drive-open-button" type="button" onClick={() => void onOpenDrive(activeFolder.id, activeFolder.name)} disabled={loading} whileTap={{ scale: 0.97 }}><Folder /> Open workspace</motion.button> : null}<motion.button className="drive-save-button" type="button" onClick={chooseDrive} disabled={loading} whileTap={{ scale: 0.97 }}><Check /> Use {activeFolder.name}</motion.button></div>
        </>}
        {account ? <motion.button className="drive-refresh" type="button" onClick={() => void loadFolders()} disabled={loading} whileTap={{ scale: 0.97 }}><RefreshCw /> Refresh folders <ExternalLink /></motion.button> : null}
      </div>}
    </motion.section>
  </motion.div>;
}
