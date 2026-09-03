# Releasing BoSketchObs

BoSketchObs does not depend on GitHub Actions. Verify and build releases locally from the repository:

1. Bump the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Run `npm ci`, `npm test`, `npm run build`, and `cargo test --manifest-path src-tauri/Cargo.toml`.
3. Build the signed macOS app with `npm run build:macos` or Windows installers with `npm run build:windows`.
4. Upload the generated installers and updater metadata to the release host of your choice.

Back up `.tauri/bosketchobs.key` in a secure password manager. Losing it prevents existing installations from accepting future updates. Never commit it.
