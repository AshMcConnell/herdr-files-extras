## Context

The right-click menu already exists: `openMenu` opens this same mod as a
pointer popup with `props({ menu: { source, name, dir, on, target } })`, and
`renderMenu` draws two rows — Download (`enter`) and Upload files… (`u`) —
while `escape` closes. The popup copy runs its work with the keep-alive
pattern (`choose`/`chooseUpload`): closing the overlay early would cancel
its pending `exec` calls, so it closes in a `finally`, after the work
settles. All shell work goes through `exec` with positional args, on the
folder's machine when `menu.on` is set; a local Windows folder is the
exception that uses PowerShell. `upload.js` already exports `listNames` —
one listing of a folder's names — and `download.js` exports the quoting and
path helpers. The tree refreshes itself from a folder watch plus a 10s
timer; a menu-initiated upload relies on that too, so popup-initiated
changes never touch the panel copy directly.

## Goals / Non-Goals

**Goals:**

- Rename and delete the right-clicked entry from the same popup, on local
  folders, local Windows folders, and spaces on other machines.
- Both flows start and, when they need it, finish inside the menu: Rename
  swaps the rows for a name field, Delete swaps them for a confirmation.
- Names are checked before anything moves; nothing is ever overwritten.
- The tree reflects the change and never turns a deleted expanded folder
  into a panel-wide error.

**Non-Goals:**

- No undo, no trash/recycle-bin, no multi-select or batch delete.
- No moving entries between folders (rename changes the name, not the
  place), no new-folder / new-file menu entries.
- No changes to the Download and Upload flows or their keys.
- No redesign of the popup into a nested/submenu widget.

## Decisions

**The flows live in the popup, not in native dialogs or the tree rows.**
Native prompts (`osascript display dialog`) would only be nice on macOS and
leave Linux with nothing; inline tree-row editing needs editor state inside
`rows()` and a focus dance the search field already shows is delicate. The
popup is a real view with a focus handle, so Rename renders an `Input` row
(`InputState` built in `init`'s menu branch, like the search field is) and
Delete renders a confirm row; `escape` steps back to the plain menu, and
from the plain menu it still closes. One surface, every platform, no new
host APIs.

**Shell primitives go in a new `mods/files-extras/fileops.js`.** Neither
`download.js` (out of the machine) nor `upload.js` (in from this machine)
is about mutating entries where they live. The new module follows the same
shape — host calls (`exec`) as arguments, its own small `sh`/`shell`/`ps`
helpers, `psq` imported from `download.js` — so the shell work runs without
the app, and it reuses `upload.js`'s `listNames` for the conflict check.
One listing of the parent folder judges the rename; the entry's own old
name is excluded so a case-only rename stays possible.

**Rename refuses; it never auto-suffixes.** Uploads rename on conflict
(`notes (2).txt`) because the user never typed those names; here the user
typed this one, so a taken name is an error to show, not a suggestion to
second-guess. The check — empty, `/` or `\` in the name, `.`, `..`, or a
name already in the folder — runs before any shell call, and an unchanged
name just closes the popup. On failure the popup stays open with the
reason in it; on success it closes after the `mv` settles (keep-alive).

**Execution matrix: remote and local Unix via `sh`, local Windows via
PowerShell.** `mv` on the entry's machine when `on` is set (remotes are
Unix-only, as the README states); `Rename-Item -LiteralPath … -NewName` /
`Remove-Item -LiteralPath … -Recurse -Force` only for a local Windows
folder, matching how `listNames` picks. Paths handed to the shell are
always absolute — built from `this.root` — so a file called `-rf` or
`--help` can never be parsed as an option, and positional `"$1"` args keep
every character of the name quoted, wildcards included (that is why
`-LiteralPath` on the PowerShell side).

**Delete is permanent, with the confirmation as the only safeguard.** The
repo's standing rule is that local and remote behave the same, and remotes
have no trash to send anything to; a platform-split (Finder-trash locally,
`rm` remotely) would make the same gesture mean two things. So: the confirm
row names the entry, folders add "and everything inside it", and confirming
runs one `rm -rf` of exactly that path. Cancel and `escape` touch nothing.

**Two new keys: `r` and `d`; old keys untouched.** `enter`/`u`/`escape`
keep their meanings; in Rename mode Enter submits through the input's
submit event. The popup's `height` in `openMenu` grows from 106 to fit the
two new rows (header + 4 × 32 + padding = 170).

**The tree catches up on its own, but stops lying about vanished folders.**
The popup copy cannot reach into the panel copy, and menu-initiated uploads
already rely on the folder watch and the 10s timer — so does this. What
this change must fix: `refresh` loads every expanded folder and lets any
failure error the whole panel, so a deleted (or externally removed)
expanded folder would leave a permanent "Cannot list this folder". The
refresh loop gets a per-folder catch: a non-root expanded folder that no
longer lists is dropped from `this.folders`, and the panel moves on. If
the deleted or renamed entry was the open preview, the preview stays as it
is until the user navigates — the same as an external change today.

## Risks / Trade-offs

- [The popup closes and cancels in-flight shell work] → the keep-alive
  pattern already in `choose`/`chooseUpload`: `closeOverlay` runs in a
  `finally` after the operation settles, never before.
- [`rm -rf` on a wrong path] → the path comes only from the menu props
  built in `openMenu` (root + the row's relative path), one path per call,
  quoted as a positional arg, and the confirm step sits in front of it. No
  globs, no lists, no `cd`.
- [Windows path quirks (backslashes, trailing spaces)] → only `-LiteralPath`
  forms touch Windows, `psq` handles the curly-quote cases PowerShell
  reads as quotes, and name validation rejects separators so a rename can
  never smuggle a path.
- [The panel shows a stale tree for up to ~10s after a menu change] → same
  as menu-initiated uploads today; the watch shortens it when the change
  is inside a watched folder. Accepted, consistent.
- [Popup grows taller than some panes] → four rows ≈ 170px is shorter than
  the search field + a few rows; the overlay is a popup and floats.
