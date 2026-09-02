# BoSketchObs

A drawing-first local notes app built with Tauri 2, React, and TypeScript.

## License

BoSketchObs is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). It is intended for educational, personal, and other non-commercial use only. Commercial use, including use in paid applications or products, is not permitted under this license.

## Run

```bash
rtk npm install
rtk npm run tauri dev
```

## Build and install on macOS

```bash
rtk npm run build:install
```

The release build installs as `/Applications/BoSketchObs.app`. `npm run build:install` replaces the existing installed build, removes renamed duplicates with the same bundle identifier, stops a running copy first, and removes the temporary Tauri `.app` bundle after installation so Launchpad only sees one BoSketchObs installation.

## Build and install on Windows

Run these commands from PowerShell on Windows 10 or later:

```powershell
rtk npm install
rtk npm run build:windows
rtk npm run install:windows
```

This produces both an NSIS installer and an MSI in `src-tauri\\target\\release\\bundle`. The NSIS installer is configured for the current user and includes the WebView2 bootstrapper, so it can install the required runtime when it is missing. Build Windows installers on Windows; macOS does not provide the native Windows toolchain used by Tauri bundling.

## Current feature set

- Functional sections, each with its own page collection
- Create, switch, search, and delete pages
- Create, switch, and delete sections
- Confirmation dialog before destructive deletion
- Freehand drawing with six persistent pen/highlighter presets
- Selectable vector strokes: click with Select or lasso around handwriting to move or Delete/Backspace individual strokes
- Long-press pen options for color, stroke size, opacity, and pen/highlighter mode
- Theme-aware contrast pen: dark ink on light paper and white ink on dark paper
- System-style Settings for light/dark appearance, five accent colors, four font styles, and comfortable/compact interface sizing
- Wacom eraser-tip/button detection and temporary barrel-button panning across supported desktop WebViews; the macOS-specific native fallback is isolated to macOS
- Typed text blocks placed anywhere on the canvas
- Paste or import images, insert editable tables, and add or paste automatically recognized web links
- Content-aware board with native scrolling and scrollbars, Wacom panning, zoom, undo, and redo
- Folder-based workspaces: each section can use its own folder and each page is its own JSON drawing file
- Native save-location dialog, durable local drafts, close warnings, and autosave after the first manual save
- Save-location chooser for a local folder or Google Drive folder, including Drive-folder creation
- Export the current page as a vector PDF
- Google Drive integration prepared with Google Identity Services, Drive folder browsing, and multipart document upload
- Reopen complete workspaces from Google Drive with clear loading and error feedback
- Signed automatic update checks for GitHub Releases
- Migration support for older Marginalia JSON documents and local sessions
- Keyboard shortcuts: `1–6`, `V`, `T`, `E`/Wacom `Eraser`, `H`, `Cmd/Ctrl+S`, `Cmd/Ctrl+N`, `Cmd/Ctrl+Z`

## Saving layout

Choose a folder with **Save** or **Save as**. The selected section is saved in that folder, with its pages as `.bosketchobs.json` drawing files and a `.bosketchobs-section.json` config file beside them. Repeat **Save as** while another section is active to place it in a different folder. BoSketchObs also keeps an internal `bosketchobs-config.json` in its app-data directory; on launch it reads that config and reloads every saved local section from its own folder. Existing section destinations from older builds are migrated from local storage automatically, and duplicate folder assignments are rejected so one section cannot overwrite another section’s manifest. Existing workspaces with a `.bosketchobs-index.json` root file remain supported.

Before a destination is chosen, and while a section has unsaved edits, the complete notebook is also kept as a local draft in the app data directory. Closing with unsaved changes asks for confirmation and preserves that draft for the next launch. A successful Save removes the draft for the sections that were saved; edits in other unsaved sections remain recoverable.

For Google Drive, choose **Save as → Google Drive** while the section you want is active, browse to its folder, or create one there. Repeat this for other sections when they belong in different Drive folders. The Drive connection is requested only when you select that option.

## Google Drive setup

1. In your Google Cloud project, enable **Google Drive API** under **APIs & Services → Library**.
2. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**. Choose **Desktop app**.
3. No authorized domains or redirect URIs need to be entered. BoSketchObs opens Google in the system browser and uses a temporary loopback callback on `127.0.0.1`.
4. Copy the client ID (it ends in `.apps.googleusercontent.com`) into a local `.env` file:

```bash
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
VITE_GOOGLE_CLIENT_SECRET=your-client-secret
```

If Google reports that the client secret is missing, copy it from the downloaded Desktop OAuth client JSON into `VITE_GOOGLE_CLIENT_SECRET`. A desktop-app client secret cannot be kept private, so never reuse a server application's secret here.

5. Restart `npm run tauri dev`, then select **Location → Google Drive → Continue with Google**.

The app requests `drive.file` for files it creates and `drive.metadata.readonly` only to show folder names. The access token is kept in memory and is not written into your notebook or repository.

## Release pipeline

See [RELEASING.md](RELEASING.md) for the `dev` quality workflow, `main` release workflow, signing-key setup, and automatic updater configuration.

## DSH / MCP integration

The `dsh-bosketchobs/` bundle provides a dependency-free stdio MCP server for other agents. Set `BOSKETCHOBS_WORKSPACE` to a saved workspace folder containing `.bosketchobs-index.json`, then install the bundle in DSH or run `node dsh-bosketchobs/mcp/server.mjs`. Agents can inspect pages, understand drawing geometry, create editable vector diagrams, add text, move content, and organize sections/pages. Unsaved edits are backed up as a local app draft and restored by BoSketchObs on the next launch; the MCP server only exposes explicitly saved workspace files.
