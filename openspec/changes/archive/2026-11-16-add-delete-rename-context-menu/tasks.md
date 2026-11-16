## 1. Shell primitives (`mods/files-extras/fileops.js`)

- [x] 1.1 Create `fileops.js` with the module's own `sh`/`shell`/`ps` helpers in the `download.js`/`upload.js` shape (host `exec` as an argument, `psq` imported from `download.js`), and a comment describing what the module is for
- [x] 1.2 Implement `renameEntry({ exec, platform, source, parent, from, to, on })`: refuse empty, `/`/`\`, `.`, `..`, and unchanged names in JS; one `listNames(exec, on, parent, platform)` check (own old name excluded) before any shell call; then `mv` via `sh` on the entry's machine, `Rename-Item -LiteralPath` only for a local Windows folder
- [x] 1.3 Implement `deleteEntry({ exec, platform, source, on })`: `rm -rf` on the entry's machine, `Remove-Item -LiteralPath … -Recurse -Force` only for a local Windows folder; throw with the stderr/stdout reason on non-zero exit

## 2. Menu state and flows (`mods/files-extras/main.js`)

- [x] 2.1 In `init`'s menu branch, build the rename input state (`InputState.new` holding `menu.name`, submit/change wired) and the `renaming`/`confirming` mode fields, keeping the "input state in init" convention
- [x] 2.2 Add the rename flow: mode switch on the Rename row / `r`, field render in `renderMenu`, `escape` back to the plain menu, submit runs `renameEntry` under the keep-alive pattern — popup stays open with the inline refusal reason on a refused or failed name, closes after the rename settles on success
- [x] 2.3 Add the delete flow: mode switch on the Delete row / `d`, confirm row naming the entry (folders say "and everything inside it"), `escape`/cancel back to the plain menu, confirm runs `deleteEntry` and closes the overlay in a `finally` after it settles
- [x] 2.4 Add toasts in the download/upload tone: success for rename and delete (naming `menu.on` for remote), one error toast naming the entry and reason on failure

## 3. Menu chrome

- [x] 3.1 Add the Rename… (`r`) and Delete… (`d`) rows to `renderMenu` with `download.svg`-style icons (reuse `file`/`folder` or add a small SVG under `mods/files-extras/`), keeping `enter`/`u`/`escape` behaviour unchanged
- [x] 3.2 Grow the popup `height` in `openMenu` from 106 to fit four rows (header + 4 × 32 + padding ≈ 170)

## 4. Tree keeps up

- [x] 4.1 In `refresh`'s folder loop, catch `loadFolder` failures per expanded folder and drop a vanished non-root folder from `this.folders` instead of setting the panel-wide error; the root keeps reporting through `this.error`

## 5. Docs and checks

- [x] 5.1 Update `README.md`: Rename/Delete bullets under "What it adds", `mv`/`rm` and `Rename-Item`/`Remove-Item` under "What it runs"
- [x] 5.2 Run `./install.sh` (or copy the folder) and `herdr-app check ~/.config/herdr-app/mods/files-extras`; fix anything it flags
- [x] 5.3 Walk the spec scenarios by hand on a local folder: right-click menu rows/keys, taken and separator names refused inline, escape backing out, delete confirm and cancel, tree showing the rename and a quiet collapse for a deleted expanded folder
