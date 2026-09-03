import { AlignJustify, Check, CircleDot, Cloud, LoaderCircle, MonitorCog, Moon, Square, Sun, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { motion } from "motion/react";
import type { GoogleOAuthConfig } from "../googleDrive";

export type FontStyle = "system" | "rounded" | "serif" | "mono";
export type InterfaceSize = "comfortable" | "compact";
export type SheetBackground = "plain" | "dotted" | "ruled";

type SettingsPanelProps = {
  theme: "light" | "dark";
  accent: string;
  fontStyle: FontStyle;
  interfaceSize: InterfaceSize;
  sheetBackground: SheetBackground;
  windowTransparency: number;
  onThemeChange: (theme: "light" | "dark") => void;
  onAccentChange: (color: string) => void;
  onFontStyleChange: (font: FontStyle) => void;
  onInterfaceSizeChange: (size: InterfaceSize) => void;
  onSheetBackgroundChange: (background: SheetBackground) => void;
  onWindowTransparencyChange: (transparency: number) => void;
  googleOAuthConfig: GoogleOAuthConfig;
  googleConnection: "idle" | "testing" | "connected" | "error";
  googleError: string;
  onGoogleOAuthConfigChange: (next: GoogleOAuthConfig) => void;
  onTestGoogle: () => void;
  onConnectGoogle: () => void;
  onClose: () => void;
};

const ACCENTS = [
  { name: "Blue", color: "#3478f6" },
  { name: "Purple", color: "#8a5cf5" },
  { name: "Pink", color: "#e65093" },
  { name: "Orange", color: "#e8782e" },
  { name: "Green", color: "#2fa66a" },
];

const FONTS: Array<{ id: FontStyle; label: string; description: string }> = [
  { id: "system", label: "System", description: "System interface type" },
  { id: "rounded", label: "Rounded", description: "Friendly and soft" },
  { id: "serif", label: "Serif", description: "Editorial notes" },
  { id: "mono", label: "Mono", description: "Technical work" },
];

export function SettingsPanel({ theme, accent, fontStyle, interfaceSize, sheetBackground, windowTransparency, googleOAuthConfig, googleConnection, googleError, onGoogleOAuthConfigChange, onTestGoogle, onConnectGoogle, onThemeChange, onAccentChange, onFontStyleChange, onInterfaceSizeChange, onSheetBackgroundChange, onWindowTransparencyChange, onClose }: SettingsPanelProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <motion.div className="settings-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      <motion.aside className="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title" initial={{ opacity: 0, x: 18, scale: 0.99 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 18, scale: 0.99 }} transition={{ type: "spring", stiffness: 360, damping: 30 }}>
        <header className="settings-header">
          <span className="settings-title-icon"><MonitorCog /></span>
          <div><h2 id="settings-title">Settings</h2><p>Make BoSketchObs feel like yours.</p></div>
          <motion.button ref={closeRef} className="sheet-close" type="button" onClick={onClose} aria-label="Close settings" whileHover={{ rotate: 90 }} whileTap={{ scale: 0.9 }}><X /></motion.button>
        </header>

        <div className="settings-content">
          <section className="settings-group">
            <div className="setting-label"><strong>Google Drive</strong><span>Use your own OAuth app credentials. They’re saved only for this user on this device.</span></div>
            <div className="google-settings-fields">
              <label><span>Client ID</span><input value={googleOAuthConfig.clientId} onChange={(event) => onGoogleOAuthConfigChange({ ...googleOAuthConfig, clientId: event.target.value })} placeholder="...apps.googleusercontent.com" autoComplete="off" /></label>
              <label><span>Client secret</span><input type="password" value={googleOAuthConfig.clientSecret} onChange={(event) => onGoogleOAuthConfigChange({ ...googleOAuthConfig, clientSecret: event.target.value })} placeholder="Your client secret" autoComplete="off" /></label>
            </div>
            <div className="settings-inline-actions">
              <button className="settings-action secondary" type="button" onClick={onTestGoogle} disabled={googleConnection === "testing"}><LoaderCircle /> {googleConnection === "testing" ? "Testing…" : "Test connection"}</button>
              <button className="settings-action" type="button" onClick={onConnectGoogle} disabled={googleConnection !== "connected"}><Cloud /> Connect Google</button>
            </div>
            {googleConnection === "connected" ? <small className="settings-status success">Google OAuth service is reachable.</small> : googleError ? <small className="settings-status error">{googleError}</small> : <small className="settings-status">Test your credentials before connecting.</small>}
          </section>

          <section className="settings-group">
            <div className="setting-label"><strong>Appearance</strong><span>Choose how the workspace looks.</span></div>
            <div className="segmented-control" aria-label="Appearance">
              <motion.button className={theme === "light" ? "selected" : ""} type="button" onClick={() => onThemeChange("light")} whileTap={{ scale: 0.97 }}><Sun /> Light</motion.button>
              <motion.button className={theme === "dark" ? "selected" : ""} type="button" onClick={() => onThemeChange("dark")} whileTap={{ scale: 0.97 }}><Moon /> Dark</motion.button>
            </div>
          </section>

          <section className="settings-group">
            <div className="setting-label"><strong>Window transparency</strong><span>Let macOS show what is behind the app.</span></div>
            <div className="transparency-control">
              <div className="transparency-readout"><span>More solid</span><strong>{windowTransparency}%</strong><span>More transparent</span></div>
              <input className="transparency-range" type="range" min="0" max="20" step="1" value={windowTransparency} onChange={(event) => onWindowTransparencyChange(Number(event.target.value))} aria-label="Window transparency" />
            </div>
          </section>

          <section className="settings-group">
            <div className="setting-label"><strong>Accent color</strong><span>Used for selections and primary actions.</span></div>
            <div className="accent-options">
              {ACCENTS.map((option) => <motion.button key={option.color} className={accent === option.color ? "selected" : ""} type="button" onClick={() => onAccentChange(option.color)} aria-label={`${option.name} accent`} title={option.name} style={{ backgroundColor: option.color }} animate={{ scale: accent === option.color ? 1.08 : 1 }} whileHover={{ scale: 1.12 }} whileTap={{ scale: 0.92 }}>{accent === option.color ? <Check /> : null}</motion.button>)}
            </div>
          </section>

          <section className="settings-group">
            <div className="setting-label"><strong>Font style</strong><span>System is the recommended default.</span></div>
            <div className="font-options">
              {FONTS.map((font) => <motion.button key={font.id} className={`font-option preview-${font.id} ${fontStyle === font.id ? "selected" : ""}`} type="button" onClick={() => onFontStyleChange(font.id)} whileHover={{ x: 3 }} whileTap={{ scale: 0.985 }}><span><strong>{font.label}</strong><small>{font.description}</small></span>{fontStyle === font.id ? <Check /> : null}</motion.button>)}
            </div>
          </section>

          <section className="settings-group">
            <div className="setting-label"><strong>Interface size</strong><span>Comfortable is optimized for pen and touch.</span></div>
            <div className="segmented-control" aria-label="Interface size">
              <motion.button className={interfaceSize === "comfortable" ? "selected" : ""} type="button" onClick={() => onInterfaceSizeChange("comfortable")} whileTap={{ scale: 0.97 }}>Comfortable</motion.button>
              <motion.button className={interfaceSize === "compact" ? "selected" : ""} type="button" onClick={() => onInterfaceSizeChange("compact")} whileTap={{ scale: 0.97 }}>Compact</motion.button>
            </div>
          </section>

          <section className="settings-group">
            <div className="setting-label"><strong>Sheet background</strong><span>Choose a calm surface for your notes.</span></div>
            <div className="sheet-background-options" role="radiogroup" aria-label="Sheet background">
              <motion.button className={`sheet-background-option sheet-preview-plain ${sheetBackground === "plain" ? "selected" : ""}`} type="button" role="radio" aria-checked={sheetBackground === "plain"} onClick={() => onSheetBackgroundChange("plain")} whileTap={{ scale: 0.97 }}><span className="sheet-preview"><Square /></span><strong>Plain</strong>{sheetBackground === "plain" ? <Check /> : null}</motion.button>
              <motion.button className={`sheet-background-option sheet-preview-dotted ${sheetBackground === "dotted" ? "selected" : ""}`} type="button" role="radio" aria-checked={sheetBackground === "dotted"} onClick={() => onSheetBackgroundChange("dotted")} whileTap={{ scale: 0.97 }}><span className="sheet-preview"><CircleDot /></span><strong>Dotted</strong>{sheetBackground === "dotted" ? <Check /> : null}</motion.button>
              <motion.button className={`sheet-background-option sheet-preview-ruled ${sheetBackground === "ruled" ? "selected" : ""}`} type="button" role="radio" aria-checked={sheetBackground === "ruled"} onClick={() => onSheetBackgroundChange("ruled")} whileTap={{ scale: 0.97 }}><span className="sheet-preview"><AlignJustify /></span><strong>Ruled</strong>{sheetBackground === "ruled" ? <Check /> : null}</motion.button>
            </div>
          </section>
        </div>
      </motion.aside>
    </motion.div>
  );
}
