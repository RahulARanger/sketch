const DRAFT_DATABASE = "bosketchobs-drafts-v1";
const DRAFT_STORE = "drafts";
const DRAFT_KEY = "current";

function openDraftDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DRAFT_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DRAFT_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open draft storage"));
  });
}

export async function readBrowserDraft(): Promise<string | null> {
  const database = await openDraftDatabase();
  if (!database) return null;
  return new Promise((resolve, reject) => {
    const request = database.transaction(DRAFT_STORE, "readonly").objectStore(DRAFT_STORE).get(DRAFT_KEY);
    request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : null);
    request.onerror = () => reject(request.error ?? new Error("Could not read browser draft"));
  });
}

export async function writeBrowserDraft(contents: string): Promise<void> {
  const database = await openDraftDatabase();
  if (!database) return;
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(DRAFT_STORE, "readwrite").objectStore(DRAFT_STORE).put(contents, DRAFT_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not save browser draft"));
  });
}

export async function removeBrowserDraft(): Promise<void> {
  const database = await openDraftDatabase();
  if (!database) return;
  await new Promise<void>((resolve, reject) => {
    const request = database.transaction(DRAFT_STORE, "readwrite").objectStore(DRAFT_STORE).delete(DRAFT_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("Could not remove browser draft"));
  });
}
