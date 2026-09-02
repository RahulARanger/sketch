import { PanelLeftClose, Plus } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type CSSProperties, type MouseEvent } from "react";
import type { NoteSection } from "../types";
import { ROW_CONTEXT_MENU_EVENT, RowContextMenu } from "./RowContextMenu";

type SectionListProps = {
  sections: NoteSection[];
  activeSectionId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (section: NoteSection) => void;
  onColorChange: (section: NoteSection, color: string) => void;
  onDelete: (section: NoteSection) => void;
  onClose: () => void;
  isOpen: boolean;
};

export function SectionList({ sections, activeSectionId, onSelect, onAdd, onRename, onColorChange, onDelete, onClose, isOpen }: SectionListProps) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; section: NoteSection } | null>(null);

  const openContextMenu = (event: MouseEvent<HTMLDivElement>, section: NoteSection) => {
    event.preventDefault();
    onSelect(section.id);
    window.dispatchEvent(new Event(ROW_CONTEXT_MENU_EVENT));
    setContextMenu({ x: event.clientX, y: event.clientY, section });
  };

  return (
    <motion.aside className={`hierarchy-panel section-list ${isOpen ? "" : "closed"}`} aria-label="Sections" aria-hidden={!isOpen} animate={{ opacity: isOpen ? 1 : 0, x: isOpen ? 0 : -14 }} transition={{ duration: 0.2, ease: "easeOut" }}>
      <div className="hierarchy-header">
        <h2>Sections</h2>
        <div className="hierarchy-header-actions">
          <motion.button className="icon-button" type="button" onClick={onAdd} aria-label="Add section" whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.9 }}><Plus /></motion.button>
          <motion.button className="icon-button" type="button" onClick={onClose} aria-label="Close sections" title="Close sections" whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.9 }}><PanelLeftClose /></motion.button>
        </div>
      </div>
      <div className="hierarchy-items">
        <AnimatePresence initial={false} mode="popLayout">
          {sections.map((section) => (
          <motion.div layout initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -7 }} transition={{ duration: 0.18 }} className={`hierarchy-row ${section.id === activeSectionId ? "active" : ""}`} key={section.id} style={{ "--section-color": section.color } as CSSProperties} onContextMenu={(event) => openContextMenu(event, section)}>
            <motion.button className="hierarchy-main" type="button" onClick={() => { setContextMenu(null); onSelect(section.id); }} onDoubleClick={() => onRename(section)} aria-label={`${section.title}, ${section.pages.length} ${section.pages.length === 1 ? "page" : "pages"}`} whileTap={{ scale: 0.985 }}>
              <span className="section-book" style={{ backgroundColor: section.color }} aria-hidden="true" />
              <span className="row-copy"><strong>{section.title}</strong></span>
            </motion.button>
          </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {contextMenu ? <RowContextMenu x={contextMenu.x} y={contextMenu.y} title={contextMenu.section.title} kind="section" color={contextMenu.section.color} onRename={() => onRename(contextMenu.section)} onColorChange={(color) => onColorChange(contextMenu.section, color)} onDelete={() => onDelete(contextMenu.section)} onClose={() => setContextMenu(null)} /> : null}
      <motion.button className="hierarchy-footer" type="button" onClick={onAdd} whileHover={{ paddingLeft: 22 }} whileTap={{ scale: 0.99 }}><Plus /> Add section</motion.button>
    </motion.aside>
  );
}
