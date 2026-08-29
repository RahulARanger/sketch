import type { ImageSource, NotePage, SketchDocument } from "../types";

export type AgentSettings = {
  enabled: boolean;
  endpoint: string;
  model: string;
  visionModel: string;
  maxSteps: number;
  autoApplySafe: boolean;
  allowOnlineImages: boolean;
  includePageImage: boolean;
};

export type AgentStatus = "idle" | "running" | "waiting" | "completed" | "failed" | "cancelled";

export type AgentMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  status?: "running" | "applied" | "rejected" | "failed";
};

export type AgentPendingAction = {
  name: string;
  args: Record<string, unknown>;
  description: string;
};

export type AgentRunResult = {
  status: Exclude<AgentStatus, "idle" | "running">;
  answer: string;
  document: SketchDocument;
  messages: AgentMessage[];
  pendingAction?: AgentPendingAction;
  error?: string;
};

export type WikimediaImage = {
  url: string;
  title: string;
  author?: string;
  license?: string;
  sourcePage?: string;
};

export type DownloadedAsset = { data: string; mimeType: string };

export type AgentTransport = (endpoint: string, request: OllamaRequest, signal: AbortSignal) => Promise<OllamaResponse>;

export type OllamaRequest = {
  model: string;
  messages: OllamaMessage[];
  tools: OllamaToolDefinition[];
  stream: false;
};

export type OllamaMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  images?: string[];
  tool_name?: string;
  tool_calls?: OllamaToolCall[];
};

export type OllamaToolCall = { function: { name: string; arguments: Record<string, unknown> | string } };

export type OllamaToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type OllamaResponse = { message?: OllamaMessage };

export type AgentDependencies = {
  transport?: AgentTransport;
  snapshot?: (page: NotePage) => string;
  searchImages?: (query: string) => Promise<WikimediaImage[]>;
  downloadImage?: (url: string) => Promise<DownloadedAsset>;
};

export type ImageSourceWithData = ImageSource & { data: string; mimeType: string };
