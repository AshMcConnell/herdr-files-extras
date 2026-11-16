# Files extras

![The Download menu over the Files panel](preview.png)

A Herdr mod: the app's shipped Files panel, forked and given three extras. A
right-click menu downloads a file to this Mac (a file on another machine is
brought back from there) or downloads a folder as a zip, files and folders
can be dragged in from Finder — or picked from a native dialog — to land in
the folder being browsed, even when it lives on another machine, and `.md`
files preview as rendered Markdown. Everything else — the lazy tree, git
status marks, text preview — is the shipped panel.

## What you see

- **The panel** is a card: `background`, a 1 px `border`, radius 10, text
  13 px, clipped. Its header is 42 px tall, 14 px side padding, 8 px gap: a
  20 px **←** (only while a file is open), "Files" semibold, then the last
  path segment in 12 px `dim`, right-aligned and truncated.
- **Tree rows** are 28 px: left padding `8 + depth × 18`, right 8, gap 7,
  radius 7, `hover` background; a 12 px `dim` chevron (or a 12 px spacer for
  files), a 14 px `muted` file/folder icon, the name (flex 1, truncated),
  and a git mark in 11 px: `A` in `ansi2`, `D`/`U` in `ansi1`, `M` in
  `blocked`. Folders come first, then names in locale order.
- **The menu** is a 262 × 106 px pointer popup on `popover`, padded 5 px. The
  header row (9 px sides, 3 top, 5 bottom, 7 gap) has a 13 px file or folder
  icon in `muted`, the name truncated, and `on <machine>` in 11 px `dim`
  when the file lives elsewhere. Below it two 32 px rows: 9 px sides, 9 gap,
  radius 7, hover `hover`, a 14 px icon and an 11 px `dim` key hint —
  **Download…** for a file (**Download as zip…** for a folder) with `enter`,
  and **Upload files…** with `u`. Enter runs Download, `u` runs Upload; Esc
  or a press outside closes the menu.
- **Preview**: a selected file replaces the tree. The header shows its name;
  body text is a read-only editor at 12 px with the theme's syntax colours,
  or the Markdown view for `.md`. A NUL byte reads as "Binary file · no text
  preview"; unreadable files say so.

## The panel

- It follows the **focused pane**: `location()` returns a pinned
  `props.folder` if given, else the focused pane's `cwd`, the focused
  terminal's `cwd`, or the active space's `folder`. `on` is the space's
  `machine`; when a layout terminal block is focused (no pane), it is the
  machine prefix of its terminal address, if any. `props.file` opens one
  file relative to that folder, once.
- A folder is listed with one `sh -c` loop over `"$1"/* "$1"/.[!.]*`
  (skipping `.git`), or PowerShell `Get-ChildItem` on Windows — local or
  another machine, where a missing `sh` falls back to PowerShell. 500 per
  folder, 5,000 total.
- Folders expand lazily: one level loads on open, and only then. A 10 s
  timer refreshes; locally `watchFolder` does too. Git marks come from
  `git status --porcelain=v1 -z --no-renames --untracked-files=all` with
  `--no-optional-locks` and fsmonitor off, so it writes nothing under
  `.git`.
- The preview uses `readTextFile`, capped at 400,000 characters, with a
  language map for the editor.

## Downloading

- **The menu** is the same mod opened again:
  `openOverlay({ mod: "files-extras", kind: "popup", width: 262, height: 74,
  props: { menu: { source, name, dir, on } } })`. The copy's `init` returns
  as soon as `props().menu` exists, focuses a handle for Enter/Esc, and
  renders only the menu.
- **Choosing** closes the popup, then downloads in a plain async function
  (no `cx`), so closing the popup cannot cancel it. Success and failure are
  toasts with the saved path (and size for a file from another machine).
- **Where to save**: macOS runs `osascript` with
  `choose file name with prompt … default name … default location (POSIX
  file …)`. Candidate start folders are the remembered
  `files.download.folder` (shared state), `~/Downloads`, then home. A user
  cancel is silent; any other failure falls back to Herdr's `pickFolder`,
  which has no start folder, so the name is made unique there
  (`test -e`/`Test-Path`; `foo (2).txt`).
- **A file here** is `cp "$1" "$2"` (`Copy-Item` on Windows). **A file on
  another machine** is `wc -c`, then `dd if="$1" bs="$2" skip="$3" count=1`
  and `base64 | tr -d "\n"` for each 4 MiB piece. `exec` output is capped at
  8 MiB, so the piece is 4 MiB − 1: a multiple of 3, which means no piece
  ends in `=` inside the stream. The base64 is split into 1,000,000-character
  parts written by `writeTextFile` (its limit is 1 MiB) under
  `~/.config/herdr-app/data/files-download-<time>-<rand>/part-00000.b64`.
  One decode then writes the file: `cat "$dir"/part-*.b64 | base64 -D >
  dest` on macOS, `base64 -d` on Linux, `[IO.File]::WriteAllBytes` on
  Windows. The temp folder goes in a `finally`.
- **A folder** is zipped where it lives: locally
  `rm -f dest; cd src/.. && zip -qry dest name`, or `tar -czf` when the
  machine has no `zip`. On another machine it is zipped under `mktemp -d`,
  copied back like a file, then the temp folder is removed. The suggested
  name is `<folder>.zip` or `.tar.gz`, matching which tool exists.
- Refuse to save a folder archive inside that folder, or to copy a file onto
  itself. A failed local zip removes its partial archive.

## Uploading

- **Two ways in.** Dropping files or folders from outside the app onto the
  tree: a folder row takes them into that folder (its `on_drop` stops
  propagation), the tree itself takes them at the root — including over the
  empty "No files" state; file rows are not targets, like Finder. Or
  right-click → **Upload files…**: the row's folder when it is a folder, its
  parent when it is a file. The picker cannot take folders — they arrive by
  dragging.
- **The picker** is `osascript` with `choose file … with multiple selections
  allowed` on macOS (POSIX paths, one per line; a cancel is silent) and
  PowerShell's `OpenFileDialog` with `Multiselect` (`-STA`, NUL-joined)
  elsewhere. It runs in the popup copy, which stays open until the batch
  settles, exactly like a download.
- **Names**: one listing of the target's names (a glob loop like the tree's,
  NUL-separated), then `name (2)`, `name (3)`, … in JS against that set plus
  names earlier items of the same batch claimed — so a 50-file drop on
  another machine is one listing, not 50 `test -e` round trips, and two
  dropped `logo.png` files arrive as `logo.png` and `logo (2).png`. The
  original is never replaced.
- **A file here** is `cp "$1" "$2"` (`Copy-Item -Force` on Windows). **A
  file on another machine** goes through `hc file write --on <machine>`:
  a local `sh` (or `cmd /c` on Windows — cmd's `<` redirect is byte-safe,
  PowerShell's pipes are not) feeds the file to hc's stdin, and hc makes
  missing folders on the way. It prints `{"bytes":N}`, which becomes the
  toast's size. Verified: 5 MiB of random bytes in 0.4 s, SHA-256 equal.
- **A folder to another machine** is one archive: `zip -qry` here when the
  far end has `unzip` (probed once; Windows uses `Compress-Archive`), else
  `tar -czf` (tar ships with macOS, Linux and Windows 10's System32). The
  archive goes under `~/.config/herdr-app/data/files-upload-<time>-<rand>/`,
  is pushed as a single file to a `mktemp -d` on the machine, extracted into
  the target there (`unzip -qo`, `tar -xzf`), and both temp folders go in
  `finally`s. Without `unzip` or `tar` at the far end, folders fail with a
  clear toast while files still arrive.
- **Skips and toasts**: an item that is the target, inside it, or already
  sitting in it is skipped — dropping something the tree already holds
  cannot recurse onto itself. One batch at a time (`uploading`); a second
  drop during one is ignored. Toasts: start (except a single local file,
  which finishes before one could matter), success with count and size, one
  error per failed item (the rest still arrive), "Already here" when
  everything was skipped. Afterward the target folder is expanded if it was
  collapsed (the folder watch only refreshes folders already expanded), or
  the root reloads.

## The files

- `main.js` — the panel (from the shipped `files` mod), the menu, and the
  `download(menu)` / `uploadMenu(menu)` orchestrations, which call the
  helpers below.
- `download.js` — the download work, with every host call passed in as an
  argument: `chooseDestination`, `hasZip`, `downloadFile`, `downloadFolder`,
  `uniquePath`, `addSuffix`, `sizeText`, and the `extractor` probe uploads
  reuse. It imports nothing, so a plain Node script can exercise the shell
  commands with a fake `exec`.
- `upload.js` — the upload work, same shape: `describe` (what dropped paths
  are), `listNames`/`uniqueNames`, `uploadFile`, `uploadFolder`,
  `pickUploads`, and the `uploadItems` batch driver. Imports only
  `download.js`, so it runs under plain Node against a real `exec` — the
  remote paths included, through `hc exec --on`.
- `md.js` — the Markdown renderer, adapted from
  [herdr-openspec](https://github.com/AshMcConnell/herdr-openspec) (MIT),
  plus GFM tables. It uses the fixed Tokyo Night palette.
- `download.svg` — the lucide download glyph, `upload.svg` its reverse;
  chevron, file and folder icons are the shipped ones.

## Watch out

- `writeTextFile` stops at 1 MiB and `exec` at 8 MiB; the part and chunk
  sizes are set from those limits. Bigger limits allow bigger pieces.
- `exec` rejects for a machine it does not know, so the remote path has to
  be tested by wrapping `exec` to drop `on` and running locally.
- A popup takes the keyboard. Do not snapshot the focused folder inside the
  menu copy; pass `source` in its props.
- `herdr-app check` proves load and first render only. The menu is a
  separate copy with its own props, so check it with a throwaway copy whose
  `props().menu` is fixed.
- The Windows local branches (`Copy-Item`, `Compress-Archive`, the cmd
  redirect, the OpenFileDialog) are written but unproven; a Windows remote
  is not supported — it needs a PowerShell branch for reading, sizing and
  zipping.
- Row `on_drop` relies on `cx.stop_propagation()` keeping the tree's own
  drop handler quiet, the way the right-click handler does; the
  `uploading` guard is the backstop, so the worst case is a drop landing
  at the root instead of the folder row.
- `hc` has to be on the PATH `exec` sees; it is what herdr-core itself
  runs, so it is there in practice.
- The save-panel start folder is macOS-only; Herdr's own picker elsewhere
  cannot be given one.

## Done when

- `herdr-app check mods/files-extras` passes.
- Right-clicking a file opens the menu; Download opens a save panel at
  `~/Downloads` first, then the last folder used; the saved bytes match
  (`cmp`).
- Right-clicking a folder saves a zip that unzips to the same tree.
- On a space on another machine, both still work and the bytes match.
- A cancel in the save panel does nothing; a failure shows an error toast.
- Dropping files onto the tree lands them in the root, and onto a folder
  row inside it; a name already there arrives as `name (2).ext`, the
  original untouched.
- Upload files… picks several files into the row's folder (the parent, for
  a file row); a cancel copies nothing.
- Dropping a folder copies it whole, here and to another machine, with no
  archive or temp folder left behind (`ls /var/folders/*/*/T/tmp.*` count
  unchanged on the remote).
- Dropping a file already in the browsed folder toasts "Already here" and
  copies nothing; a failed item toasts its reason and the rest arrive.
- The upload harness (a Node script with a real `exec`, `on` through
  `hc exec --on`) passes: byte-identical remote files, extracted remote
  folders, conflict renames, in-batch splits, skips.
