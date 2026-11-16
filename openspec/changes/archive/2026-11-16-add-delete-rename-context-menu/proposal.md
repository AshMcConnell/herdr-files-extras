## Why

The right-click menu only moves files in and out of the folder — Download…,
Upload files… — so renaming something or getting rid of it means leaving the
panel for a terminal or Finder. Delete and rename are the two remaining
everyday file operations, and they belong next to Download and Upload in the
same menu, working the same on the browsed folder whether it is on this
machine or on a space on another one.

## What Changes

- **Right-click → Rename…** — the menu turns into a name field holding the
  current name (the stem preselected, like Finder). A name that is empty,
  carries a path separator, or is already taken in the row's folder is
  refused before anything moves; a valid one is renamed with `mv` on the
  machine the entry lives on (`Rename-Item` for a local Windows folder).
- **Right-click → Delete…** — the menu turns into a confirmation naming the
  entry (folders say "and everything inside it"); confirming deletes exactly
  the right-clicked path with `rm -rf` (`Remove-Item -Recurse -Force` locally
  on Windows). The delete is permanent on every machine — the confirmation is
  the safeguard — so local and remote behave the same, and cancelling or
  `escape` touches nothing.
- **Two new menu rows and keys** — `r` starts Rename, `d` opens Delete's
  confirmation; `enter` keeps running Download, `u` Upload, and `escape`
  keeps closing. The popup grows from two rows to four and the overlay's
  height follows.
- **The tree keeps up** — after a rename or delete the affected folder
  reloads, and a folder that no longer lists (just deleted here, or removed
  outside the app) is dropped from the expanded set instead of turning the
  whole panel into an error.
- **Toasts as usual** — failures name the entry and the reason; successes
  confirm what happened, naming the machine for a remote folder, matching
  the download/upload toast tone.

## Capabilities

### New Capabilities

- `file-rename-delete`: renaming and deleting entries from the right-click
  menu — the menu flows (name field, confirmation), naming rules and
  conflict refusal, execution on local, remote, and local-Windows folders,
  toasts, and the tree refresh afterwards.

### Modified Capabilities

<!-- none: Download and Upload requirements are untouched; the menu gains rows -->

## Impact

- `mods/files-extras/main.js` — the menu rows and keys, the popup height in
  `openMenu`, rename/delete handlers using the existing keep-alive overlay
  pattern, and the refresh loop pruning expanded folders that no longer list.
- New `mods/files-extras/fileops.js` — the rename/delete shell primitives,
  written like `download.js`/`upload.js` (host calls passed as arguments so
  the shell work runs without the app), reusing `upload.js`'s `listNames`
  for the conflict check.
- `README.md` — the "What it adds" list and "What it runs" (`mv`, `rm` via
  `sh`; `Rename-Item`, `Remove-Item` on Windows).
- Gate unchanged: `herdr-app check ~/.config/herdr-app/mods/files-extras`
  must pass once installed.
