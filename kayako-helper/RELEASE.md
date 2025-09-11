### Minimal release build and sharing

Use this to build and package a minimal, shareable extension folder and zip, without node_modules.

1) Build and package

```bash
npm run release
```

This produces:
- `release/extension/` – minimal folder with only what the extension needs
- `release/kayako-helper.zip` – ready to share and install

Included files:
- `manifest.json`
- `icons/` and `images/` (if present)
- `dist/` build output (source maps are stripped)

2) Install the extension from the folder
- Chrome: open chrome://extensions, toggle Developer mode, "Load unpacked", select `release/extension/`.
- Edge: open edge://extensions, toggle Developer mode, "Load unpacked", select `release/extension/`.

3) Install the extension from the zip
- Chrome/Edge: drag-and-drop the zip to the extensions page (if allowed) or extract and use "Load unpacked".

Notes
- The package contains no `node_modules/`. All runtime code is bundled into `dist/` by Vite.
- If the native helper `kayako_helper.exe` is missing, ensure Python + PyInstaller are installed, then re-run `npm run release`.


