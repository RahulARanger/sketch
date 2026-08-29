import { textBlockHeight, WORLD_ORIGIN } from "../canvasNavigation.ts";
import type { NotePage } from "../types.ts";

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;");
}

function toBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

function pathFor(points: Array<{ x: number; y: number }>) {
  if (!points.length) return "";
  return `M ${points.map((point) => `${point.x + WORLD_ORIGIN} ${point.y + WORLD_ORIGIN}`).join(" L ")}`;
}

export function renderPageSnapshot(page: NotePage) {
  const padding = 80;
  const right = Math.max(1100, ...page.textBlocks.map((block) => block.x + block.width), ...page.imageBlocks?.map((block) => block.x + block.width) ?? [], ...page.strokes.flatMap((stroke) => stroke.points.map((point) => point.x + WORLD_ORIGIN))) + padding;
  const bottom = Math.max(760, ...page.textBlocks.map((block) => block.y + textBlockHeight(block)), ...page.imageBlocks?.map((block) => block.y + block.height) ?? [], ...page.strokes.flatMap((stroke) => stroke.points.map((point) => point.y + WORLD_ORIGIN))) + padding;
  const text = page.textBlocks.map((block) => `<text x="${block.x}" y="${block.y}" fill="#152536" font-family="system-ui" font-size="24" xml:space="preserve">${escapeXml(block.text).split("\n").map((line, index) => `<tspan x="${block.x}" dy="${index ? 31 : 0}">${line || " "}</tspan>`).join("")}</text>`).join("");
  const strokes = page.strokes.map((stroke) => `<path d="${pathFor(stroke.points)}" fill="none" stroke="${stroke.color}" stroke-opacity="${stroke.opacity}" stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
  const images = (page.imageBlocks ?? []).map((block) => `<rect x="${block.x}" y="${block.y}" width="${block.width}" height="${block.height}" fill="#d8e3ef" stroke="#9aaaba"/><text x="${block.x + 12}" y="${block.y + 28}" fill="#60758c" font-family="system-ui" font-size="16">${escapeXml(block.alt || "Image")}</text>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${right}" height="${bottom}" viewBox="0 0 ${right} ${bottom}"><rect width="100%" height="100%" fill="#edf4fb"/><text x="40" y="48" fill="#60758c" font-family="system-ui" font-size="18">${escapeXml(page.title)}</text>${strokes}${images}${text}</svg>`;
  return toBase64(svg);
}
