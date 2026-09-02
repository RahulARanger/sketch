import { Palette, Pencil, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";

type RowContextMenuProps = {
  x: number;
  y: number;
  title: string;
  kind: "section" | "page";
  color?: string;
  onRename: () => void;
  onColorChange?: (color: string) => void;
  onDelete: () => void;
  onClose: () => void;
};

export const ROW_CONTEXT_MENU_EVENT = "bosketch:row-context-menu-open";

export function RowContextMenu({ x, y, title, kind, color, onRename, onColorChange, onDelete, onClose }: RowContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dismissOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const dismissOnAnotherMenu = () => onClose();
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const dismissOnScroll = () => onClose();

    document.addEventListener("click", dismissOnOutsideClick);
    window.addEventListener(ROW_CONTEXT_MENU_EVENT, dismissOnAnotherMenu);
    window.addEventListener("keydown", dismissOnEscape);
    window.addEventListener("scroll", dismissOnScroll, true);
    return () => {
      document.removeEventListener("click", dismissOnOutsideClick);
      window.removeEventListener(ROW_CONTEXT_MENU_EVENT, dismissOnAnotherMenu);
      window.removeEventListener("keydown", dismissOnEscape);
      window.removeEventListener("scroll", dismissOnScroll, true);
    };
  }, [onClose]);

  const menuWidth = 178;
  const menuHeight = kind === "section" ? 136 : 94;
  const left = Math.max(8, Math.min(x, window.innerWidth - menuWidth - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - menuHeight - 8));
  const run = (action: () => void) => {
    action();
    onClose();
  };

  const menu = (
    <motion.div
      ref={menuRef}
      className="row-context-menu"
      role="menu"
      aria-label={`${title} ${kind} menu`}
      data-no-window-drag
      style={{ left, top }}
      initial={{ opacity: 0, scale: 0.96, y: -3 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
    >
      <strong title={title}>{title}</strong>
      <button type="button" role="menuitem" onPointerDown={(event) => { event.preventDefault(); run(onRename); }} onClick={(event) => { if (event.detail === 0) run(onRename); }}>
        <Pencil aria-hidden="true" />
        Rename
      </button>
      {kind === "section" && onColorChange ? <label className="row-color-picker" title="Choose notebook color">
        <Palette aria-hidden="true" />
        <span>Notebook color</span>
        <input type="color" value={color ?? "#e65093"} onChange={(event) => onColorChange(event.target.value)} aria-label="Choose notebook color" />
      </label> : null}
      <button className="danger" type="button" role="menuitem" onPointerDown={(event) => { event.preventDefault(); run(onDelete); }} onClick={(event) => { if (event.detail === 0) run(onDelete); }}>
        <Trash2 aria-hidden="true" />
        Delete
      </button>
    </motion.div>
  );

  return createPortal(menu, document.body);
}
