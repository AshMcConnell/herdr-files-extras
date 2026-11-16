# Project: files-extras (Herdr mod)

## Purpose

`files-extras` is a fork of Herdr's shipped `files` panel mod that adds
right-click downloads (single files, and folders zipped on their own
machine), uploads the other way (drag & drop from Finder onto the tree, or
a right-click picker, landing in the browsed folder — local or, through
`hc file write`, on another machine), and Markdown previews rendered with
the OpenSpec mod's renderer. Everything else follows the shipped panel: it
follows the focused pane's folder (including spaces on other machines),
loads folders lazily, marks changed files against git, and lists files with
folders first.

## Structure

- `mods/files-extras/main.js` — the View: folder tree, preview, right-click menu, drop targets.
- `mods/files-extras/download.js` — save-panel + copy/zip/base64-chunk logic (host calls passed as arguments so it can be tested without the app).
- `mods/files-extras/upload.js` — drop/picker upload logic, same shape: name uniquifying, local copies, `hc file write` pushes, folder archives.
- `mods/files-extras/md.js` — GFM-flavoured Markdown renderer (Tokyo Night palette).
- `mods/files-extras/*.svg` — icons, referenced as `mods/files-extras/<name>.svg`.

## Conventions

- gpui-kit / herdr mod rules apply (see `~/.config/herdr-app/AGENTS.md`):
  no `setTimeout`, no top-level `await`, every callback gets its own `cx`,
  never keep a `cx` for later; timers via `cx.timer` only for data.
- Colors come from `theme()`; sizes in px are deliberate — keep them.
- Shell work goes through `exec` with positional args (`"$1"`-quoted),
  Windows via PowerShell (`-NoProfile`), macOS save panel via `osascript`.
  Uploads to another machine run local `hc` with the file on stdin, never
  chunked argv.
- Keep `mod.json` `place: "none"`; the layout places the panel.
- After every change: `herdr-app check ~/.config/herdr-app/mods/files-extras`
  must pass (install the folder into `~/.config/herdr-app/mods/` first).

## Done when

- The panel follows the focused pane's folder, local and remote.
- Download works from the menu for files and folders, local and remote.
- Upload works by drop (tree → root, folder row → inside it) and from the
  menu's picker, local and remote, with conflicts renamed and self-uploads
  skipped.
- Markdown files render as Markdown; other text files open in the code editor.
