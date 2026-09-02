// drive.file permits app-created uploads; metadata.readonly is needed to browse
// the user's existing folder hierarchy without requesting access to file content.
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

import { invoke } from "@tauri-apps/api/core";

export type DriveFolder = { id: string; name: string; modifiedTime?: string };
export type DriveFile = { id: string; name: string; mimeType?: string; modifiedTime?: string };
export type DriveAccount = { email: string; name: string; picture?: string };
export type DriveNotebook = { id: string; name: string; modifiedTime?: string; kind: "workspace" | "section" };

let accessToken: string | null = null;
let tokenExpiresAt = 0;
let refreshToken: string | null = null;
let account: DriveAccount | null = null;
const DRIVE_SESSION_KEY = "bosketchobs-google-session-v1";

export function getGoogleClientId() {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";
}
export function getGoogleClientSecret() {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_GOOGLE_CLIENT_SECRET?.trim() ?? "";
}
export function isGoogleDriveConfigured() { return Boolean(getGoogleClientId()); }
export function getGoogleDriveAccount() { return account; }
export function isGoogleDriveConnected() { return Boolean(accessToken && tokenExpiresAt > Date.now()); }
export function disconnectGoogleDrive() { accessToken = null; refreshToken = null; account = null; tokenExpiresAt = 0; localStorage.removeItem(DRIVE_SESSION_KEY); }

function restoreSession() {
  if (account || typeof localStorage === "undefined") return;
  try {
    const stored = JSON.parse(localStorage.getItem(DRIVE_SESSION_KEY) ?? "null") as { refreshToken?: string; account?: DriveAccount } | null;
    if (stored?.refreshToken && stored.account) { refreshToken = stored.refreshToken; account = stored.account; }
  } catch { /* stale session */ }
}

async function requestToken() {
  if (accessToken && tokenExpiresAt > Date.now() + 30_000) return accessToken;
  restoreSession();
  if (refreshToken) {
    const result = await invoke<{ access_token: string; expires_in?: number }>("google_drive_refresh", { clientId: getGoogleClientId(), clientSecret: getGoogleClientSecret(), refreshToken });
    accessToken = result.access_token;
    tokenExpiresAt = Date.now() + (result.expires_in ?? 3600) * 1000;
    return accessToken;
  }
  throw new Error("Google Drive authorization expired. Connect Google Drive again.");
}

async function driveFetch<T>(url: string, init?: RequestInit) {
  const token = await requestToken();
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error((await response.text()) || `Google Drive returned ${response.status}.`);
  return response.json() as Promise<T>;
}

export async function connectGoogleDrive() {
  const result = await invoke<{ access_token: string; expires_in?: number; account: DriveAccount }>("google_drive_oauth", { clientId: getGoogleClientId(), clientSecret: getGoogleClientSecret(), scope: DRIVE_SCOPE });
  accessToken = result.access_token;
  tokenExpiresAt = Date.now() + (result.expires_in ?? 3600) * 1000;
  account = result.account;
  // The refresh token is returned by the OAuth exchange and stored locally so
  // the desktop app can renew the session without showing sign-in again.
  const refreshed = result as typeof result & { refresh_token?: string };
  if (refreshed.refresh_token) refreshToken = refreshed.refresh_token;
  localStorage.setItem(DRIVE_SESSION_KEY, JSON.stringify({ refreshToken, account }));
  return result.account;
}

export async function restoreGoogleDriveSession() {
  restoreSession();
  if (!refreshToken || !account) return null;
  try { await requestToken(); return account; } catch { disconnectGoogleDrive(); return null; }
}

export async function listDriveFolders(parentId = "root") {
  const query = encodeURIComponent(`'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const result = await driveFetch<{ files: DriveFolder[] }>(`${DRIVE_API}/files?q=${query}&fields=files(id,name,modifiedTime)&orderBy=name&pageSize=100`);
  return result.files ?? [];
}

export async function listDriveEntries(parentId = "root") {
  const query = encodeURIComponent(`'${parentId}' in parents and trashed = false`);
  const result = await driveFetch<{ files: DriveFile[] }>(`${DRIVE_API}/files?q=${query}&fields=files(id,name,mimeType,modifiedTime)&orderBy=folder,name&pageSize=200`);
  return result.files ?? [];
}

export async function listDriveNotebooks(): Promise<DriveNotebook[]> {
  const rootEntries = await listDriveEntries("root");
  const folders = rootEntries.filter((entry) => entry.mimeType === "application/vnd.google-apps.folder");
  const notebooks: DriveNotebook[] = [];
  await Promise.all(folders.map(async (folder) => {
    const entries = await listDriveEntries(folder.id);
    const manifest = entries.find((entry) => entry.name === WORKSPACE_MANIFEST_NAME);
    const section = entries.find((entry) => entry.name === SECTION_MANIFEST_NAME);
    if (manifest) notebooks.push({ id: folder.id, name: folder.name, modifiedTime: folder.modifiedTime, kind: "workspace" });
    else if (section) notebooks.push({ id: folder.id, name: folder.name, modifiedTime: folder.modifiedTime, kind: "section" });
  }));
  return notebooks.sort((a, b) => a.name.localeCompare(b.name));
}

const WORKSPACE_MANIFEST_NAME = "bosketchobs-workspace.json";
const SECTION_MANIFEST_NAME = "bosketchobs-section.json";

export async function downloadDriveText(fileId: string) {
  const token = await requestToken();
  const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error((await response.text()) || `Google Drive returned ${response.status}.`);
  return response.text();
}

export async function createDriveFolder(parentId: string, name: string): Promise<DriveFolder> {
  return driveFetch<DriveFolder>(`${DRIVE_API}/files`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }) });
}

export async function uploadDriveDocument(contents: string, fileName: string, folderId: string, existingFileId?: string) {
  const metadata = JSON.stringify({ name: fileName, mimeType: "application/json", ...(existingFileId ? {} : { parents: [folderId] }) });
  const body = new Blob([`--boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--boundary\r\nContent-Type: application/json\r\n\r\n${contents}\r\n--boundary--`]);
  const endpoint = existingFileId ? `${DRIVE_UPLOAD_API}/${existingFileId}?uploadType=multipart` : `${DRIVE_UPLOAD_API}?uploadType=multipart`;
  return driveFetch<{ id: string; name: string; webViewLink?: string }>(endpoint, { method: existingFileId ? "PATCH" : "POST", headers: { "Content-Type": "multipart/related; boundary=boundary" }, body });
}
