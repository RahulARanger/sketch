# Releasing BoSketchObs

The `dev` branch runs tests and production web builds. A push to `main` repeats verification, builds signed macOS (Intel and Apple Silicon) and Windows installers, creates a GitHub Release, and publishes `latest.json` for the in-app updater.

Before the first GitHub release:

1. Create the repository and push both `main` and `dev`.
2. Add the contents of the ignored `.tauri/bosketchobs.key` file as the `TAURI_SIGNING_PRIVATE_KEY` repository secret. The generated key has no password, so `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` may be an empty secret.
3. Add the Google OAuth client ID as the `VITE_GOOGLE_CLIENT_ID` repository secret.
4. If the Google token exchange requires it, add the desktop client secret as the `VITE_GOOGLE_CLIENT_SECRET` repository secret.
5. Protect `main`, require the Quality workflow, and merge changes from `dev` through a pull request.
6. Bump the version in `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` before each merge to `main`. The release tag is `v<version>`, so a version cannot be released twice.

Back up `.tauri/bosketchobs.key` in a secure password manager. Losing it prevents existing installations from accepting future updates. Never commit it.
