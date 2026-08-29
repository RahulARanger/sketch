import { FileText, PanelLeftClose, PanelLeftOpen, Plus, Search, Trash2 } from "lucide-react";
import { useDeferredValue, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { NotePage } from "../types";

type PageListProps = {
  pages: NotePage[];
  activePageId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: (page: NotePage) => void;
  sectionsOpen: boolean;
  onToggleSections: () => void;
};

export function PageList({ pages, activePageId, onSelect, onAdd, onDelete, sectionsOpen, onToggleSections }: PageListProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const visiblePages = deferredQuery ? pages.filter((page) => page.title.toLowerCase().includes(deferredQuery)) : pages;

  return (
    <aside className="hierarchy-panel page-list" aria-label="Pages">
      <div className="hierarchy-header">
        <h2>Pages</h2>
        <div className="hierarchy-header-actions">
          <motion.button className="icon-button" type="button" onClick={onAdd} aria-label="Add page" whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.9 }}><Plus /></motion.button>
          <motion.button className="icon-button" type="button" onClick={onToggleSections} aria-label={sectionsOpen ? "Close sections" : "Open sections"} title={sectionsOpen ? "Close sections" : "Open sections"} whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.9 }}>{sectionsOpen ? <PanelLeftClose /> : <PanelLeftOpen />}</motion.button>
        </div>
      </div>
      <label className="page-search">
        <Search />
        <input aria-label="Search pages" placeholder="Search pages" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="hierarchy-items page-items">
        <AnimatePresence initial={false} mode="popLayout">
          {visiblePages.map((page) => (
          <motion.div layout initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -7 }} transition={{ duration: 0.18 }} className={`hierarchy-row ${page.id === activePageId ? "active" : ""}`} key={page.id}>
            <motion.button className="hierarchy-main" type="button" onClick={() => onSelect(page.id)} whileTap={{ scale: 0.985 }}>
              <span className="page-icon"><FileText /></span>
              <span className="row-copy"><strong>{page.title}</strong><small>{page.textBlocks.length || page.strokes.length ? "Edited recently" : "Blank page"}</small></span>
            </motion.button>
            <motion.button className="row-action" type="button" onClick={() => onDelete(page)} aria-label={`Delete page ${page.title}`} title="Delete page"><Trash2 /></motion.button>
          </motion.div>
          ))}
        </AnimatePresence>
        {!visiblePages.length ? <p className="empty-pages">No pages found</p> : null}
      </div>
      <motion.button className="hierarchy-footer" type="button" onClick={onAdd} whileHover={{ paddingLeft: 22 }} whileTap={{ scale: 0.99 }}><Plus /> Add page</motion.button>
    </aside>
  );
}
