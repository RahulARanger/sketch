import type { AgentMessage } from "./types.ts";

type GatewayFrame = {
  type: "req" | "res" | "event";
  id?: string;
  method?: string;
  params?: unknown;
  ok?: boolean;
  payload?: unknown;
  error?: { message?: string; code?: string };
  event?: string;
};

type RunWaiter = {
  runId: string;
  text: string;
  onDelta?: (text: string) => void;
  resolve: (text: string) => void;
  reject: (error: Error) => void;
  timer: number;
};

const DEFAULT_TIMEOUT = 120_000;
const DEVICE_IDENTITY_KEY = "bosketchobs-openclaw-device-v1";

type DeviceIdentity = { deviceId: string; publicKey: string; privateKey: string };

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  view.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadDeviceIdentity(): Promise<DeviceIdentity> {
  try {
    const stored = JSON.parse(localStorage.getItem(DEVICE_IDENTITY_KEY) ?? "null") as Partial<DeviceIdentity> | null;
    if (stored?.deviceId && stored.publicKey && stored.privateKey) {
      const publicKey = base64UrlDecode(stored.publicKey);
      if (publicKey.length === 32 && (await sha256Hex(publicKey)) === stored.deviceId) return stored as DeviceIdentity;
    }
  } catch {
    // Generate a fresh identity when stored browser data is unavailable or invalid.
  }
  const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const publicKey = base64UrlEncode(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const privateKey = base64UrlEncode(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  const identity = { deviceId: await sha256Hex(base64UrlDecode(publicKey)), publicKey, privateKey };
  localStorage.setItem(DEVICE_IDENTITY_KEY, JSON.stringify(identity));
  return identity;
}

async function signDevicePayload(identity: DeviceIdentity, payload: string) {
  const privateKey = await crypto.subtle.importKey("pkcs8", base64UrlDecode(identity.privateKey), { name: "Ed25519" }, false, ["sign"]);
  return base64UrlEncode(await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(payload)));
}

async function makeDeviceProof(identity: DeviceIdentity, nonce: string, signedAt: number, token: string) {
  const clientId = "openclaw-control-ui";
  const clientMode = "webchat";
  const role = "operator";
  const scopes = ["operator.read", "operator.write"];
  // v2 is accepted by current Gateways and keeps this lightweight client
  // compatible with the shipped browser Control UI.
  const payload = ["v2", identity.deviceId, clientId, clientMode, role, scopes.join(","), String(signedAt), token, nonce].join("|");
  return { id: identity.deviceId, publicKey: identity.publicKey, signature: await signDevicePayload(identity, payload), signedAt, nonce };
}

function normalizeEndpoint(endpoint: string) {
  const value = endpoint.trim();
  if (!value) return "ws://127.0.0.1:18789";
  if (/^wss?:\/\//i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value.replace(/^http/i, "ws");
  return `ws://${value}`;
}

function messageText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item) => messageText(typeof item === "object" && item !== null && "text" in item ? (item as { text?: unknown }).text : item)).join("");
  if (value && typeof value === "object" && "content" in value) return messageText((value as { content?: unknown }).content);
  return "";
}

function errorFromFrame(frame: GatewayFrame) {
  return new Error(frame.error?.message || frame.error?.code || "OpenClaw Gateway request failed.");
}

export class OpenClawGateway {
  private socket: WebSocket | null = null;
  private connectedEndpoint = "";
  private requestCounter = 0;
  private readonly pending = new Map<string, { resolve: (payload: unknown) => void; reject: (error: Error) => void; timer: number }>();
  private readonly runs = new Map<string, RunWaiter>();
  private connectPromise: Promise<void> | null = null;

  async connect(endpoint: string, token: string, signal?: AbortSignal) {
    const url = normalizeEndpoint(endpoint);
    if (this.socket?.readyState === WebSocket.OPEN && this.connectedEndpoint === url) return;
    this.disconnect();
    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      let connectSent = false;
      let settled = false;
      let fallbackTimer: number | undefined;

      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        if (fallbackTimer) window.clearTimeout(fallbackTimer);
        reject(error);
      };
      const sendConnect = async (challenge?: { nonce?: string; ts?: number }) => {
        if (connectSent || socket.readyState !== WebSocket.OPEN) return;
        connectSent = true;
        const identity = await loadDeviceIdentity();
        const sharedToken = token.trim();
        const params: Record<string, unknown> = {
          minProtocol: 4,
          maxProtocol: 4,
          client: { id: "openclaw-control-ui", version: "0.1.0", platform: "macos", mode: "webchat" },
          role: "operator",
          scopes: ["operator.read", "operator.write"],
          caps: ["tool-events"],
          commands: [],
          permissions: {},
          locale: navigator.language,
          userAgent: navigator.userAgent,
        };
        params.device = await makeDeviceProof(identity, challenge?.nonce ?? "", challenge?.ts ?? Date.now(), sharedToken);
        if (sharedToken) params.auth = { token: sharedToken };
        const id = this.nextId();
        this.pending.set(id, { resolve: (payload) => {
          settled = true;
          if (fallbackTimer) window.clearTimeout(fallbackTimer);
          this.connectedEndpoint = url;
          resolve();
          void payload;
        }, reject: finishReject, timer: window.setTimeout(() => finishReject(new Error("OpenClaw Gateway handshake timed out.")), 15_000) });
        socket.send(JSON.stringify({ type: "req", id, method: "connect", params } satisfies GatewayFrame));
      };

      socket.onopen = () => {
        // Current Gateways send a connect.challenge first. The fallback keeps the
        // adapter compatible with older local Gateway builds that predate it.
        fallbackTimer = window.setTimeout(() => { void sendConnect(); }, 750);
      };
      socket.onmessage = (event) => {
        let frame: GatewayFrame;
        try { frame = JSON.parse(String(event.data)) as GatewayFrame; } catch { return; }
        if (frame.type === "event" && frame.event === "connect.challenge") {
          const challenge = frame.payload as { nonce?: string; ts?: number } | undefined;
          void sendConnect(challenge);
          return;
        }
        this.handleFrame(frame);
      };
      socket.onerror = () => finishReject(new Error("Could not connect to the OpenClaw Gateway."));
      socket.onclose = () => { if (!settled) finishReject(new Error("OpenClaw Gateway connection closed.")); };
      signal?.addEventListener("abort", () => { this.disconnect(); finishReject(new DOMException("Cancelled", "AbortError")); }, { once: true });
    });
    try { await this.connectPromise; } finally { this.connectPromise = null; }
  }

  disconnect() {
    this.socket?.close();
    this.socket = null;
    this.connectedEndpoint = "";
    for (const pending of this.pending.values()) { window.clearTimeout(pending.timer); pending.reject(new Error("OpenClaw Gateway disconnected.")); }
    this.pending.clear();
    for (const run of this.runs.values()) { window.clearTimeout(run.timer); run.reject(new Error("OpenClaw Gateway disconnected.")); }
    this.runs.clear();
  }

  async test(endpoint: string, token: string) {
    await this.connect(endpoint, token);
    await this.request("health", {});
    return true;
  }

  async createSession(endpoint: string, token: string, title: string) {
    await this.connect(endpoint, token);
    const payload = await this.request("sessions.create", { agentId: "main", label: title });
    const value = payload as { sessionKey?: string; key?: string; session?: { sessionKey?: string; key?: string } };
    const sessionKey = value.sessionKey ?? value.key ?? value.session?.sessionKey ?? value.session?.key;
    if (!sessionKey) throw new Error("OpenClaw created the session but did not return a session key.");
    return sessionKey;
  }

  async history(endpoint: string, token: string, sessionKey: string) {
    await this.connect(endpoint, token);
    const payload = await this.request("chat.history", { sessionKey, limit: 100 }) as { messages?: Array<{ role?: string; content?: unknown }> };
    return (payload.messages ?? []).flatMap((message): AgentMessage[] => {
      if (message.role !== "user" && message.role !== "assistant" && message.role !== "tool") return [];
      return [{ role: message.role, content: messageText(message.content) }];
    });
  }

  async send(endpoint: string, token: string, sessionKey: string, message: string, onDelta?: (text: string) => void, signal?: AbortSignal) {
    await this.connect(endpoint, token, signal);
    const runId = crypto.randomUUID();
    const result = new Promise<string>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.runs.delete(runId);
        reject(new Error("OpenClaw did not finish the agent run within two minutes."));
      }, DEFAULT_TIMEOUT);
      this.runs.set(runId, { runId, text: "", onDelta, resolve, reject, timer });
    });
    try {
      await this.request("chat.send", { sessionKey, message, idempotencyKey: runId });
      signal?.addEventListener("abort", () => { void this.abort(endpoint, token, sessionKey, runId); }, { once: true });
      return await result;
    } catch (error) {
      this.runs.delete(runId);
      throw error;
    }
  }

  async abort(endpoint: string, token: string, sessionKey: string, runId?: string) {
    await this.connect(endpoint, token);
    await this.request("chat.abort", { sessionKey, ...(runId ? { runId } : {}) });
  }

  private nextId() { this.requestCounter += 1; return `bosketch-${this.requestCounter}`; }

  private async request(method: string, params: unknown) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("OpenClaw Gateway is not connected.");
    const id = this.nextId();
    return new Promise<unknown>((resolve, reject) => {
      const timer = window.setTimeout(() => { this.pending.delete(id); reject(new Error(`OpenClaw request timed out: ${method}`)); }, DEFAULT_TIMEOUT);
      this.pending.set(id, { resolve, reject, timer });
      this.socket?.send(JSON.stringify({ type: "req", id, method, params } satisfies GatewayFrame));
    });
  }

  private handleFrame(frame: GatewayFrame) {
    if (frame.type === "res" && frame.id) {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      this.pending.delete(frame.id);
      window.clearTimeout(pending.timer);
      if (frame.ok === false) pending.reject(errorFromFrame(frame));
      else pending.resolve(frame.payload);
      return;
    }
    if (frame.type !== "event" || (frame.event !== "chat" && frame.event !== "agent")) return;
    const payload = (frame.payload ?? {}) as { runId?: string; state?: string; status?: string; deltaText?: string; message?: unknown; error?: string };
    const runId = payload.runId;
    if (!runId) return;
    const run = this.runs.get(runId);
    if (!run) return;
    const delta = payload.deltaText ?? (payload.state === "delta" ? messageText(payload.message) : "");
    if (delta) { run.text += delta; run.onDelta?.(run.text); }
    const final = ["final", "done", "completed", "error", "failed"].includes(payload.state ?? "") || ["ok", "error", "failed"].includes(payload.status ?? "");
    if (!final) return;
    this.runs.delete(runId);
    window.clearTimeout(run.timer);
    if (payload.error || payload.state === "error" || payload.status === "error" || payload.status === "failed") run.reject(new Error(payload.error || "OpenClaw agent run failed."));
    else run.resolve(messageText(payload.message) || run.text || "OpenClaw completed the task.");
  }
}
