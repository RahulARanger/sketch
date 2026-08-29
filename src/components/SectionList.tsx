import { BookOpen, PanelLeftClose, Plus, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { NoteSection } from "../types";

type SectionListProps = {
  sections: NoteSection[];
  activeSectionId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (section: NoteSection) => void;
  onClose: () => void;
  isOpen: boolean;
};

export function SectionList({ sections, activeSectionId, onSelect, onAdd, onDelete, onClose, isOpen }: SectionListProps) {
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
          <motion.div layout initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -7 }} transition={{ duration: 0.18 }} className={`hierarchy-row ${section.id === activeSectionId ? "active" : ""}`} key={section.id}>
            <motion.button className="hierarchy-main" type="button" onClick={() => onSelect(section.id)} whileTap={{ scale: 0.985 }}>
              <span className="section-book" style={{ color: section.color }}><BookOpen /></span>
              <span className="row-copy"><strong>{section.title}</strong><small>{section.pages.length} {section.pages.length === 1 ? "page" : "pages"}</small></span>
            </motion.button>
            <motion.button className="row-action" type="button" onClick={() => onDelete(section)} aria-label={`Delete section ${section.title}`} title="Delete section"><Trash2 /></motion.button>
          </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <motion.button className="hierarchy-footer" type="button" onClick={onAdd} whileHover={{ paddingLeft: 22 }} whileTap={{ scale: 0.99 }}><Plus /> Add section</motion.button>
    </motion.aside>
  );
}
