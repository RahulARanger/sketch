import { invoke } from "@tauri-apps/api/core";
import type { AgentTransport, OllamaRequest, OllamaResponse } from "./types.ts";

export const nativeOllamaTransport: AgentTransport = (endpoint, request, signal) => {
  const task = invoke<OllamaResponse>("ollama_chat", { endpoint, request: JSON.stringify(request) });
  return Promise.race([task, new Promise<OllamaResponse>((_, reject) => {
    if (signal.aborted) reject(new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
  })]);
};

export async function listOllamaModels(endpoint: string) {
  return invoke<Array<{ name: string; model: string }>>("ollama_tags", { endpoint });
}

export async function testOllama(endpoint: string) {
  await listOllamaModels(endpoint);
  return true;
}

export async function searchWikimediaImages(query: string, limit = 8) {
  return invoke<Array<{ url: string; title: string; author?: string; license?: string; sourcePage?: string }>>("search_wikimedia_images", { query, limit });
}

export async function downloadRemoteImage(url: string) {
  return invoke<{ data: string; mimeType: string }>("download_remote_asset", { url });
}
