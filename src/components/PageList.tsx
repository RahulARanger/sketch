import { FilePlus2, PanelLeftClose, PanelLeftOpen, Plus, Search } from "lucide-react";
import { useDeferredValue, useState, type MouseEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { NotePage } from "../types";
import { ROW_CONTEXT_MENU_EVENT, RowContextMenu } from "./RowContextMenu";

type PageListProps = {
  pages: NotePage[];
  activePageId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onAddSubpage: (page: NotePage) => void;
  onRename: (page: NotePage) => void;
  onDelete: (page: NotePage) => void;
  sectionsOpen: boolean;
  onToggleSections: () => void;
};

export function PageList({ pages, activePageId, onSelect, onAdd, onAddSubpage, onRename, onDelete, sectionsOpen, onToggleSections }: PageListProps) {
  const [query, setQuery] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; page: NotePage } | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const childrenByParent = new Map<string, NotePage[]>();
  pages.forEach((page) => {
    if (!page.parentId) return;
    const children = childrenByParent.get(page.parentId) ?? [];
    children.push(page);
    childrenByParent.set(page.parentId, children);
  });
  const orderedPages = pages
    .filter((page) => !page.parentId)
    .flatMap((page) => [page, ...(childrenByParent.get(page.id) ?? [])]);
  const visiblePages = deferredQuery ? orderedPages.filter((page) => page.title.toLowerCase().includes(deferredQuery)) : orderedPages;

  const openContextMenu = (event: MouseEvent<HTMLDivElement>, page: NotePage) => {
    event.preventDefault();
    onSelect(page.id);
    window.dispatchEvent(new Event(ROW_CONTEXT_MENU_EVENT));
    setContextMenu({ x: event.clientX, y: event.clientY, page });
  };

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
          <motion.div layout data-page-id={page.id} data-parent-id={page.parentId} initial={{ opacity: 0, y: 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -7 }} transition={{ duration: 0.18 }} className={`hierarchy-row ${page.parentId ? "subpage" : ""} ${page.id === activePageId ? "active" : ""}`} key={page.id} onContextMenu={(event) => openContextMenu(event, page)}>
            <motion.button className="hierarchy-main" type="button" onClick={() => { setContextMenu(null); onSelect(page.id); }} onDoubleClick={() => onRename(page)} aria-label={`${page.title}, ${page.parentId ? "Subpage" : "Page"}, ${page.textBlocks.length || page.strokes.length ? "Edited recently" : "Blank page"}`} whileTap={{ scale: 0.985 }}>
              <span className="row-copy"><strong>{page.title}</strong></span>
            </motion.button>
            {!page.parentId ? <div className="row-actions" data-no-window-drag><motion.button className="row-action row-add-subpage" type="button" onClick={() => onAddSubpage(page)} aria-label={`Add subpage under ${page.title}`} title="Add subpage" whileTap={{ scale: 0.9 }}><FilePlus2 /></motion.button></div> : null}
          </motion.div>
          ))}
        </AnimatePresence>
        {!visiblePages.length ? <p className="empty-pages">No pages found</p> : null}
      </div>
      {contextMenu ? <RowContextMenu x={contextMenu.x} y={contextMenu.y} title={contextMenu.page.title} kind="page" onRename={() => onRename(contextMenu.page)} onDelete={() => onDelete(contextMenu.page)} onClose={() => setContextMenu(null)} /> : null}
      <motion.button className="hierarchy-footer" type="button" onClick={onAdd} whileHover={{ paddingLeft: 22 }} whileTap={{ scale: 0.99 }}><Plus /> Add page</motion.button>
    </aside>
  );
}
