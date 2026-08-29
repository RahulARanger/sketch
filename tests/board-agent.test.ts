import assert from "node:assert/strict";
import test from "node:test";
import { BoardAgent } from "../src/agent/boardAgent.ts";
import type { AgentSettings, OllamaResponse } from "../src/agent/types.ts";
import { STARTER_DOCUMENT } from "../src/data.ts";
import type { SketchDocument } from "../src/types.ts";

const settings: AgentSettings = { enabled: true, endpoint: "http://ollama", model: "qwen3", visionModel: "", maxSteps: 6, autoApplySafe: true, allowOnlineImages: false, includePageImage: false };
function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function fixture() { const document = copy<SketchDocument>(STARTER_DOCUMENT); const section = document.sections[0]; const page = section.pages.find((item) => item.id === section.activePageId)!; return { document, section, page }; }

test("runs a tool loop and stages safe text changes", async () => {
  const { document, section, page } = fixture();
  const responses: OllamaResponse[] = [
    { message: { role: "assistant", content: "", tool_calls: [{ function: { name: "add_text", arguments: { text: "Agent note", x: 20, y: 30 } } }] } },
    { message: { role: "assistant", content: "Added the note." } },
  ];
  const agent = new BoardAgent({ transport: async () => responses.shift()!, snapshot: () => "snapshot" });
  const result = await agent.run("Add a note", document, section.id, page.id, settings);
  const nextPage = result.document.sections[0].pages.find((item) => item.id === page.id)!;
  assert.equal(result.status, "completed");
  assert.equal(nextPage.textBlocks.some((block) => block.text === "Agent note"), true);
});

test("pauses destructive changes until approval", async () => {
  const { document, section, page } = fixture();
  const textId = page.textBlocks[0].id;
  const responses: OllamaResponse[] = [
    { message: { role: "assistant", content: "", tool_calls: [{ function: { name: "delete_content", arguments: { kind: "text", id: textId } } }] } },
    { message: { role: "assistant", content: "Deleted it." } },
  ];
  const agent = new BoardAgent({ transport: async () => responses.shift()!, snapshot: () => "snapshot" });
  const pending = await agent.run("Delete it", document, section.id, page.id, settings);
  assert.equal(pending.status, "waiting");
  assert.equal(pending.document.sections[0].pages[1].textBlocks.length, 2);
  const approved = await agent.resume(true);
  assert.equal(approved?.status, "completed");
  assert.equal(approved?.document.sections[0].pages[1].textBlocks.some((block) => block.id === textId), false);
});

test("rejects online image insertion when disabled", async () => {
  const { document, section, page } = fixture();
  const responses: OllamaResponse[] = [
    { message: { role: "assistant", content: "", tool_calls: [{ function: { name: "insert_image", arguments: { query: "cat" } } }] } },
    { message: { role: "assistant", content: "I could not insert an image." } },
  ];
  const agent = new BoardAgent({ transport: async () => responses.shift()!, snapshot: () => "snapshot" });
  const result = await agent.run("Add a cat image", document, section.id, page.id, settings);
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /disabled/i);
});
