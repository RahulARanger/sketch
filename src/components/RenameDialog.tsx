import { Check, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { motion } from "motion/react";

type RenameDialogProps = {
  kind: "section" | "page";
  currentTitle: string;
  onCancel: () => void;
  onSave: (title: string) => void;
};

export function RenameDialog({ kind, currentTitle, onCancel, onSave }: RenameDialogProps) {
  const [title, setTitle] = useState(currentTitle);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const label = kind === "section" ? "section" : "page";

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const saveTitle = () => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      setError(`Enter a name for this ${label}.`);
      inputRef.current?.focus();
      return;
    }
    onSave(nextTitle);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    saveTitle();
  };

  return (
    <motion.div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
      <motion.section className="rename-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title" aria-describedby="rename-description" initial={{ opacity: 0, y: 6, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.985 }} transition={{ type: "spring", stiffness: 420, damping: 30 }}>
        <motion.button className="dialog-close" type="button" onClick={onCancel} aria-label={`Cancel renaming ${label}`} whileHover={{ rotate: 90 }} whileTap={{ scale: 0.9 }}><X /></motion.button>
        <span className="rename-dialog-icon"><Check /></span>
        <h2 id="rename-title">Rename {label}</h2>
        <p id="rename-description">Choose a name for this {label}.</p>
        <form onSubmit={submit}>
          <label className="rename-field">
            <span>Name</span>
            <input ref={inputRef} value={title} onChange={(event) => { setTitle(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveTitle(); } }} aria-label={`${label} name`} aria-invalid={Boolean(error)} aria-describedby={error ? "rename-error" : undefined} />
          </label>
          {error ? <p className="rename-error" id="rename-error" role="alert">{error}</p> : null}
          <div className="dialog-actions">
            <motion.button className="dialog-cancel" type="button" onClick={onCancel} whileTap={{ scale: 0.97 }}>Cancel</motion.button>
            <motion.button className="dialog-save" type="submit" whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}><Check /> Save name</motion.button>
          </div>
        </form>
      </motion.section>
    </motion.div>
  );
}
