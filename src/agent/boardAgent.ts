import { z } from "zod";
import { createBlankPage } from "../data.ts";
import { WORLD_ORIGIN } from "../canvasNavigation.ts";
import type { ImageBlock, NotePage, Point, SketchDocument, Stroke } from "../types.ts";
import { nativeOllamaTransport, downloadRemoteImage, searchWikimediaImages } from "./ollama.ts";
import { renderPageSnapshot } from "./pageSnapshot.ts";
import type { AgentDependencies, AgentMessage, AgentPendingAction, AgentRunResult, AgentSettings, OllamaMessage, OllamaToolCall, OllamaToolDefinition } from "./types.ts";

const schemas = {
  read_active_page: z.object({}),
  search_pages: z.object({ query: z.string().trim().min(1).max(200) }),
  inspect_page_drawing: z.object({}),
  add_text: z.object({ text: z.string().min(1).max(10_000), x: z.number().finite().optional(), y: z.number().finite().optional(), width: z.number().finite().min(120).max(1_200).optional() }),
  edit_text: z.object({ id: z.string().min(1), text: z.string().max(10_000) }),
  move_content: z.object({ kind: z.enum(["text", "stroke", "image"]), id: z.string().min(1), dx: z.number().finite().min(-20_000).max(20_000), dy: z.number().finite().min(-20_000).max(20_000) }),
  create_page: z.object({ title: z.string().trim().min(1).max(120) }),
  create_diagram: z.object({ title: z.string().trim().max(200).optional(), x: z.number().finite().optional(), y: z.number().finite().optional(), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional(), primitives: z.array(z.object({ kind: z.enum(["line", "rect", "circle", "arrow"]), x: z.number().finite(), y: z.number().finite(), x2: z.number().finite().optional(), y2: z.number().finite().optional(), width: z.number().finite().min(1).max(40).optional(), height: z.number().finite().min(1).max(2_000).optional(), radius: z.number().finite().min(1).max(1_000).optional() })).min(1).max(80) }),
  insert_image: z.object({ query: z.string().trim().min(2).max(200), x: z.number().finite().optional(), y: z.number().finite().optional(), width: z.number().finite().min(100).max(2_000).optional(), height: z.number().finite().min(100).max(2_000).optional(), alt: z.string().max(300).optional() }),
  delete_content: z.object({ kind: z.enum(["text", "stroke", "image", "page"]), id: z.string().min(1) }),
} as const;

const definitionSeeds: Array<[string, string, Record<string, unknown>]> = [
  ["read_active_page", "Read the active page's title, text, images, and drawing summary.", {}],
  ["search_pages", "Search all pages by title or typed text.", { type: "object", required: ["query"], properties: { query: { type: "string" } } }],
  ["inspect_page_drawing", "Inspect the active page's drawing geometry and visual snapshot.", {}],
  ["add_text", "Add a typed text block to the active page. Coordinates are page coordinates.", { type: "object", required: ["text"], properties: { text: { type: "string" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" } } }],
  ["edit_text", "Replace the contents of an existing text block by id.", { type: "object", required: ["id", "text"], properties: { id: { type: "string" }, text: { type: "string" } } }],
  ["move_content", "Move one text, stroke, or image item by a delta.", { type: "object", required: ["kind", "id", "dx", "dy"], properties: { kind: { type: "string", enum: ["text", "stroke", "image"] }, id: { type: "string" }, dx: { type: "number" }, dy: { type: "number" } } }],
  ["create_page", "Create a new page in the active section.", { type: "object", required: ["title"], properties: { title: { type: "string" } } }],
  ["create_diagram", "Create a bounded vector diagram using line, rect, circle, or arrow primitives.", { type: "object", required: ["primitives"], properties: { title: { type: "string" }, x: { type: "number" }, y: { type: "number" }, color: { type: "string" }, primitives: { type: "array", maxItems: 80, items: { type: "object", required: ["kind", "x", "y"], properties: { kind: { type: "string", enum: ["line", "rect", "circle", "arrow"] }, x: { type: "number" }, y: { type: "number" }, x2: { type: "number" }, y2: { type: "number" }, width: { type: "number" }, height: { type: "number" }, radius: { type: "number" } } } } } }],
  ["insert_image", "Find an openly licensed Wikimedia image and place it on the active page.", { type: "object", required: ["query"], properties: { query: { type: "string" }, x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, alt: { type: "string" } } }],
  ["delete_content", "Delete a page or one content item. Always requires user confirmation.", { type: "object", required: ["kind", "id"], properties: { kind: { type: "string", enum: ["text", "stroke", "image", "page"] }, id: { type: "string" } } }],
];
const definitions: OllamaToolDefinition[] = definitionSeeds.map(([name, description, parameters]) => ({ type: "function", function: { name, description, parameters: { type: "object", ...parameters } } }));

const toolNames = new Set(Object.keys(schemas));
const destructiveTools = new Set(["delete_content"]);

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function now() { return new Date().toISOString(); }
function clamp(value: number, min = -20_000, max = 20_000) { return Math.max(min, Math.min(max, value)); }
function pageFor(document: SketchDocument, sectionId: string, pageId: string) {
  const section = document.sections.find((item) => item.id === sectionId);
  return section ? { section, page: section.pages.find((item) => item.id === pageId) } : { section: undefined, page: undefined };
}
function updatePage(document: SketchDocument, sectionId: string, pageId: string, updater: (page: NotePage) => NotePage) {
  return { ...document, sections: document.sections.map((section) => section.id === sectionId ? { ...section, pages: section.pages.map((page) => page.id === pageId ? updater(page) : page) } : section), updatedAt: now() };
}
function parseArguments(value: unknown) {
  if (typeof value === "string") return JSON.parse(value) as unknown;
  return value;
}
function drawingSummary(page: NotePage) {
  return { strokeCount: page.strokes.length, pointCount: page.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0), textCount: page.textBlocks.length, imageCount: page.imageBlocks?.length ?? 0, strokes: page.strokes.slice(0, 60).map((stroke) => ({ id: stroke.id, color: stroke.color, width: stroke.width, points: stroke.points.slice(0, 120) })) };
}
function toolResult(value: unknown) { return JSON.stringify(value); }

type InternalState = { document: SketchDocument; originalFingerprint: string; messages: OllamaMessage[]; uiMessages: AgentMessage[]; settings: AgentSettings; sectionId: string; pageId: string; steps: number; pending?: { call: OllamaToolCall; name: string; args: Record<string, unknown>; description: string }; controller: AbortController; onProgress?: (messages: AgentMessage[]) => void };

export class BoardAgent {
  private state: InternalState | null = null;
  private readonly deps: Required<Pick<AgentDependencies, "transport" | "snapshot" | "searchImages" | "downloadImage">>;

  constructor(deps: AgentDependencies = {}) {
    this.deps = { transport: deps.transport ?? nativeOllamaTransport, snapshot: deps.snapshot ?? renderPageSnapshot, searchImages: deps.searchImages ?? searchWikimediaImages, downloadImage: deps.downloadImage ?? downloadRemoteImage };
  }

  async run(prompt: string, document: SketchDocument, sectionId: string, pageId: string, settings: AgentSettings, onProgress?: (messages: AgentMessage[]) => void): Promise<AgentRunResult> {
    this.state?.controller.abort();
    const current = clone(document);
    const { page } = pageFor(current, sectionId, pageId);
    if (!page) return { status: "failed", answer: "The active page could not be found.", document: current, messages: [], error: "Active page not found" };
    const context = { documentTitle: current.title, activeSection: current.sections.find((section) => section.id === sectionId)?.title, activePage: { id: page.id, title: page.title, textBlocks: page.textBlocks, imageBlocks: (page.imageBlocks ?? []).map(({ src: _src, ...metadata }) => metadata), drawing: drawingSummary(page) } };
    const firstMessage: OllamaMessage = { role: "user", content: `${prompt}\n\nBoard context:\n${toolResult(context)}` };
    if (settings.includePageImage && settings.visionModel) firstMessage.images = [this.deps.snapshot(page)];
    this.state = { document: current, originalFingerprint: JSON.stringify(document), messages: [{ role: "system", content: "You are the BoSketchObs board agent. Use board tools to answer questions and make precise, bounded edits. Never invent IDs. Coordinates are page coordinates; strokes use the app's vector format. Explain what you changed after completing the task." }, firstMessage], uiMessages: [{ role: "user", content: prompt }], settings, sectionId, pageId, steps: 0, controller: new AbortController(), onProgress };
    this.notify();
    return this.loop();
  }

  cancel() { this.state?.controller.abort(); }

  isStaleAgainst(document: SketchDocument) {
    return Boolean(this.state && this.state.originalFingerprint !== JSON.stringify(document));
  }

  async resume(approved: boolean): Promise<AgentRunResult | null> {
    const state = this.state;
    if (!state?.pending) return null;
    const pending = state.pending;
    state.pending = undefined;
    if (approved) {
      try {
        const result = await this.execute(pending.name, pending.args);
      state.messages.push({ role: "tool", tool_name: pending.name, content: result });
        state.uiMessages.push({ role: "tool", toolName: pending.name, content: result, status: "applied" });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        state.messages.push({ role: "tool", tool_name: pending.name, content: message });
        state.uiMessages.push({ role: "tool", toolName: pending.name, content: message, status: "failed" });
        return this.result("failed", "I couldn’t apply the approved change.", undefined, message);
      }
    } else {
      const result = "The user rejected this action.";
      state.messages.push({ role: "tool", tool_name: pending.name, content: result });
      state.uiMessages.push({ role: "tool", toolName: pending.name, content: result, status: "rejected" });
    }
    this.notify();
    return this.loop();
  }

  private async loop(): Promise<AgentRunResult> {
    const state = this.state!;
    try {
      while (state.steps < Math.max(1, Math.min(12, state.settings.maxSteps))) {
        state.steps += 1;
        const response = await this.deps.transport(state.settings.endpoint, { model: state.settings.includePageImage && state.settings.visionModel ? state.settings.visionModel : state.settings.model, messages: state.messages, tools: definitions, stream: false }, state.controller.signal);
        const message = response.message;
        if (!message) throw new Error("Ollama returned no message.");
        state.messages.push(message);
        this.notify();
        const calls = message.tool_calls ?? [];
        if (!calls.length) return this.result("completed", message.content || "Completed the board task.");
        for (const call of calls) {
          const rawName = call.function?.name;
          if (!rawName || !toolNames.has(rawName)) {
            state.messages.push({ role: "tool", tool_name: rawName ?? "unknown", content: "Unknown tool. Choose one of the provided tools." });
            continue;
          }
          const args = parseArguments(call.function.arguments) as Record<string, unknown>;
          const parsed = schemas[rawName as keyof typeof schemas].safeParse(args);
          if (!parsed.success) {
            const error = `Invalid arguments for ${rawName}: ${parsed.error.issues.map((issue) => issue.path.join(".") + " " + issue.message).join(", ")}`;
            state.messages.push({ role: "tool", tool_name: rawName, content: error });
            state.uiMessages.push({ role: "tool", toolName: rawName, content: error, status: "failed" });
            this.notify();
            continue;
          }
          const needsApproval = destructiveTools.has(rawName) || !state.settings.autoApplySafe;
          if (needsApproval) {
            state.pending = { call, name: rawName, args: parsed.data as Record<string, unknown>, description: rawName === "delete_content" ? `Delete ${String((parsed.data as { kind: string }).kind)} ${String((parsed.data as { id: string }).id)}?` : `Allow the agent to run ${rawName}?` };
            state.uiMessages.push({ role: "tool", toolName: rawName, content: state.pending.description, status: "running" });
            this.notify();
            return this.result("waiting", "I’m waiting for your approval before applying that change.", state.pending);
          }
          const result = await this.execute(rawName, parsed.data as Record<string, unknown>);
          state.messages.push({ role: "tool", tool_name: rawName, content: result });
          state.uiMessages.push({ role: "tool", toolName: rawName, content: result, status: "applied" });
          this.notify();
        }
      }
      return this.result("failed", "I stopped because the agent reached its step limit.", undefined, "Maximum agent steps reached");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return this.result("cancelled", "Stopped.", undefined, "Cancelled");
      if (error instanceof Error && error.name === "AbortError") return this.result("cancelled", "Stopped.", undefined, "Cancelled");
      return this.result("failed", "I couldn’t complete that board task.", undefined, error instanceof Error ? error.message : String(error));
    }
  }

  private result(status: AgentRunResult["status"], answer: string, pendingAction?: AgentPendingAction, error?: string): AgentRunResult {
    const state = this.state!;
    return { status, answer, document: clone(state.document), messages: [...state.uiMessages, { role: "assistant", content: answer }], pendingAction, error };
  }

  private notify() {
    const state = this.state;
    state?.onProgress?.([...state.uiMessages]);
  }

  private activePage() {
    const state = this.state!;
    const found = pageFor(state.document, state.sectionId, state.pageId);
    if (!found.page || !found.section) throw new Error("The active page no longer exists.");
    return { section: found.section, page: found.page } as { section: NonNullable<typeof found.section>; page: NotePage };
  }

  private async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const state = this.state!;
    const { page, section } = this.activePage();
    if (name === "read_active_page") return toolResult({ title: page.title, textBlocks: page.textBlocks, imageBlocks: page.imageBlocks ?? [], drawing: drawingSummary(page) });
    if (name === "search_pages") {
      const query = String(args.query).toLowerCase();
      const results = state.document.sections.flatMap((item) => item.pages.map((candidate) => ({ section: item.title, page: candidate.title, id: candidate.id, matches: candidate.textBlocks.filter((block) => block.text.toLowerCase().includes(query)).map((block) => block.text.slice(0, 240)) })).filter((candidate) => candidate.page.toLowerCase().includes(query) || candidate.matches.length));
      return toolResult(results.slice(0, 30));
    }
    if (name === "inspect_page_drawing") return toolResult({ drawing: drawingSummary(page), snapshotBase64: this.deps.snapshot(page) });
    if (name === "add_text") {
      const block = { id: crypto.randomUUID(), x: clamp(Number(args.x ?? 120)), y: clamp(Number(args.y ?? 120)), width: Number(args.width ?? 320), text: String(args.text) };
      state.document = updatePage(state.document, section.id, page.id, (candidate) => ({ ...candidate, textBlocks: [...candidate.textBlocks, block], updatedAt: now() }));
      return `Added text block ${block.id}.`;
    }
    if (name === "edit_text") {
      const id = String(args.id);
      if (!page.textBlocks.some((block) => block.id === id)) throw new Error(`Text block ${id} not found.`);
      state.document = updatePage(state.document, section.id, page.id, (candidate) => ({ ...candidate, textBlocks: candidate.textBlocks.map((block) => block.id === id ? { ...block, text: String(args.text) } : block), updatedAt: now() }));
      return `Updated text block ${id}.`;
    }
    if (name === "move_content") {
      const kind = String(args.kind); const id = String(args.id); const dx = Number(args.dx); const dy = Number(args.dy);
      if (kind === "text") {
        if (!page.textBlocks.some((block) => block.id === id)) throw new Error(`Text block ${id} not found.`);
        state.document = updatePage(state.document, section.id, page.id, (candidate) => ({ ...candidate, textBlocks: candidate.textBlocks.map((block) => block.id === id ? { ...block, x: block.x + dx, y: block.y + dy } : block), updatedAt: now() }));
      } else if (kind === "image") {
        if (!(page.imageBlocks ?? []).some((block) => block.id === id)) throw new Error(`Image block ${id} not found.`);
        state.document = updatePage(state.document, section.id, page.id, (candidate) => ({ ...candidate, imageBlocks: (candidate.imageBlocks ?? []).map((block) => block.id === id ? { ...block, x: block.x + dx, y: block.y + dy } : block), updatedAt: now() }));
      } else {
        if (!page.strokes.some((stroke) => stroke.id === id)) throw new Error(`Stroke ${id} not found.`);
        state.document = updatePage(state.document, section.id, page.id, (candidate) => ({ ...candidate, strokes: candidate.strokes.map((stroke) => stroke.id === id ? { ...stroke, points: stroke.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })) } : stroke), updatedAt: now() }));
      }
      return `Moved ${kind} ${id}.`;
    }
    if (name === "create_page") {
      const newPage = createBlankPage(String(args.title));
      state.document = { ...state.document, sections: state.document.sections.map((item) => item.id === section.id ? { ...item, pages: [...item.pages, newPage], activePageId: newPage.id } : item), updatedAt: now() };
      state.pageId = newPage.id;
      return `Created page ${newPage.title} (${newPage.id}).`;
    }
    if (name === "create_diagram") {
      const color = String(args.color ?? "#3478f6"); const offsetX = Number(args.x ?? 0); const offsetY = Number(args.y ?? 0);
      const primitives = args.primitives as Array<Record<string, unknown>>;
      const strokes: Stroke[] = primitives.map((primitive) => {
        const x = clamp(Number(primitive.x) + offsetX); const y = clamp(Number(primitive.y) + offsetY); const kind = String(primitive.kind); let points: Point[];
        if (kind === "line" || kind === "arrow") {
          const x2 = clamp(Number(primitive.x2 ?? x + 160) + offsetX); const y2 = clamp(Number(primitive.y2 ?? y) + offsetY); points = [{ x: x - WORLD_ORIGIN, y: y - WORLD_ORIGIN }, { x: x2 - WORLD_ORIGIN, y: y2 - WORLD_ORIGIN }];
          if (kind === "arrow") { const angle = Math.atan2(y2 - y, x2 - x); const length = 18; points.push({ x: x2 - WORLD_ORIGIN - length * Math.cos(angle - Math.PI / 6), y: y2 - WORLD_ORIGIN - length * Math.sin(angle - Math.PI / 6) }, { x: x2 - WORLD_ORIGIN, y: y2 - WORLD_ORIGIN }, { x: x2 - WORLD_ORIGIN - length * Math.cos(angle + Math.PI / 6), y: y2 - WORLD_ORIGIN - length * Math.sin(angle + Math.PI / 6) }); }
        } else if (kind === "rect") {
          const width = Number(primitive.width ?? 160); const height = Number(primitive.height ?? 100); points = [{ x: x - WORLD_ORIGIN, y: y - WORLD_ORIGIN }, { x: x + width - WORLD_ORIGIN, y: y - WORLD_ORIGIN }, { x: x + width - WORLD_ORIGIN, y: y + height - WORLD_ORIGIN }, { x: x - WORLD_ORIGIN, y: y + height - WORLD_ORIGIN }, { x: x - WORLD_ORIGIN, y: y - WORLD_ORIGIN }];
        } else {
          const radius = Number(primitive.radius ?? 60); points = Array.from({ length: 25 }, (_, index) => { const angle = (index / 24) * Math.PI * 2; return { x: x + Math.cos(angle) * radius - WORLD_ORIGIN, y: y + Math.sin(angle) * radius - WORLD_ORIGIN }; });
        }
        return { id: crypto.randomUUID(), color, width: Number(primitive.width ?? 3), opacity: 1, points };
      });
      state.document = updatePage(state.document, section.id, page.id, (candidate) => ({ ...candidate, strokes: [...candidate.strokes, ...strokes], updatedAt: now() }));
      return `Created ${strokes.length} vector diagram elements${args.title ? ` for “${String(args.title)}”` : ""}.`;
    }
    if (name === "insert_image") {
      if (!state.settings.allowOnlineImages) throw new Error("Online image search is disabled in Settings.");
      const results = await this.deps.searchImages(String(args.query));
      const image = results[0];
      if (!image) throw new Error("No Wikimedia image matched that query.");
      const asset = await this.deps.downloadImage(image.url);
      const block: ImageBlock = { id: crypto.randomUUID(), x: clamp(Number(args.x ?? 120)), y: clamp(Number(args.y ?? 120)), width: Number(args.width ?? 420), height: Number(args.height ?? 280), src: `data:${asset.mimeType};base64,${asset.data}`, alt: String(args.alt ?? image.title), source: image };
      state.document = updatePage(state.document, section.id, page.id, (candidate) => ({ ...candidate, imageBlocks: [...(candidate.imageBlocks ?? []), block], updatedAt: now() }));
      return `Inserted “${image.title}” with source metadata.`;
    }
    if (name === "delete_content") {
      const kind = String(args.kind); const id = String(args.id);
      if (kind === "page") {
        const targetSection = state.document.sections.find((item) => item.pages.some((candidate) => candidate.id === id));
        if (!targetSection || targetSection.pages.length <= 1) throw new Error("A section must keep at least one page.");
        const pages = targetSection.pages.filter((candidate) => candidate.id !== id);
        state.document = { ...state.document, sections: state.document.sections.map((item) => item.id === targetSection.id ? { ...item, pages, activePageId: item.activePageId === id ? pages[0].id : item.activePageId } : item), updatedAt: now() };
      } else {
        const exists = kind === "text" ? page.textBlocks.some((block) => block.id === id) : kind === "stroke" ? page.strokes.some((stroke) => stroke.id === id) : (page.imageBlocks ?? []).some((block) => block.id === id);
        if (!exists) throw new Error(`${kind} ${id} not found.`);
        state.document = updatePage(state.document, section.id, page.id, (candidate) => ({ ...candidate, textBlocks: kind === "text" ? candidate.textBlocks.filter((block) => block.id !== id) : candidate.textBlocks, strokes: kind === "stroke" ? candidate.strokes.filter((stroke) => stroke.id !== id) : candidate.strokes, imageBlocks: kind === "image" ? (candidate.imageBlocks ?? []).filter((block) => block.id !== id) : candidate.imageBlocks, updatedAt: now() }));
      }
      return `Deleted ${kind} ${id}.`;
    }
    throw new Error(`Tool ${name} is not implemented.`);
  }
}
