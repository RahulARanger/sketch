const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
// drive.file permits app-created uploads; metadata.readonly is needed to browse
// the user's existing folder hierarchy without requesting access to file content.
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.metadata.readonly";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

type GoogleTokenResponse = { access_token?: string; expires_in?: number; error?: string; error_description?: string };
type GoogleTokenClient = { requestAccessToken: (options?: { prompt?: string }) => void };

declare global {
  interface Window {
    google?: {
      accounts: { oauth2: { initTokenClient: (options: { client_id: string; scope: string; callback: (response: GoogleTokenResponse) => void; error_callback?: (error: { message?: string }) => void }) => GoogleTokenClient } };
    };
  }
}

export type DriveFolder = { id: string; name: string; modifiedTime?: string };
export type DriveFile = { id: string; name: string; mimeType?: string; modifiedTime?: string };
export type DriveAccount = { email: string; name: string; picture?: string };

let accessToken: string | null = null;
let tokenExpiresAt = 0;
let scriptPromise: Promise<void> | null = null;

export function getGoogleClientId() {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.VITE_GOOGLE_CLIENT_ID?.trim() ?? "";
}
export function isGoogleDriveConfigured() { return Boolean(getGoogleClientId()); }
export function isGoogleDriveConnected() { return Boolean(accessToken && tokenExpiresAt > Date.now()); }
export function disconnectGoogleDrive() { accessToken = null; tokenExpiresAt = 0; }

function loadGoogleIdentityServices() {
  if (window.google) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GOOGLE_IDENTITY_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google sign-in could not load."));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

async function requestToken(prompt: "consent" | "none" = "none") {
  if (accessToken && tokenExpiresAt > Date.now() + 30_000) return accessToken;
  const clientId = getGoogleClientId();
  if (!clientId) throw new Error("Google Drive is not configured yet. Add VITE_GOOGLE_CLIENT_ID to connect it.");
  await loadGoogleIdentityServices();
  if (!window.google) throw new Error("Google sign-in is unavailable in this window.");

  return new Promise<string>((resolve, reject) => {
    const client = window.google?.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (!response.access_token) { reject(new Error(response.error_description ?? response.error ?? "Google sign-in was cancelled.")); return; }
        accessToken = response.access_token;
        tokenExpiresAt = Date.now() + (response.expires_in ?? 3600) * 1000;
        resolve(response.access_token);
      },
      error_callback: (error) => reject(new Error(error.message ?? "Google sign-in was cancelled.")),
    });
    if (!client) { reject(new Error("Google sign-in is unavailable in this window.")); return; }
    client.requestAccessToken({ prompt });
  });
}

async function driveFetch<T>(url: string, init?: RequestInit) {
  const token = await requestToken();
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error((await response.text()) || `Google Drive returned ${response.status}.`);
  return response.json() as Promise<T>;
}

export async function connectGoogleDrive() {
  await requestToken("consent");
  return driveFetch<DriveAccount>("https://www.googleapis.com/oauth2/v3/userinfo");
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

export async function downloadDriveText(fileId: string) {
  const token = await requestToken();
  const response = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error((await response.text()) || `Google Drive returned ${response.status}.`);
  return response.text();
}

export async function createDriveFolder(parentId: string, name: string): Promise<DriveFolder> {
  return driveFetch<DriveFolder>(DRIVE_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }) });
}

export async function uploadDriveDocument(contents: string, fileName: string, folderId: string, existingFileId?: string) {
  const metadata = JSON.stringify({ name: fileName, mimeType: "application/json", ...(existingFileId ? {} : { parents: [folderId] }) });
  const body = new Blob([`--boundary\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--boundary\r\nContent-Type: application/json\r\n\r\n${contents}\r\n--boundary--`]);
  const endpoint = existingFileId ? `${DRIVE_UPLOAD_API}/${existingFileId}?uploadType=multipart` : `${DRIVE_UPLOAD_API}?uploadType=multipart`;
  return driveFetch<{ id: string; name: string; webViewLink?: string }>(endpoint, { method: existingFileId ? "PATCH" : "POST", headers: { "Content-Type": "multipart/related; boundary=boundary" }, body });
}
