import { Clock3, FileText, Search, Settings, Star, Tag, Trash2 } from "lucide-react";

type NotebookRailProps = {
  notebookTitle: string;
  saveState: "saved" | "saving" | "unsaved";
};

export function NotebookRail({ notebookTitle, saveState }: NotebookRailProps) {
  return (
    <aside className="notebook-rail" aria-label="Notebooks">
      <div className="brand"><span className="brand-mark" /><span>BoSketchObs</span></div>
      <nav className="rail-nav" aria-label="Notebook navigation">
        <button className="rail-button" type="button" aria-label="Search"><Search /></button>
        <button className="rail-button" type="button" aria-label="Recent"><Clock3 /></button>
        <button className="rail-button active" type="button" aria-label="Pages"><FileText /></button>
        <button className="rail-button" type="button" aria-label="Tags"><Tag /></button>
        <button className="rail-button" type="button" aria-label="Favorites"><Star /></button>
        <button className="rail-button" type="button" aria-label="Trash"><Trash2 /></button>
      </nav>
      <div className="rail-bottom">
        <button className="rail-button" type="button" aria-label="Settings"><Settings /></button>
        <div className={`save-indicator ${saveState}`}>
          <span className="save-dot" />
          {saveState === "saved" ? "Saved locally" : saveState === "saving" ? "Saving…" : "Unsaved"}
        </div>
      </div>
    </aside>
  );
}
