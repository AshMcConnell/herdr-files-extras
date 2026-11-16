## Context

The panel copies things out (`download.js`: save panel, `cp`, remote
`dd | base64` chunks) but has no way in. The host API gives drops for
free — `on_drop` on any element hands over absolute local paths — and
`hc` (herdr-core), which the mod's `exec` already shares an
environment with, has grown real transfer commands:

- `hc file write --on <machine> <path>` — writes *piped stdin* as the
  file on that machine, making missing folders.
- `hc exec --on <machine>` — runs a program there.

Verified on this setup: `hc file write --on mac-mini` took a 5 MiB
random file in 0.4 s and landed it byte-identical (SHA-256 matched).
So remote push needs no chunking scheme of our own — a local shell
redirects the file into hc's stdin, and hc does the hop:

```sh
exec("sh", ["-c", 'hc file write --on "$1" "$2" < "$3"',
            "files-extras-upload", machine, remotePath, localPath])
```

Conventions as usual: no `setTimeout`, per-callback `cx`, positional
`"$1"` shell args, PowerShell for Windows, colors from `theme()`,
`herdr-app check` after every change.

## Goals / Non-Goals

**Goals:**

- Drag files/folders from outside the app into the tree: onto a folder
  row lands inside it, onto the tree's empty space lands in the root.
- Right-click → Upload on a row: native file picker (multi-select),
  choice lands in that row's folder (a file row means its parent).
- Auto-rename on conflicts (`name (2).ext`), per item, matching the
  download picker's convention; never overwrite.
- Local and remote targets behave the same, toasts included.
- Folders arrive whole: `cp -R` locally, archive → push → extract on
  remote.

**Non-Goals:**

- Dragging *out* of the tree (`drag_paths`) — download already covers
  getting files out; a later change could add it.
- Overwrite, delete, move or rename in the panel.
- Picking a *folder* in the upload dialog (files only, multi-select);
  folders arrive by drag & drop.
- A right-click menu on the tree background (root uploads happen by
  dropping anywhere on the tree).
- A progress bar beyond the existing toast pattern.

## Decisions

**1. Remote push runs `hc` locally, not a chunked exec scheme.**
The mod's `exec` has no stdin, so `hc file write` is fed by a local
`sh` redirect (`< "$3"`); the machine hop is hc's `--on`, and the mod
still uses its own `exec` *with* `on` for remote commands after that
(extract, rm). Windows has no `sh`: the branch runs
`cmd /c hc file write --on <m> <path> < <file>` — cmd's `<` redirect
is byte-safe, unlike PowerShell's object pipes. Alternatives
considered: chunked base64 over argv (~72 KiB/exec after Linux's
128 KiB per-arg cap; ~140 round trips for 10 MB — strictly worse than
the verified 12 MB/s single call), and `writeTextFile` part files
(it has no `on`; local-only).

**2. Remote folders go as one archive, mirroring download.**
`downloadFolder` zips on the remote and ships one file; upload is the
mirror: zip/tar locally into a temp folder under `appHome()/data/`,
`hc file write` the archive to a `mktemp -d` on the remote (host
`exec` with `on`), extract there (`unzip -qo`, or `tar -xzf` when
unzip is missing — probed once, like `hasZip`), then `rm -rf` the
temp dir. If the remote has neither unzip nor tar, folders fail with
a clear toast while files still upload. A local folder copy stays a
plain `cp -R` / `Copy-Item -Recurse`.

**3. Conflict naming decides from one listing, not per-item probes.**
`uniquePath` (download.js) probes `test -e` per candidate — one exec
each, which on a remote turns a 50-file drop into seconds of round
trips. Instead the target folder's names are listed once (a plain
`ls -A` / PowerShell `Name` listing, through `exec`), and names are
made unique in JS against that set plus names already claimed by
earlier items in the same batch (so two dropped `notes.txt` files
arrive as `notes.txt` and `notes (2).txt`). Reuses `addSuffix` from
download.js; `uniquePath` stays for the download picker.

**4. Drop targets: folder rows and the tree container.**
`on_drop` is per element; each folder row gets one (into that folder)
and the tree container gets one (root) — shown also over the empty/
"No files" state. File rows are not targets, like Finder. Row handlers
call `cx.stop_propagation()` first (the right-click handler already
does) so the container doesn't double-handle. On completion the target
folder is expanded if it wasn't (so the arrivals are visible) and the
tree refreshes explicitly — `watchFolder` would eventually show it,
but not for a folder that was never expanded. While a drop is in
flight, further drops on the same panel queue into the same batch
guard (`this.uploading`), mirroring `this.choosing`.

**5. The menu gains an Upload row; the picker is osascript or
PowerShell.**
The popup grows from 74 px to ~106 px with a second row ("Upload
files…", hint `u`; enter keeps meaning Download). On macOS:
`osascript choose file with multiple selections allowed`, POSIX paths
out, cancel (-128) silent; on Windows: `powershell -STA -NoProfile`
with `OpenFileDialog { Multiselect = true }`. Both existing patterns
(`chooseDestination`'s osascript, the PowerShell dialogs) are the
templates. Files only — folder picking would need a second dialog on
every platform for little gain over dropping.

**6. Self-upload is skipped, not attempted.**
Dropping an item whose path is the destination or inside it (browsing
a local folder and dropping something already in the tree) would make
`cp` recurse onto itself; such items are skipped and named in the end
toast, the same check `downloadFile` does (`norm(a) === norm(b)` plus
a prefix check for folders).

**7. Structure: a new `upload.js`, host calls passed in.**
Mirrors download.js exactly: `pickUploads`, `listNames`, `uniqueNames`,
`uploadFile`, `uploadFolder`, all taking `{ exec, platform, … }` so
they can be tried without the app. Small shared helpers (`psq`, `asq`,
`norm`) get exported from download.js instead of duplicated. main.js
keeps orchestration: batch loop, toasts, expand+refresh, guards on
`this.current(context)`.

**8. Toasts say where things went, like download's do.**
Start: "Uploading N items → <target>" (skipped when it's one local
file, which finishes before a toast could matter — download has the
same asymmetry). End: "Uploaded N items · <size>" with the last
destination folder, or an error toast per failed item with what
happened; timeouts on pushes are 600000 ms (the exec cap), the same
ceiling download's transfers run under.

## Risks / Trade-offs

- [hc missing from exec's PATH, or machine unreachable] → exec
  rejects; the item fails with the stderr in the toast. Files remain
  the common case and don't depend on anything beyond cp.
- [cmd /c quoting on Windows paths with spaces] → build the redirect
  with the same `psq`-style escaping discipline; positional args where
  the program takes them.
- [Name decided then taken by someone else before the copy lands] →
  same TOCTOU the download picker has; the panel is a single user's
  view and the window is milliseconds.
- [Remote without unzip/tar] → folder uploads error clearly; file
  uploads unaffected. Probed once per folder upload, not cached.
- [Huge files over a slow link exceed the 600 s exec ceiling] →
  verified ~12 MB/s to a LAN machine; ~7 GB before the ceiling. An
  exceeded push fails with the timeout error, nothing partial: hc
  writes only what it read (the redirect feeds a local file, and a
  failed `file write` is retried whole).
- [Drop-event propagation differs from click propagation in GPUI] →
  if `cx.stop_propagation()` doesn't stop the container's `on_drop`,
  the container handler will ignore drops while a row batch is in
  flight (`this.uploading`); behaviour degrades to "row drop lands in
  the row's folder only", never to a double upload, because names are
  uniquified against claimed names.
- [osascript refused by automation settings] → same fallback posture
  as download: a clear error toast; drag & drop remains the other way
  in.
