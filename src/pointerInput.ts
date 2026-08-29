export type HardwarePointerMode = "eraser" | "pan" | null;
export type PointerPlatform = "macos" | "windows" | "other";

type PointerDescriptor = {
  pointerType: string;
  button: number;
  buttons: number;
  // A few Wacom/WebKit integrations expose the native stylus eraser state as
  // a non-standard boolean instead of a Pointer Events button or pointerType.
  eraser?: boolean;
};

export function getRuntimePointerPlatform(userAgent = navigator.userAgent): PointerPlatform {
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "macos";
  if (/Windows/i.test(userAgent)) return "windows";
  return "other";
}

export function getHardwarePointerMode({ pointerType, button, buttons, eraser }: PointerDescriptor): HardwarePointerMode {
  // Most browsers expose the Wacom eraser as a pen with button 5 / bit 32,
  // but some WebView/device combinations expose it as its own pointer type.
  // Check these signals before filtering by pointer type so both variants
  // activate the temporary eraser mode.
  if (eraser || pointerType === "eraser" || pointerType === "3" || button === 5 || (buttons & 32) !== 0) return "eraser";
  if (pointerType === "pen" && (button === 2 || (buttons & 2) !== 0)) return "eraser";
  // Standard auxiliary/middle-button signals remain available for panning.
  // In particular, macOS WebKit can report a Wacom pad/side-button press as
  // a pen button 1 with buttons === 1. Treat that ambiguous legacy signature
  // as pan; the native macOS eraser monitor supplies the eraser state when it
  // is actually active.
  if (button === 1 || (buttons & 4) !== 0) return "pan";
  return null;
}

const MAX_WHEEL_STEP = 64;
const WHEEL_SCALE = 0.35;

/** Convert mouse/trackpad wheel units into a deliberately gentle canvas step. */
export function normalizeWheelDelta(delta: number, deltaMode: number, viewportSize = 800): number {
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? viewportSize : 1;
  return Math.max(-MAX_WHEEL_STEP, Math.min(MAX_WHEEL_STEP, delta * unit * WHEEL_SCALE));
}
