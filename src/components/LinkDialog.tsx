import { Link2, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { motion } from "motion/react";

type LinkDialogProps = {
  onCancel: () => void;
  onSave: (url: string) => void;
};

export function LinkDialog({ onCancel, onSave }: LinkDialogProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  const saveLink = () => {
    const entered = url.trim();
    if (!entered) { setError("Paste a web address."); inputRef.current?.focus(); return; }
    const normalized = /^https?:\/\//i.test(entered) ? entered : `https://${entered}`;
    try {
      const parsed = new URL(normalized);
      if (!parsed.hostname) throw new Error("Missing hostname");
      onSave(parsed.toString());
    } catch {
      setError("Enter a valid web address, such as https://example.com.");
      inputRef.current?.focus();
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); saveLink(); };

  return <motion.div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
    <motion.section className="link-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="link-title" aria-describedby="link-description" initial={{ opacity: 0, y: 6, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.985 }} transition={{ type: "spring", stiffness: 420, damping: 30 }}>
      <motion.button className="dialog-close" type="button" onClick={onCancel} aria-label="Cancel adding link" whileHover={{ rotate: 90 }} whileTap={{ scale: 0.9 }}><X /></motion.button>
      <span className="rename-dialog-icon"><Link2 /></span>
      <h2 id="link-title">Add a web link</h2>
      <p id="link-description">Paste a URL to place a clickable link card on the current page.</p>
      <form onSubmit={submit}>
        <label className="rename-field"><span>Web address</span><input ref={inputRef} value={url} placeholder="https://example.com" onChange={(event) => { setUrl(event.target.value); setError(""); }} aria-label="Web address" aria-invalid={Boolean(error)} /></label>
        {error ? <p className="rename-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><motion.button className="dialog-cancel" type="button" onClick={onCancel} whileTap={{ scale: 0.97 }}>Cancel</motion.button><motion.button className="dialog-save" type="submit" whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}><Link2 /> Add link</motion.button></div>
      </form>
    </motion.section>
  </motion.div>;
}
