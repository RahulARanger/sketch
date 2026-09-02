#!/usr/bin/env bash

set -euo pipefail

app_path="src-tauri/target/release/bundle/macos/BoSketchObs.app"
install_path="/Applications/BoSketchObs.app"
staging_path="${install_path}.new"
bundle_identifier="com.rahul.bosketchobs"

if [[ ! -d "$app_path" ]]; then
  echo "Build completed, but the app bundle was not found at: $app_path" >&2
  exit 1
fi

echo "Preparing BoSketchObs for installation"
rm -rf "$staging_path"
trap 'rm -rf "$staging_path"' EXIT
ditto "$app_path" "$staging_path"

# Stop the currently installed build before replacing its bundle. This avoids
# leaving the old executable running after a successful install.
for process_name in BoSketchObs bosketchobs; do
  if pgrep -x "$process_name" >/dev/null 2>&1; then
    echo "Stopping the existing BoSketchObs build ($process_name)"
    pkill -x "$process_name" || true
  fi
done

echo "Replacing the installed build at $install_path"
for candidate in /Applications/*.app; do
  [[ -d "$candidate" ]] || continue
  candidate_identifier="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$candidate/Contents/Info.plist" 2>/dev/null || true)"
  if [[ "$candidate_identifier" == "$bundle_identifier" ]]; then
    echo "Removing existing copy: $candidate"
    rm -rf "$candidate"
  fi
done
mv "$staging_path" "$install_path"
trap - EXIT

# The Tauri build output is only an installation source. Leaving this .app in
# the project directory makes macOS/Launchpad show a second BoSketchObs copy.
lsregister_path="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [[ -x "$lsregister_path" ]]; then
  "$lsregister_path" -u "$app_path" >/dev/null 2>&1 || true
fi
rm -rf "$app_path"

echo "Installed BoSketchObs."
