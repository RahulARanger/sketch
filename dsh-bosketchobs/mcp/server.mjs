#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const INDEX = '.bosketchobs-index.json'
const root = resolve(process.env.BOSKETCHOBS_WORKSPACE ?? process.cwd())

const tools = [
  tool('workspace_overview', 'Read the workspace sections, pages, and saved file paths.', { type: 'object', properties: {} }),
  tool('read_page', 'Read one page including text, images, tables, links, and strokes.', { type: 'object', properties: { sectionId: { type: 'string' }, pageId: { type: 'string' } } }),
  tool('inspect_page', 'Analyze page geometry so an agent can understand layout and diagram content.', { type: 'object', properties: { sectionId: { type: 'string' }, pageId: { type: 'string' } } }),
  tool('create_page', 'Create a page in an existing section.', { type: 'object', required: ['sectionId', 'title'], properties: { sectionId: { type: 'string' }, title: { type: 'string' }, pageId: { type: 'string' } } }),
  tool('create_diagram', 'Create a vector diagram from line, rectangle, circle, and arrow primitives.', { type: 'object', required: ['primitives'], properties: { sectionId: { type: 'string' }, pageId: { type: 'string' }, title: { type: 'string' }, primitives: { type: 'array', minItems: 1, maxItems: 120, items: { type: 'object', required: ['kind', 'x', 'y'], properties: { kind: { type: 'string', enum: ['line', 'rect', 'circle', 'arrow'] }, x: { type: 'number' }, y: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' }, radius: { type: 'number' } } } } } }),
  tool('add_text', 'Add a typed text block to a page.', { type: 'object', required: ['text'], properties: { sectionId: { type: 'string' }, pageId: { type: 'string' }, text: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' } } }),
  tool('move_content', 'Move a text, stroke, image, table, or link by a delta.', { type: 'object', required: ['kind', 'id', 'dx', 'dy'], properties: { sectionId: { type: 'string' }, pageId: { type: 'string' }, kind: { type: 'string', enum: ['text', 'stroke', 'image', 'table', 'link'] }, id: { type: 'string' }, dx: { type: 'number' }, dy: { type: 'number' } } }),
  tool('organize_workspace', 'Rename or reorder sections and pages. Reordering is explicit and preserves all ids.', { type: 'object', properties: { sectionOrder: { type: 'array', items: { type: 'string' } }, pageOrder: { type: 'object' }, renameSections: { type: 'object' }, renamePages: { type: 'object' } } }),
  tool('delete_page', 'Delete a page only when explicitly requested; this is irreversible at the workspace-file level.', { type: 'object', required: ['sectionId', 'pageId', 'confirm'], properties: { sectionId: { type: 'string' }, pageId: { type: 'string' }, confirm: { type: 'boolean' } } }),
  tool('open_workspace', 'Ask the desktop app to open or reveal the configured workspace. The app may need a manual reopen if it is already running.', { type: 'object', properties: { revealOnly: { type: 'boolean' } } }),
]

function tool(name, description, inputSchema) { return { name, description, inputSchema } }
function id() { return crypto.randomUUID() }
function now() { return new Date().toISOString() }
function fail(message) { throw new Error(message) }
function json(value) { return JSON.stringify(value, null, 2) }
function safePath(...parts) {
  const target = resolve(root, ...parts)
  const rel = relative(root, target)
  if (rel.startsWith('..') || isAbsolute(rel)) fail('Path escapes BOSKETCHOBS_WORKSPACE.')
  return target
}
function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')) }
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp-${process.pid}`
  writeFileSync(temp, json(value))
  renameSync(temp, path)
}
function loadIndex() {
  const path = safePath(INDEX)
  if (!existsSync(path)) fail(`No ${INDEX} found. Set BOSKETCHOBS_WORKSPACE to a saved BoSketchObs workspace folder.`)
  return readJson(path)
}
function storedPage(index, sectionId, pageId) {
  const section = index.sections?.find((item) => item.id === sectionId) ?? index.sections?.[0]
  if (!section) fail('Section not found.')
  const page = section.pages?.find((item) => item.id === pageId) ?? section.pages?.[0]
  if (!page) fail('Page not found.')
  return { section, page, path: safePath(section.folder, page.file) }
}
function loadPage(index, sectionId, pageId) {
  const located = storedPage(index, sectionId, pageId)
  return { ...located, data: readJson(located.path) }
}
function savePage(index, located, page) {
  page.updatedAt = now()
  writeJson(located.path, page)
  located.page.title = page.title
  located.page.updatedAt = page.updatedAt
  writeJson(safePath(INDEX), index)
}
function saveSectionManifest(index, section) {
  writeJson(safePath(section.folder, '.bosketchobs-section.json'), {
    version: 1,
    notebookId: index.id,
    notebookTitle: index.title,
    section: { id: section.id, title: section.title, color: section.color, activePageId: section.activePageId },
    pages: section.pages,
    sectionLocations: {},
  })
}
function point(x, y) { return { x: Number(x), y: Number(y) } }
function primitiveStroke(item, color) {
  const x = Number(item.x), y = Number(item.y), width = Math.max(1, Number(item.width ?? 4))
  if (!Number.isFinite(x) || !Number.isFinite(y)) fail('Primitive coordinates must be finite numbers.')
  if (item.kind === 'circle') {
    const radius = Math.max(1, Number(item.radius ?? 50)), points = []
    for (let i = 0; i <= 48; i++) { const a = (Math.PI * 2 * i) / 48; points.push(point(x + Math.cos(a) * radius, y + Math.sin(a) * radius)) }
    return { id: id(), color, width, opacity: 1, points }
  }
  const x2 = Number(item.x2 ?? (x + Number(item.width ?? 160))), y2 = Number(item.y2 ?? (y + Number(item.height ?? 100)))
  if (item.kind === 'rect') return { id: id(), color, width, opacity: 1, points: [point(x, y), point(x2, y), point(x2, y2), point(x, y2), point(x, y)] }
  if (item.kind === 'arrow') return { id: id(), color, width, opacity: 1, points: [point(x, y), point(x2, y2)] }
  return { id: id(), color, width, opacity: 1, points: [point(x, y), point(x2, y2)] }
}
function pageSummary(page) {
  const blocks = [...(page.textBlocks ?? []), ...(page.imageBlocks ?? []), ...(page.tableBlocks ?? []), ...(page.linkBlocks ?? [])]
  const points = (page.strokes ?? []).flatMap((stroke) => stroke.points ?? [])
  const bounds = points.length ? { minX: Math.min(...points.map((p) => p.x)), maxX: Math.max(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)), maxY: Math.max(...points.map((p) => p.y)) } : null
  return { title: page.title, id: page.id, text: (page.textBlocks ?? []).map((b) => ({ id: b.id, x: b.x, y: b.y, text: b.text })), counts: { strokes: page.strokes?.length ?? 0, points: points.length, text: page.textBlocks?.length ?? 0, images: page.imageBlocks?.length ?? 0, tables: page.tableBlocks?.length ?? 0, links: page.linkBlocks?.length ?? 0 }, bounds, contentIds: { strokes: (page.strokes ?? []).map((b) => b.id), text: (page.textBlocks ?? []).map((b) => b.id), images: (page.imageBlocks ?? []).map((b) => b.id), tables: (page.tableBlocks ?? []).map((b) => b.id), links: (page.linkBlocks ?? []).map((b) => b.id) } }
}
function call(name, args) {
  const index = loadIndex()
  if (name === 'workspace_overview') return { workspace: root, title: index.title, activeSectionId: index.activeSectionId, sections: (index.sections ?? []).map((s) => ({ id: s.id, title: s.title, folder: s.folder, pages: (s.pages ?? []).map((p) => ({ id: p.id, title: p.title, file: p.file, parentId: p.parentId })) })) }
  if (name === 'read_page' || name === 'inspect_page') { const located = loadPage(index, args.sectionId, args.pageId); return name === 'inspect_page' ? pageSummary(located.data) : located.data }
  if (name === 'create_page') {
    const section = index.sections?.find((s) => s.id === args.sectionId); if (!section) fail('Section not found.')
    const page = { version: 2, id: args.pageId || id(), title: String(args.title).trim(), strokes: [], textBlocks: [], imageBlocks: [], tableBlocks: [], linkBlocks: [], updatedAt: now() }
    const file = `${page.title.replace(/[^a-zA-Z0-9 _.-]/g, '').trim().replace(/\s+/g, ' ') || 'Untitled page'}--${page.id}.bosketchobs.json`
    mkdirSync(safePath(section.folder), { recursive: true }); writeJson(safePath(section.folder, file), page); section.pages = [...(section.pages ?? []), { id: page.id, title: page.title, updatedAt: page.updatedAt, file }]; section.activePageId = page.id; saveSectionManifest(index, section); writeJson(safePath(INDEX), index); return page
  }
  if (name === 'create_diagram') { const located = loadPage(index, args.sectionId, args.pageId); const color = args.color ?? '#1c2228'; located.data.strokes = [...(located.data.strokes ?? []), ...args.primitives.map((p) => primitiveStroke(p, color))]; if (args.title) located.data.title = args.title; savePage(index, located, located.data); return pageSummary(located.data) }
  if (name === 'add_text') { const located = loadPage(index, args.sectionId, args.pageId); located.data.textBlocks = [...(located.data.textBlocks ?? []), { id: id(), x: Number(args.x ?? 80), y: Number(args.y ?? 100), width: Number(args.width ?? 520), text: String(args.text) }]; savePage(index, located, located.data); return pageSummary(located.data) }
  if (name === 'move_content') { const located = loadPage(index, args.sectionId, args.pageId); const key = { text: 'textBlocks', stroke: 'strokes', image: 'imageBlocks', table: 'tableBlocks', link: 'linkBlocks' }[args.kind]; const items = located.data[key] ?? []; const item = items.find((i) => i.id === args.id); if (!item) fail('Content id not found.'); if (args.kind === 'stroke') item.points = item.points.map((p) => point(p.x + args.dx, p.y + args.dy)); else { item.x += args.dx; item.y += args.dy }; savePage(index, located, located.data); return item }
  if (name === 'organize_workspace') { if (args.sectionOrder) index.sections = args.sectionOrder.map((id) => index.sections.find((s) => s.id === id)).filter(Boolean); for (const [id, title] of Object.entries(args.renameSections ?? {})) { const s = index.sections.find((x) => x.id === id); if (s) s.title = String(title) }; for (const s of index.sections ?? []) { const order = args.pageOrder?.[s.id]; if (order) s.pages = order.map((id) => s.pages.find((p) => p.id === id)).filter(Boolean); for (const [id, title] of Object.entries(args.renamePages ?? {})) { const p = s.pages.find((x) => x.id === id); if (p) { p.title = String(title); const pagePath = safePath(s.folder, p.file); if (existsSync(pagePath)) { const data = readJson(pagePath); data.title = p.title; data.updatedAt = now(); p.updatedAt = data.updatedAt; writeJson(pagePath, data) } } } saveSectionManifest(index, s) }; writeJson(safePath(INDEX), index); return call('workspace_overview', {}) }
  if (name === 'delete_page') { if (args.confirm !== true) fail('Deletion requires confirm: true.'); const section = index.sections.find((s) => s.id === args.sectionId); const page = section?.pages.find((p) => p.id === args.pageId); if (!section || !page) fail('Page not found.'); fail('Refusing to delete page files through the bridge. Use the app UI for deletion after reviewing the target.') }
  if (name === 'open_workspace') { const command = process.platform === 'darwin' ? (args.revealOnly ? 'open' : 'open') : process.platform === 'win32' ? 'explorer' : 'xdg-open'; const child = spawn(command, [root], { detached: true, stdio: 'ignore' }); child.unref(); return { opened: root, revealOnly: Boolean(args.revealOnly), note: 'The workspace folder was opened/revealed. Reopen the workspace in BoSketchObs if the running app does not auto-refresh.' } }
  fail(`Unknown tool: ${name}`)
}
function respond(id, result, error) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error: { code: -32000, message: error } } : { result }) }) + '\n') }
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => { if (!line.trim()) return; let request; try { request = JSON.parse(line) } catch { return respond(null, null, 'Invalid JSON.') }; if (request.method === 'initialize') return respond(request.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'dsh-bosketchobs', version: '0.1.0' } }); if (request.method === 'notifications/initialized') return; if (request.method === 'tools/list') return respond(request.id, { tools }); if (request.method === 'tools/call') { try { const result = call(request.params?.name, request.params?.arguments ?? {}); return respond(request.id, { content: [{ type: 'text', text: json(result) }], structuredContent: result }); } catch (error) { return respond(request.id, null, error instanceof Error ? error.message : String(error)) } } respond(request.id, null, `Unsupported method: ${request.method}`) })
