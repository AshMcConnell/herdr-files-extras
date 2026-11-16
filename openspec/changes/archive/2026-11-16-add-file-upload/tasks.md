## 1. Shared helpers in download.js

- [x] 1.1 Export `psq`, `asq`, `trimEnd`, `norm` from download.js (upload.js will import them; no behaviour change) and confirm `herdr-app check` still passes.
- [x] 1.2 Extend `hasZip`-style probing with a `extractor(exec, on)` helper in download.js (one `command -v` probe) for remote folder extraction — returns `"unzip"`, `"tar"`, or null, so the local half can pick a matching archive format.

## 2. upload.js — local copies

- [x] 2.1 Create `mods/files-extras/upload.js` with host calls passed as arguments, mirroring download.js's header comment.
- [x] 2.2 `listNames(exec, on, target, platform)`: one listing of the target's names (glob loop via `sh -c` positional args, PowerShell `Name` listing on Windows), returned as a Set.
- [x] 2.3 `uniqueNames(exec, on, target, names, platform)`: rename against the listing plus a claimed set using download.js's `addSuffix` (`notes.txt` → `notes (2).txt`).
- [x] 2.4 `uploadFile({ exec, platform, source, dest, on })`: local `cp` / `Copy-Item -Force`; remote via `hc file write --on` (sh redirect; `cmd /c` redirect on Windows) with timeout 600000, returning bytes (hc prints `{"bytes":N}`).

## 3. upload.js — folders, picker, batch

- [x] 3.1 `uploadFolder({...})`: local `cp -R` / `Copy-Item -Recurse`; remote: temp folder under `appHome()/data/`, `zip`/`tar -czf` locally, push the archive to a remote `mktemp -d`, extract (`unzip -qo` / `tar -xzf` via `extractor`), clean both temp dirs; skip-and-report when the target is the source or inside it (done in the batch driver).
- [x] 3.2 `pickUploads({ exec, platform, prompt })`: osascript `choose file with multiple selections allowed` (POSIX paths, silent cancel), PowerShell `-STA` `OpenFileDialog` Multiselect on Windows.
- [x] 3.3 `uploadItems({ ... })` batch driver: sequential per item, per-item try/catch, size totals, skipped-item list, results for toasts. Verified headlessly: 17/17 harness checks against real exec and mac-mini (describe, conflict renames, in-batch splits, self-skip, per-item failure, remote file byte-identical, remote folder extracted through both archive paths, temp cleanup).

## 4. main.js — drop targets

- [x] 4.1 `this.uploading` batch guard in init; `onDrop(paths, targetPath, cx)` orchestrating: guards on `this.root`/`this.current(context)`, calls upload.js, toasts, expands an unexpanded target folder, refreshes.
- [x] 4.2 `.on_drop` on each folder row (`cx.stop_propagation()` first) targeting that folder; `.on_drop` on the tree container targeting the root (covers the empty/"No files" state).

## 5. main.js — menu, picker entry

- [x] 5.1 Menu props gain `target` (folder to upload into: the row itself when a folder, its parent when a file); popup height 74 → 106 with a second row "Upload files…" (upload.svg icon, hint `u`); `u` runs it, `enter` keeps Download, `escape` keeps closing.
- [x] 5.2 `chooseUpload()` mirroring `choose()`'s keep-the-copy-alive pattern, calling `pickUploads` then the batch driver, closing the overlay when it settles.

## 6. Verification and docs

- [x] 6.1 `herdr-app check ~/.config/herdr-app/mods/files-extras` passes after each of the steps above.
- [x] 6.2 Manual pass against the spec's scenarios — automated portion done headlessly (the 17-check harness above covers conflict renames, self-skip, per-item failure, remote byte-check via `shasum`, folder extraction through both archive paths, temp cleanup); the interactive gestures (drag onto rows, the picker dialog, toasts) remain a hands-on pass in the app.
- [x] 6.3 Update README.md's feature list, RECIPE.md's menu/uploading sections, and `openspec/project.md`'s Purpose/Structure/Done-when to cover upload.
