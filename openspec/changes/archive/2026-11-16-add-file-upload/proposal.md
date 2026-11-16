## Why

The panel can copy things *out* (right-click → Download) but nothing
*in*: moving a file from this computer into the folder being browsed
means leaving the app for Finder or a terminal, and on a remote space
means scp by hand. Download and upload are complements; the panel
should do both.

## What Changes

- Drag & drop into the tree: files or whole folders dragged from
  outside the app (Finder, Explorer) land in the browsed folder.
  Dropping onto a folder row puts them inside that folder; dropping on
  the tree's empty space puts them at the root. Uses the host `on_drop`
  API, which hands over absolute local paths.
- Right-click → "Upload…" on a row: opens the native file picker
  (multiple selection on macOS via osascript; PowerShell's dialog on
  Windows) and copies the choice(s) into that row's folder — the row's
  own folder when it is a folder, its parent when it is a file.
- Copies are recursive and forgiving: a folder arrives whole; a name
  that already exists arrives as `name (2).ext`, decided per item the
  same way the download picker names saves (`uniquePath`); the original
  is never touched.
- Remote parity: when the browsed folder lives on another machine, the
  upload pushes the file through `exec` in base64 chunks sized for
  argv, reassembled on the remote machine — the reverse of
  `download.js`'s `fetchRemote`.
- Toasts at start and end (like download), with per-item failures
  reported; the tree refreshes when the copies land.

## Capabilities

### New Capabilities

- `file-upload`: bringing files and folders from this computer into
  the browsed folder — the two ways in (drop, picker), where things
  land, conflict naming, local and remote copies, progress and
  failure reporting.

### Modified Capabilities

<!-- None: openspec/specs/ is empty; browsing, preview, search and
     download are unchanged. -->

## Impact

- `mods/files-extras/main.js`: drop targets on the tree and folder
  rows, the Upload menu entry, upload orchestration and toasts; tree
  rows gain drop targets but keep click/right-click behaviour.
- `mods/files-extras/upload.js` (new): copy/push logic mirroring
  `download.js` — host calls passed as arguments so it can be tried
  without the app; reuses `download.js`'s `addSuffix`/`uniquePath`.
- No new dependencies, no keys.json or mod.json change; `exec` gains
  `cp`/`Copy-Item`/`osascript` calls it doesn't make today (programs
  the panel already trusts on the machines it already runs them on).
