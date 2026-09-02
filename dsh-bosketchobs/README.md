# dsh-bosketchobs

DSH plugin and stdio MCP server for BoSketchObs. It gives agents a structured way to inspect saved boards, understand page geometry, create vector diagrams, add notes, move content, and organize sections/pages.

## Configure

Set `BOSKETCHOBS_WORKSPACE` to the folder containing `.bosketchobs-index.json`. The server is intentionally file-backed because BoSketchObs persists a workspace as section folders and page JSON files.

```sh
export BOSKETCHOBS_WORKSPACE="/path/to/saved/workspace"
node mcp/server.mjs
```

The DSH bundle declares the same server under `dsh.mcpServers`. Install this directory as a local DSH plugin, or point the harness at its `package.json`.

## Tool behavior

- `workspace_overview`, `read_page`, and `inspect_page` are read-only.
- `create_diagram` emits the app's native stroke format, so diagrams remain editable.
- `move_content` handles text, strokes, images, tables, and links.
- `organize_workspace` changes explicit order/title maps and preserves ids.
- `delete_page` requires confirmation but still refuses file deletion; use the app UI for destructive deletion.
- `open_workspace` reveals the workspace folder and explains that a running app may need a manual reopen.

Unsaved edits are also backed up as a local app draft and restored by BoSketchObs on the next launch; the MCP server only exposes the explicitly saved workspace files.
