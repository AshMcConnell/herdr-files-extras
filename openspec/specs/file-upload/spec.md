# file-upload Specification

## Purpose
Bringing files and folders from this computer into the folder the Files
panel browses — by dropping them onto the tree or the menu's native
picker — with conflicts renamed (`name (2).ext`), self-uploads skipped,
and local and remote targets (the latter pushed through
`hc file write --on <machine>`) behaving the same.

## Requirements
### Requirement: Dropping onto the tree uploads into the browsed folder
The panel SHALL accept files and folders dropped onto the tree from
outside the app while it shows a browsed folder: a drop on a folder
row SHALL arrive inside that folder, a drop anywhere else on the tree
(including its empty or "No files" state) SHALL arrive in the browsed
root, and drops SHALL do nothing when the panel shows no folder. File
rows SHALL NOT be drop targets.

#### Scenario: Drop on a folder row goes inside it
- **WHEN** the user drags `report.pdf` from Finder onto the expanded
  folder row `docs`
- **THEN** `report.pdf` appears inside `docs` in the tree

#### Scenario: Drop on the tree's empty space goes to the root
- **WHEN** the user drags three files onto the tree below the last row
- **THEN** all three appear at the browsed root, folders first as the
  tree sorts them

#### Scenario: No folder, no upload
- **WHEN** the panel shows "No folder" and the user drops a file on it
- **THEN** nothing is copied and no toast is shown

### Requirement: Right-click Upload opens the native picker
The row menu SHALL offer "Upload files…": on a folder row it targets
that folder, on a file row the file's parent folder. Right-clicking the
tree where there is no row — an empty folder, or the space below the
rows — SHALL open the same menu scoped to uploads alone, targeting the
browsed root, and SHALL do nothing when the panel shows no folder.
Choosing it SHALL open the platform's native picker with multiple
selection — on macOS an NSOpenPanel that selects files and folders
together, elsewhere (PowerShell) files only — resolve to the chosen
items or end silently when the person cancels, and the menu's
`u` key SHALL run it while `enter` keeps running Download and `escape`
keeps closing. A picked folder SHALL arrive whole, by the same path a
dropped folder takes.

#### Scenario: Upload into a folder row's folder
- **WHEN** the user right-clicks the folder row `assets`, picks
  "Upload files…", and selects two images
- **THEN** both images arrive inside `assets`

#### Scenario: Upload from a file row goes to its parent
- **WHEN** the user right-clicks the file row `src/main.js`, picks
  "Upload files…", and selects a file
- **THEN** it arrives in `src` alongside `main.js`

#### Scenario: A picked folder arrives whole
- **WHEN** the user picks "Upload files…" and selects a folder holding
  `a/b.txt` along with a loose file
- **THEN** both arrive — the folder with `a/b.txt` inside it, the file
  beside it — exactly as a drop of the same two items would

#### Scenario: Right-click on empty tree space targets the root
- **WHEN** the browsed folder is empty and the user right-clicks the
  tree's "No files" space and picks "Upload files…"
- **THEN** the picker opens and the chosen files arrive in the browsed
  root, the menu offering no Download, Rename or Delete

#### Scenario: Cancelling the picker copies nothing
- **WHEN** the user closes the native picker without choosing
- **THEN** no copy starts and no toast appears

### Requirement: Copies are renamed on conflict, never overwritten
An uploaded item whose name already exists in the target SHALL arrive
as `name (2).ext` and so on, decided against one listing of the
target's current names plus names claimed by earlier items of the same
drop or pick, so the originals are never replaced and no two items of
one batch collide.

#### Scenario: Existing name gains a suffix
- **WHEN** the target already holds `notes.txt` and the user uploads
  their own `notes.txt`
- **THEN** it arrives as `notes (2).txt`

#### Scenario: Two same-named items in one drop
- **WHEN** the user drops `logo.png` from two different folders onto
  the same target that has neither
- **THEN** they arrive as `logo.png` and `logo (2).png`

### Requirement: Folders arrive whole
An uploaded folder SHALL be copied recursively: with `cp -R` /
`Copy-Item -Recurse` for a local target; for a remote target, zipped
(or tarred where `zip` is missing) locally, pushed as one archive
through `hc file write --on <machine>`, extracted on the remote
(`unzip`, or `tar -xzf` where unzip is missing), and the archive
removed. When the remote machine has neither unzip nor tar, the
folder SHALL fail with a clear notice while file uploads to it still
work.

#### Scenario: Local folder with nested content
- **WHEN** the user drops a folder containing `a/b.txt` onto the root
- **THEN** the tree gains the folder with `a/b.txt` inside it

#### Scenario: Remote folder lands extracted
- **WHEN** the panel browses a folder on another machine and the user
  drops a folder onto it
- **THEN** the folder is extracted on that machine under the drop
  target and no archive remains there

#### Scenario: Remote without an extractor
- **WHEN** the remote machine has neither `unzip` nor `tar` and the
  user drops a folder
- **THEN** a toast explains the folder could not be uploaded and the
  other dropped files still arrive

### Requirement: Remote targets upload through hc
When the browsed folder is on another machine, a file SHALL be pushed
by feeding it through local `hc file write --on <machine>` (a shell
redirect on macOS and Linux, cmd's redirect on Windows), creating
missing target folders, and the push SHALL be allowed the same 10
minute ceiling as downloads. Upload UX SHALL not differ between local
and remote targets beyond toasts naming the machine.

#### Scenario: File arrives byte-identical on the remote
- **WHEN** the user drops a 5 MiB binary file onto a remote space's
  folder
- **THEN** the file on the machine matches the source by content

#### Scenario: Toasts name the machine
- **WHEN** an upload to machine `mac-mini` finishes
- **THEN** the success toast reports it went to that machine

### Requirement: Self-uploads are skipped
An item whose path is the target folder or inside it SHALL be skipped
without a copy attempt and named in the result toast, so dropping
something the tree already holds cannot recurse onto itself or fail
obscurely.

#### Scenario: Dropping a file the browsed folder already holds
- **WHEN** the user drags a file from inside the browsed folder (shown
  in Finder) onto the tree root
- **THEN** nothing is copied and the toast says it was skipped

### Requirement: Uploads report progress and refresh the tree
Each upload SHALL toast when it starts (except a single local file,
which finishes before a toast could matter) and when it ends, with the
item count and total size on success and one error toast per failed
item. When an upload into an unexpanded folder succeeds, the panel
SHALL expand that folder and refresh so the arrivals are visible; the
root case SHALL just refresh. The panel SHALL ignore further uploads
while one batch is running.

#### Scenario: Success toast for a multi-item drop
- **WHEN** two files and a folder finish uploading
- **THEN** a success toast names the count and total size

#### Scenario: Failure toast per item
- **WHEN** one of three dropped files fails to copy
- **THEN** one error toast names that file and the reason, and the
  other two still arrive

#### Scenario: Unexpanded target opens to show the arrival
- **WHEN** a file is uploaded into a collapsed folder row
- **THEN** that folder expands showing the new file

#### Scenario: Drops during an upload are ignored
- **WHEN** a second drop lands on the tree while the first is still
  uploading
- **THEN** nothing starts from it and the first batch finishes

