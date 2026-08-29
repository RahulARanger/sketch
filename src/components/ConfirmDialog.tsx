import { AlertTriangle, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { motion } from "motion/react";

type ConfirmDialogProps = {
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({ title, description, confirmLabel, onCancel, onConfirm }: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <motion.div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
      <motion.section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description" initial={{ opacity: 0, y: 6, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: 0.985 }} transition={{ type: "spring", stiffness: 420, damping: 30 }}>
        <motion.button className="dialog-close" type="button" onClick={onCancel} aria-label="Close confirmation" whileHover={{ rotate: 90 }} whileTap={{ scale: 0.9 }}><X /></motion.button>
        <span className="dialog-icon"><AlertTriangle /></span>
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-description">{description}</p>
        <div className="dialog-actions">
          <motion.button ref={cancelRef} className="dialog-cancel" type="button" onClick={onCancel} whileTap={{ scale: 0.97 }}>Cancel</motion.button>
          <motion.button className="dialog-delete" type="button" onClick={onConfirm} whileHover={{ y: -1 }} whileTap={{ scale: 0.97 }}>{confirmLabel}</motion.button>
        </div>
      </motion.section>
    </motion.div>
  );
}
