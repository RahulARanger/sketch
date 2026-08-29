#!/usr/bin/env bash

set -euo pipefail

app_path="src-tauri/target/release/bundle/macos/BoSketchObs.app"
install_path="/Applications/BoSketchObs.app"

if [[ ! -d "$app_path" ]]; then
  echo "Build completed, but the app bundle was not found at: $app_path" >&2
  exit 1
fi

echo "Installing BoSketchObs to $install_path"
ditto "$app_path" "$install_path"
echo "Installed BoSketchObs."
