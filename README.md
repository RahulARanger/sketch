# BoSketchObs

A drawing-first local notes app built with Tauri 2, React, and TypeScript.

## Run

```bash
rtk npm install
rtk npm run tauri dev
```

## Build and install on macOS

```bash
rtk npm run build:install
```

The release build installs as `/Applications/BoSketchObs.app`.

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
- Long-press pen options for color, stroke size, opacity, and pen/highlighter mode
- Theme-aware contrast pen: dark ink on light paper and white ink on dark paper
- System-style Settings for light/dark appearance, five accent colors, four font styles, and comfortable/compact interface sizing
- Wacom eraser-tip/button detection and temporary barrel-button panning across supported desktop WebViews; the macOS-specific native fallback is isolated to macOS
- Typed text blocks placed anywhere on the canvas
- Paste or import images, insert editable tables, and add or paste automatically recognized web links
- Content-aware board with native scrolling and scrollbars, Wacom panning, zoom, undo, and redo
- Folder-based workspaces: each section is a folder and each page is its own JSON drawing file
- Native save-location dialog and autosave after the first manual save
- Save-location chooser for a local folder or Google Drive folder, including Drive-folder creation
- Export the current page as a vector PDF
- Google Drive integration prepared with Google Identity Services, Drive folder browsing, and multipart document upload
- Reopen complete workspaces from Google Drive with clear loading and error feedback
- Signed automatic update checks for GitHub Releases
- Migration support for older Marginalia JSON documents and local sessions
- Keyboard shortcuts: `1–6`, `V`, `T`, `E`/Wacom `Eraser`, `H`, `Cmd/Ctrl+S`, `Cmd/Ctrl+N`, `Cmd/Ctrl+Z`

## Saving layout

Choose a folder with **Location → On this computer**. The app saves the notebook index as `.bosketchobs-index.json`, creates a folder for each section, and places every page inside its section folder as a `.bosketchobs.json` drawing file. Select the same root folder with **Open** to reopen it.

For Google Drive, choose **Location → Google Drive**, browse to the parent folder you want, or create a folder there, then use it. The app creates the same section-and-page structure in Drive. The Drive connection is requested only when you select that option.

## Google Drive setup

1. In your Google Cloud project, enable **Google Drive API** under **APIs & Services → Library**.
2. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**. Choose **Web application**.
3. Add both `http://localhost` and `http://localhost:1420` to **Authorized JavaScript origins**. This app uses Google’s token popup flow, so no redirect URI is configured.
4. Copy the client ID (it ends in `.apps.googleusercontent.com`) into a local `.env` file:

```bash
VITE_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
```

5. Restart `npm run tauri dev`, then select **Location → Google Drive → Continue with Google**.

The app requests `drive.file` for files it creates and `drive.metadata.readonly` only to show folder names. The access token is kept in memory and is not written into your notebook or repository.

## Release pipeline

See [RELEASING.md](RELEASING.md) for the `dev` quality workflow, `main` release workflow, signing-key setup, and automatic updater configuration.
