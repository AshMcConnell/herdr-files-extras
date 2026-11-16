# Files extras for Herdr

Herdr's Files panel with **right-click downloads**, **drag & drop uploads**,
and **Markdown previews**. Right-click a file to save a copy to this Mac, or
a folder to download it as a zip; a space on another machine works the same
way and the file is copied back from there. Drag files or folders from
Finder onto the tree to put them in the folder being browsed — on this
machine or on another one.

It is a fork of Herdr's shipped `files` mod, so the lazy tree, git status
marks and text preview stay exactly as they were.

![The Download menu over the Files panel](preview.png)

## What it adds

- **Right-click a file → Download…** A save panel opens at the last folder
  you used (the first time, `~/Downloads`). The file is copied there; on a
  space on another machine it is first brought back from that machine.
- **Right-click a folder → Download as zip…** The folder is zipped where it
  lives (`zip`, or a `.tar.gz` when that machine has no `zip`) and saved
  where you choose. Symlinks stay links.
- **Markdown preview** — `.md` files render with headings, lists, tables,
  checkboxes, quotes and fenced code, drawn by the same renderer as the
  [OpenSpec mod](https://github.com/AshMcConnell/herdr-openspec), instead of
  the plain code editor.
- **Drag & drop upload** — drop files or folders from Finder onto the tree:
  onto a folder row lands them inside it, onto the tree lands them in the
  browsed folder. A name that is already there arrives as `notes (2).txt`,
  never overwriting. **Right-click → Upload files…** opens the native file
  picker instead — and right-clicking the tree's empty space (an empty
  folder, say) offers it too, aimed at the browsed root. On a space on
  another machine the files are pushed through
  herdr-core (`hc file write`), and folders go as one archive that is
  extracted on the far end — byte-for-byte, verified with the same `cmp`
  you would run on a local copy.
- **Right-click → Rename… and Delete…** — the menu turns into a name field
  holding the current name (the stem preselected, like Finder) or a
  confirmation naming what goes — folders say everything inside it goes
  too. A name that is taken or carries a separator is refused in place,
  before anything happens; deletes are permanent on every machine, so the
  confirmation is the safeguard. Both run on the machine the entry lives
  on, and the tree catches up on its next refresh — a folder deleted while
  expanded just collapses, with no error.

Everything else is the shipped panel: it follows the focused pane's folder
(including a space on another machine), loads folders lazily, marks changed
files against git, and lists files with folders first.

## Install

Needs [Herdr](https://herdr.dev) (herdr-app) 0.1.16 or newer, tested on
0.1.16.

Copy `mods/files-extras/` into `~/.config/herdr-app/mods/`, then point the
Files panel in your layout at it. In a layout cloned from `main`, the
`panel-body` stack has a block with:

```json
{ "id": "files", "type": "block", "content": { "mod": "files" } }
```

change `files` to `files-extras`. Or ask your agent:

> Read ~/.config/herdr-app/AGENTS.md, then add this mod: herdr.dev/mods/AshMcConnell/herdr-files-extras

From a checkout of this repo, `./install.sh` copies the mod into place and
checks it; `./install.sh --watch` keeps reinstalling on every save, so Herdr's
hot reload picks changes up as you edit.

Keep the copied folder real: a symlink to a checkout outside
`~/.config/herdr-app` loads, but its icons fail to resolve and saves there do
not hot-reload (verified on the current version: the link loads and runs, an
edit in the checkout never reloads it).

## How downloading works

- **The save panel** is AppleScript's `choose file name` on macOS, so it
  starts in the last folder used and keeps the standard save behaviour.
  Elsewhere the mod uses Herdr's folder picker, adding ` (2)` to a name that
  is already taken. The last folder is remembered in Herdr's shared state as
  `files.download.folder`.
- **A local file** is a plain `cp`. **A file on another machine** is read
  with `wc -c`, then `dd` and `base64` in 4 MiB pieces (Herdr's `exec` output
  is capped at 8 MiB), kept as small temp files under
  `~/.config/herdr-app/data/`, and decoded here with `base64 -D`. Very large
  remote files therefore take a while.
- **A folder** is zipped on the machine it lives on (`zip -qry` from its
  parent, so the archive holds the folder itself). Without `zip`,
  `tar -czf` is used and the suggested name ends `.tar.gz`. A failed zip
  leaves no partial archive behind.
- **Remote files need a Unix-like machine** (`sh`); a Windows remote is not
  supported yet. The local machine can be macOS, Linux or Windows.

## How uploading works

- **Dropping** files or folders from Finder onto the tree puts them in the
  browsed folder; dropping onto a folder row puts them inside that folder.
  **Right-click → Upload files…** opens the native file picker and
  uploads the chosen items into the right-clicked row's folder — a file
  row means its parent. On macOS the picker (an `NSOpenPanel` through
  `osascript`) selects files and folders together, several at a time;
  elsewhere it is PowerShell's `OpenFileDialog`, which is files-only, so
  folders arrive by dragging.
- **Names** never collide: one listing of the target decides, and a name
  that is taken arrives as `notes (2).txt`. Items already in the target are
  skipped and reported rather than copied onto themselves.
- **A local file** is a plain `cp`; **a local folder** a recursive copy.
- **A file on another machine** is pushed with `hc file write --on
  <machine>` — herdr-core reads the file from stdin on this Mac and writes
  it there, creating missing folders, in one call. A folder to another
  machine goes as a single archive (`zip`, or `tar.gz` by which tools exist
  on both ends) that is extracted on the far end and removed.
- The tree expands the folder you uploaded into and reloads, toasts report
  start, success (count and size) and any per-item failures. Temp archives
  under `~/.config/herdr-app/data/` are removed afterwards.

## What it runs

Like any Herdr mod it is trusted code. It runs `exec` with `sh`, `zip`,
`tar`, `base64`, `dd`, `wc`, `mv` and `rm`, plus `osascript` on macOS for
the save panel and the upload picker; on Windows it uses `powershell`
(`Copy-Item`, `Compress-Archive`, `Rename-Item`, `Remove-Item`, the
OpenFileDialog, base64 decode) and `cmd` for the upload redirect. Uploads
to another machine run local `hc` (herdr-core), which carries the file to
that machine. On a space on another machine the same commands run there
through herdr-core.

It writes only the file or archive you choose, plus temporary base64 pieces
and upload archives under `~/.config/herdr-app/data/`, which it removes
afterwards. It never writes into the folder it is browsing except the files
you asked to put there.

## Built on

- Herdr's shipped `files` mod (Apache License 2.0) — the panel this forks.
- [herdr-openspec](https://github.com/AshMcConnell/herdr-openspec) (MIT) —
  the Markdown renderer in `md.js`.

MIT licensed; see [LICENSE](LICENSE) and [NOTICE](NOTICE).
