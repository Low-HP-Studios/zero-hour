# Release Process

This project ships desktop installers through GitHub Actions + `electron-builder`.

## Canonical flow

1. Update `package.json` version.
2. Commit and push your changes to `main`.
3. Create a semantic version tag:
   - `git tag vX.Y.Z`
   - `git push origin vX.Y.Z`
4. Wait for the `Build & Release` workflow to finish.
5. Open the GitHub release for that tag and verify assets.

## Required release assets

The release must include:

- macOS installer: `.dmg`
- Windows installer: `.exe`
- Linux installer: `.AppImage`
- updater metadata: `latest*.yml`
- updater integrity files: `.blockmap`

If any of these are missing, treat the release as broken.

## Auto-update behavior

- In-app checks run on launch for packaged builds.
- Update downloads are validated via SHA512 metadata.
- `Restart to install` applies downloaded updates.
- Repair mode:
  - Windows: downloads latest installer and launches reinstall flow.
  - macOS/Linux: opens latest release page for manual reinstall.

## Troubleshooting

- If a release only shows source zip/tarball, the workflow likely did not upload build artifacts.
- If updater says metadata missing, confirm `latest*.yml` and `.blockmap` were uploaded.
- If macOS update UX is rough, code signing/notarization is usually the bill collector.
