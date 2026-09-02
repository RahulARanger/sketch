import { invoke } from "@tauri-apps/api/core";
import type { AgentTransport, OllamaRequest, OllamaResponse } from "./types.ts";

const isTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const ollamaUrl = (endpoint: string, path: string) =>
  `${endpoint.replace(/\/+$/, "")}${path}`;

const readOllamaError = async (response: Response) => {
  const body = await response.text();
  return `Ollama returned ${response.status}${body ? `: ${body}` : ""}`;
};

const browserOllamaTransport: AgentTransport = async (
  endpoint,
  request,
  signal,
) => {
  const response = await fetch(ollamaUrl(endpoint, "/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    throw new Error(await readOllamaError(response));
  }

  return (await response.json()) as OllamaResponse;
};

export const nativeOllamaTransport: AgentTransport = (endpoint, request, signal) => {
  if (!isTauriRuntime()) {
    return browserOllamaTransport(endpoint, request, signal);
  }

  const task = invoke<OllamaResponse>("ollama_chat", { endpoint, request: JSON.stringify(request) });
  return Promise.race([task, new Promise<OllamaResponse>((_, reject) => {
    if (signal.aborted) reject(new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
  })]);
};

export async function listOllamaModels(endpoint: string) {
  if (!isTauriRuntime()) {
    const response = await fetch(ollamaUrl(endpoint, "/api/tags"));
    if (!response.ok) {
      throw new Error(await readOllamaError(response));
    }

    const payload = (await response.json()) as {
      models?: Array<{ name: string; model: string }>;
    };
    return payload.models ?? [];
  }

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
