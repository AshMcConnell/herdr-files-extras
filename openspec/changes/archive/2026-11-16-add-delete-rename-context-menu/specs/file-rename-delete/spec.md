## ADDED Requirements

### Requirement: The row menu gains Rename and Delete
The right-click menu SHALL show, for file and folder rows alike, a
"Rename…" row with the `r` key and a "Delete…" row with the `d` key
beneath Download and Upload, and the popup SHALL grow to fit them. The
existing keys SHALL keep their meanings: `enter` runs Download, `u` runs
Upload, and `escape` closes the menu.

#### Scenario: Four rows over the right-clicked entry
- **WHEN** the user right-clicks the file `notes.txt`
- **THEN** the menu names it at the top and lists Download, Upload files…,
  Rename…, and Delete…

#### Scenario: Keys reach the new rows
- **WHEN** the menu is open and the user presses `r`, then `d` on another
  right-click
- **THEN** `r` opens the rename field and `d` opens the delete
  confirmation, while `enter` and `u` still run Download and Upload

#### Scenario: Escape still closes
- **WHEN** the plain menu is open and the user presses `escape`
- **THEN** the menu closes with nothing changed

### Requirement: Rename asks in the menu and refuses unsafe names
Choosing Rename SHALL turn the menu into a name field holding the entry's
current name, with a submit that runs the rename and `escape` returning to
the plain menu without changing anything. A name that is empty, contains
`/` or `\`, is `.` or `..`, or is already taken by another entry in the
row's folder SHALL be refused before any shell call, with the reason shown
in the menu itself and the field kept open for correcting. Submitting the
unchanged name SHALL just close the menu. Unlike uploads, a taken name
SHALL NOT be suffixed automatically.

#### Scenario: The field opens holding the old name
- **WHEN** the user picks Rename… on `notes.txt`
- **THEN** the menu shows a field whose text is `notes.txt`, ready to edit

#### Scenario: A taken name is refused in place
- **WHEN** the folder already holds `todo.txt` and the user renames
  `notes.txt` to `todo.txt` and submits
- **THEN** the menu stays open, says the name is already taken, and
  nothing on disk changes

#### Scenario: A name with a separator is refused
- **WHEN** the user types `../notes.txt` into the rename field and submits
- **THEN** the menu refuses it without running any command

#### Scenario: Escape backs out of the field
- **WHEN** the rename field is open and the user presses `escape`
- **THEN** the menu returns to its plain rows and nothing is renamed

#### Scenario: The same name simply closes
- **WHEN** the user opens Rename… on `notes.txt` and submits without
  editing
- **THEN** the menu closes and no command runs

### Requirement: Rename renames exactly the entry, wherever it lives
A valid rename SHALL move exactly the right-clicked path to the new name
inside its own folder — `mv` on the machine the entry lives on for local
Unix and remote folders, `Rename-Item -LiteralPath` for a local Windows
folder — and never touch sibling entries. Success SHALL toast the new
state of the entry (naming the machine for a remote folder) and failure
SHALL toast the entry and the reason, leaving the old name in place.

#### Scenario: Local file rename
- **WHEN** the user renames `notes.txt` to `ideas.txt` in a local folder
- **THEN** only that file's name changes and a success toast names it

#### Scenario: Remote folder rename
- **WHEN** the panel browses a space on machine `mac-mini` and the user
  renames the folder `reports` to `archive`
- **THEN** the folder is renamed by `mv` on that machine and the success
  toast names `mac-mini`

#### Scenario: Windows local rename
- **WHEN** the user renames `notes.txt` while the panel browses a local
  Windows folder
- **THEN** `Rename-Item -LiteralPath` performs the rename and a name with
  wildcard characters renames literally

#### Scenario: Failure leaves the old name
- **WHEN** the rename command fails because the folder is read-only
- **THEN** an error toast names `notes.txt` and the reason, and the file
  still sits under its old name

### Requirement: Delete confirms, then deletes exactly the entry
Choosing Delete SHALL turn the menu into a confirmation naming the entry —
a folder's confirmation SHALL say everything inside it goes too — with
`escape` or an explicit cancel returning to the plain menu and deleting
nothing. Confirming SHALL delete exactly the right-clicked path: `rm -rf`
on the entry's machine for local Unix and remote folders,
`Remove-Item -LiteralPath … -Recurse -Force` for a local Windows folder.
The delete SHALL be permanent on every machine, with no trash and no undo,
and the menu SHALL work the same on local and remote folders. Success
SHALL toast what was deleted and failure SHALL toast the entry and the
reason, keeping the popup's keep-alive behaviour so closing the menu never
cancels the running command.

#### Scenario: Confirming deletes the file
- **WHEN** the user picks Delete… on `notes.txt` and confirms
- **THEN** exactly that file is deleted and a success toast names it

#### Scenario: Cancelling deletes nothing
- **WHEN** the delete confirmation is open and the user presses `escape`
- **THEN** the menu returns to its plain rows and `notes.txt` remains

#### Scenario: A folder goes with its contents
- **WHEN** the user deletes the folder `build` and confirms
- **THEN** the confirmation said everything inside it goes too, and
  `build` and its contents are gone

#### Scenario: Remote delete acts on the far machine
- **WHEN** the panel browses a space on machine `mac-mini` and the user
  deletes `scratch.txt` there
- **THEN** `rm -rf` runs on `mac-mini` and the success toast names it

#### Scenario: Failure reports and keeps the entry
- **WHEN** the delete command fails because the entry is protected
- **THEN** an error toast names the entry and the reason, and the entry
  remains

### Requirement: The tree reflects renames and deletes without erroring
After a rename or delete, the tree SHALL show the change by its next
refresh: a renamed entry under its new name in its folder, a deleted
entry gone. An expanded folder that no longer lists — deleted here or
removed outside the app — SHALL be dropped from the expanded set and
collapses, and the panel SHALL NOT show a folder-listing error because of
it. An open preview of the renamed or deleted entry SHALL stay as it is
until the user navigates, as with any external change today.

#### Scenario: Renamed file shows under its new name
- **WHEN** `notes.txt` in the expanded folder `docs` is renamed to
  `ideas.txt`
- **THEN** the tree next shows `ideas.txt` inside `docs`

#### Scenario: Deleted expanded folder collapses quietly
- **WHEN** the expanded folder `build` is deleted
- **THEN** the tree drops the row on its next refresh and shows no error

#### Scenario: Remote change behaves like a local one
- **WHEN** a file is renamed on a space on another machine
- **THEN** the tree shows the new name within the panel's normal refresh,
  as it would locally
