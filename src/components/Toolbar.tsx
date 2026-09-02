import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Eraser, Hand, Highlighter, ImagePlus, LassoSelect, Link2, MousePointer2, PenLine, Redo2, SlidersHorizontal, Table2, Type, Undo2, X } from "lucide-react";
import { motion } from "motion/react";
import { PEN_PRESETS } from "../data";
import type { PenSettings, ToolId } from "../types";

type ToolbarProps = {
  tool: ToolId;
  hardwareEraserActive: boolean;
  presetId: string;
  onToolChange: (tool: ToolId) => void;
  onPresetChange: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  theme: "light" | "dark";
  penColors: Record<string, string>;
  penSettings: Record<string, Partial<PenSettings>>;
  onPresetColorChange: (id: string, color: string) => void;
  onPresetSettingsChange: (id: string, settings: Partial<PenSettings>) => void;
  onPresetModeChange: (id: string, mode: "pen" | "highlighter") => void;
  onInsertImage: () => void;
  onInsertTable: () => void;
  onInsertLink: () => void;
};

function getPresetColor(presetId: string, color: string, theme: "light" | "dark", customColor?: string) {
  return customColor ?? (presetId === "contrast" ? (theme === "dark" ? "#f4f6f8" : "#1c2228") : color);
}

const LONG_PRESS_MS = 450;
const COLOR_SWATCHES = [
  "#1c2228", "#858f99", "#e7a5c5", "#9a5de0",
  "#2f7df4", "#65a8f5", "#f6c945", "#ef8b3f",
  "#35ad66", "#34a9b8", "#ef4e4e", "#e86f91",
];
const WIDTH_OPTIONS = [
  { label: "Fine", value: 2 },
  { label: "Regular", value: 4 },
  { label: "Bold", value: 8 },
  { label: "Broad", value: 16 },
];

type PickerPosition = { left: number; top?: number; bottom?: number };

export function Toolbar({ tool, hardwareEraserActive, presetId, onToolChange, onPresetChange, onPresetColorChange, onPresetSettingsChange, onPresetModeChange, onInsertImage, onInsertTable, onInsertLink, onUndo, onRedo, canUndo, canRedo, theme, penColors, penSettings }: ToolbarProps) {
  const [optionsPresetId, setOptionsPresetId] = useState<string | null>(null);
  const [pickerPosition, setPickerPosition] = useState<PickerPosition | null>(null);
  const [insertOpen, setInsertOpen] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);

  const clearLongPress = () => {
    if (longPressTimerRef.current !== null) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  };

  const openOptions = (presetIdToOpen: string, button: HTMLButtonElement) => {
    const bounds = button.getBoundingClientRect();
    setOptionsPresetId(presetIdToOpen);
    const position = {
      left: Math.min(Math.max(158, bounds.left + bounds.width / 2), window.innerWidth - 158),
    } as PickerPosition;
    if (bounds.top < window.innerHeight / 2) position.top = bounds.bottom + 12;
    else position.bottom = Math.max(12, window.innerHeight - bounds.top + 12);
    setPickerPosition(position);
  };

  useEffect(() => () => clearLongPress(), []);

  const activeOptionsPreset = optionsPresetId === null
    ? null
    : PEN_PRESETS.find((preset) => preset.id === optionsPresetId) ?? PEN_PRESETS[0];
  const activeSettings = activeOptionsPreset ? penSettings[activeOptionsPreset.id] : undefined;
  const pickerColor = activeOptionsPreset
    ? getPresetColor(activeOptionsPreset.id, activeOptionsPreset.color, theme, penColors[activeOptionsPreset.id]) || activeOptionsPreset.color
    : null;
  const activeWidth = activeSettings?.width ?? activeOptionsPreset?.width ?? 3.2;
  const activeOpacity = activeSettings?.opacity ?? activeOptionsPreset?.opacity ?? 1;
  const activeTool = activeSettings?.tool ?? activeOptionsPreset?.tool ?? "pen";
  const optionsPosition = pickerPosition ?? { left: window.innerWidth / 2, top: 72 };
  const portalTarget = document.querySelector<HTMLElement>(".app-shell") ?? document.body;

  return (
    <>
    <motion.div className="tool-dock" role="toolbar" aria-label="Canvas tools" onScroll={() => optionsPresetId && setOptionsPresetId(null)} initial={{ opacity: 0, x: "-50%", y: 14, scale: 0.98 }} animate={{ opacity: 1, x: "-50%", y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 360, damping: 28 }}>
      <motion.button className={`tool-button ${tool === "select" ? "active" : ""}`} onClick={() => onToolChange("select")} title="Select (V)" aria-label="Select" animate={{ scale: tool === "select" ? 1.04 : 1 }} whileHover={{ y: -2 }} whileTap={{ scale: 0.9 }}><MousePointer2 /></motion.button>
      <motion.button className={`tool-button ${tool === "lasso" ? "active" : ""}`} onClick={() => onToolChange("lasso")} title="Lasso select handwriting" aria-label="Lasso select" animate={{ scale: tool === "lasso" ? 1.04 : 1 }} whileHover={{ y: -2 }} whileTap={{ scale: 0.9 }}><LassoSelect /></motion.button>
      <motion.button className={`tool-button ${tool === "text" ? "active" : ""}`} onClick={() => onToolChange("text")} title="Text mode — click anywhere to type (T)" aria-label="Text mode — click anywhere to type" animate={{ scale: tool === "text" ? 1.04 : 1 }} whileHover={{ y: -2 }} whileTap={{ scale: 0.9 }}><Type /></motion.button>
      <span className="tool-separator" />
      {PEN_PRESETS.map((preset) => {
        const settings = penSettings[preset.id];
        const displayColor = getPresetColor(preset.id, preset.color, theme, penColors[preset.id]);
        const displayOpacity = settings?.opacity ?? preset.opacity;
        const displayTool = settings?.tool ?? preset.tool;
        const PenIcon = displayTool === "highlighter" ? Highlighter : PenLine;
        return (
          <motion.button
            key={preset.id}
            className={`tool-button pen-button ${presetId === preset.id && (tool === "pen" || tool === "highlighter") ? "active" : ""}`}
            animate={{ scale: presetId === preset.id && (tool === "pen" || tool === "highlighter") ? 1.04 : 1 }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.9 }}
            onPointerDown={(event) => {
              const button = event.currentTarget;
              clearLongPress();
              longPressTriggeredRef.current = false;
              longPressTimerRef.current = window.setTimeout(() => {
                longPressTriggeredRef.current = true;
                openOptions(preset.id, button);
              }, LONG_PRESS_MS);
            }}
            onPointerUp={clearLongPress}
            onPointerLeave={clearLongPress}
            onPointerCancel={clearLongPress}
            onContextMenu={(event) => {
              event.preventDefault();
              longPressTriggeredRef.current = true;
              openOptions(preset.id, event.currentTarget);
            }}
            onClick={(event) => {
              if (longPressTriggeredRef.current) {
                event.preventDefault();
                longPressTriggeredRef.current = false;
                return;
              }
              onPresetChange(preset.id);
            }}
            title={`${preset.label} (${preset.shortcut}) — hold for options`}
            aria-label={preset.label}
          >
            <PenIcon className="pen-tool-icon" style={{ color: displayColor, opacity: displayOpacity }} />
            <span className="pen-swatch" style={{ background: displayColor, opacity: displayOpacity }} />
          </motion.button>
        );
      })}
      <motion.button
        className={`tool-button tool-options-button ${optionsPresetId ? "active" : ""}`}
        onClick={(event) => openOptions(presetId, event.currentTarget)}
        title="Pen options — click to open, hold any pen for options"
        aria-label="Open pen options"
        aria-haspopup="dialog"
        aria-expanded={optionsPresetId !== null}
        whileHover={{ y: -2 }}
        whileTap={{ scale: 0.9 }}
      ><SlidersHorizontal /></motion.button>
      <span className="tool-separator" />
      <motion.button className={`tool-button ${tool === "eraser" || hardwareEraserActive ? "active hardware-active" : ""}`} onClick={() => onToolChange("eraser")} title="Eraser (E)" aria-label="Eraser" aria-pressed={tool === "eraser" || hardwareEraserActive} animate={{ scale: tool === "eraser" || hardwareEraserActive ? 1.04 : 1 }} whileHover={{ y: -2 }} whileTap={{ scale: 0.9 }}><Eraser /></motion.button>
      <motion.button className={`tool-button ${tool === "pan" ? "active" : ""}`} onClick={() => onToolChange("pan")} title="Pan (H)" aria-label="Pan" animate={{ scale: tool === "pan" ? 1.04 : 1 }} whileHover={{ y: -2 }} whileTap={{ scale: 0.9 }}><Hand /></motion.button>
      <span className="tool-separator" />
      <motion.button className="tool-button" onClick={onUndo} disabled={!canUndo} title="Undo" aria-label="Undo" whileHover={{ y: -2 }} whileTap={{ scale: 0.9 }}><Undo2 /></motion.button>
      <motion.button className="tool-button" onClick={onRedo} disabled={!canRedo} title="Redo" aria-label="Redo" whileHover={{ y: -2 }} whileTap={{ scale: 0.9 }}><Redo2 /></motion.button>
      <span className="tool-separator" />
      <div className="insert-tool">
        <motion.button className={`insert-tool-button ${insertOpen ? "active" : ""}`} type="button" onClick={() => setInsertOpen((open) => !open)} aria-haspopup="menu" aria-expanded={insertOpen} whileTap={{ scale: 0.96 }}><span>Insert</span><ChevronDown /></motion.button>
        {insertOpen ? <div className="insert-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setInsertOpen(false); onInsertImage(); }}><ImagePlus /><span><strong>Image</strong><small>Choose or paste an image</small></span></button>
          <button type="button" role="menuitem" onClick={() => { setInsertOpen(false); onInsertTable(); }}><Table2 /><span><strong>Table</strong><small>Add an editable 3 × 3 table</small></span></button>
          <button type="button" role="menuitem" onClick={() => { setInsertOpen(false); onInsertLink(); }}><Link2 /><span><strong>Link</strong><small>Add a clickable web link</small></span></button>
        </div> : null}
      </div>
    </motion.div>
      {activeOptionsPreset && pickerColor ? createPortal(
      <div className="color-picker-layer" role="presentation" onPointerDown={() => setOptionsPresetId(null)}>
        <motion.div
          className="tool-options-popover"
          role="dialog"
          aria-label={`${activeOptionsPreset.label} options`}
          style={{ left: optionsPosition.left, top: optionsPosition.top, bottom: optionsPosition.bottom }}
          initial={{ opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="color-picker-header">
            <div><strong>{activeOptionsPreset.label}</strong><span>Ink settings</span></div>
            <motion.button className="color-picker-close" type="button" onClick={() => setOptionsPresetId(null)} aria-label="Close tool options" title="Close tool options" whileHover={{ rotate: 90 }} whileTap={{ scale: 0.9 }}><X /></motion.button>
          </div>
          <div className="tool-option-group">
            <div className="tool-option-label"><span>Color</span><input className="tool-option-custom-color" type="color" value={pickerColor} onChange={(event) => onPresetColorChange(activeOptionsPreset.id, event.target.value)} aria-label="Custom ink color" /></div>
            <div className="tool-color-grid">
              {COLOR_SWATCHES.map((color) => <button key={color} className={`tool-color-swatch ${pickerColor.toLowerCase() === color ? "active" : ""}`} type="button" style={{ background: color }} onClick={() => onPresetColorChange(activeOptionsPreset.id, color)} aria-label={`Use ${color} ink`} />)}
            </div>
          </div>
          <div className="tool-option-group">
            <div className="tool-option-label"><span>Stroke size</span><output>{activeWidth}px</output></div>
            <div className="tool-size-row">
              {WIDTH_OPTIONS.map((option) => <button key={option.value} className={`tool-size-option ${Math.abs(activeWidth - option.value) < 0.1 ? "active" : ""}`} type="button" onClick={() => onPresetSettingsChange(activeOptionsPreset.id, { width: option.value })} aria-label={`${option.label} stroke, ${option.value} pixels`}><span style={{ width: Math.max(5, option.value), height: Math.max(5, option.value) }} /></button>)}
            </div>
            <input className="tool-range" type="range" min="1" max="40" step="0.5" value={activeWidth} onChange={(event) => onPresetSettingsChange(activeOptionsPreset.id, { width: Number(event.target.value) })} aria-label="Stroke size" />
          </div>
          <div className="tool-option-group">
            <div className="tool-option-label"><span>Opacity</span><output>{Math.round(activeOpacity * 100)}%</output></div>
            <input className="tool-range" type="range" min="0.1" max="1" step="0.05" value={activeOpacity} onChange={(event) => onPresetSettingsChange(activeOptionsPreset.id, { opacity: Number(event.target.value) })} aria-label="Stroke opacity" />
          </div>
          <div className="tool-option-group">
            <div className="tool-option-label"><span>Tool</span></div>
            <div className="tool-mode-row">
              <button className={`tool-mode-option ${activeTool === "pen" ? "active" : ""}`} type="button" aria-pressed={activeTool === "pen"} onPointerDown={(event) => event.stopPropagation()} onClick={() => onPresetModeChange(activeOptionsPreset.id, "pen")}><PenLine /> <span>Pen</span></button>
              <button className={`tool-mode-option ${activeTool === "highlighter" ? "active" : ""}`} type="button" aria-pressed={activeTool === "highlighter"} onPointerDown={(event) => event.stopPropagation()} onClick={() => onPresetModeChange(activeOptionsPreset.id, "highlighter")}><Highlighter /> <span>Highlighter</span></button>
            </div>
          </div>
        </motion.div>
      </div>,
      portalTarget,
    ) : null}
    </>
  );
}
