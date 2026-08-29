export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])") !== null;
}

export function isEditingText(event: KeyboardEvent): boolean {
  return isEditableTarget(event.target) || isEditableTarget(document.activeElement);
}

export function shouldSkipShortcut(
  event: Pick<KeyboardEvent, "defaultPrevented" | "isComposing" | "metaKey" | "ctrlKey">,
  editingText: boolean,
): boolean {
  if (event.defaultPrevented || event.isComposing) return true;
  return editingText && !(event.metaKey || event.ctrlKey);
}

export function getToolShortcut(event: Pick<KeyboardEvent, "key" | "code">): "select" | "text" | "eraser" | "pan" | null {
  const key = event.key.toLowerCase();
  if (key === "eraser" || event.code.toLowerCase() === "eraser") return "eraser";
  const keyTools: Record<string, "select" | "text" | "eraser" | "pan"> = { v: "select", t: "text", e: "eraser", h: "pan" };
  return keyTools[key] ?? null;
}
