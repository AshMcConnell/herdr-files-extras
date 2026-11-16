# file-search Specification

## Purpose
TBD - created by archiving change add-fuzzy-file-search. Update Purpose after archive.
## Requirements
### Requirement: Search field switches the panel between tree and results
The Files panel SHALL show a search field, and while its query is empty
the panel SHALL show the file tree exactly as before; while the query is
non-empty the panel SHALL show a flat list of matching files in place of
the tree.

#### Scenario: Empty query leaves the panel unchanged
- **WHEN** the search field is empty
- **THEN** the panel shows the lazy tree with no extra rows or state

#### Scenario: Typing shows results
- **WHEN** the user types `mainjs` into the field
- **THEN** the tree is replaced by a flat list of files whose paths match
  `mainjs` as a fuzzy subsequence

#### Scenario: Clearing returns to the tree
- **WHEN** the user empties the field or presses Escape
- **THEN** the panel shows the tree again with its expanded folders and
  selection as they were

### Requirement: Candidates come from the focused folder on its own machine
The panel SHALL gather its search candidates recursively from the folder
it is browsing, running on that folder's machine (including remote
spaces), preferring `git ls-files -co --exclude-standard` where the
folder is in a git repository, falling back to a `.git`-pruned file
listing otherwise, and capping candidates at 20,000 with a visible
truncation note.

#### Scenario: Git repository respects ignore rules
- **WHEN** the user searches in a folder inside a git repository
- **THEN** candidates are the repository's tracked files plus untracked
  files, and files matched by .gitignore are absent from the results

#### Scenario: Folder outside any repository
- **WHEN** the user searches in a folder that is not in a git repository
- **THEN** candidates are its files gathered recursively, excluding
  `.git` contents

#### Scenario: Remote space searches on that machine
- **WHEN** the panel is following a folder on another machine
- **THEN** the candidate listing runs on that machine and its results
  search that folder

#### Scenario: Truncated candidates say so
- **WHEN** gathering stops at the 20,000-candidate cap
- **THEN** the panel shows a note that the search list was truncated

### Requirement: Results are ranked fzf-style with highlighted matches
The panel SHALL require the query to match each path as a
case-insensitive subsequence, SHALL rank matches best-first using
boundary and consecutive-run bonuses, gap penalties, and shorter paths
over longer on ties, SHALL show at most the top 200 with a note when
more exist, and SHALL distinguish the matched characters visually in
each result row.

#### Scenario: Boundary matches outrank scattered ones
- **WHEN** the query is `read` against `README.md` and
  `dist/vendor/reread.js`
- **THEN** `README.md` is ranked above `dist/vendor/reread.js`

#### Scenario: Matched characters are highlighted
- **WHEN** a result row is shown
- **THEN** the characters the query matched are drawn brighter than the
  rest of the path

#### Scenario: Long result lists are capped
- **WHEN** more than 200 paths match the query
- **THEN** the panel shows the best 200 and a note giving the count of
  further matches

### Requirement: Keyboard opens and leaves results
With the search field focused, the panel SHALL move the selection with
up/down, open the selected result with enter, and clear the query with
Escape; the selection SHALL be visible on the row it points at.

#### Scenario: Arrow keys move the selection
- **WHEN** results are shown and the user presses down then up
- **THEN** the selection moves one row down and back up, visible on the
  rows

#### Scenario: Enter opens the selected file
- **WHEN** a file result is selected and the user presses enter
- **THEN** the file opens in the preview exactly as clicking it in the
  tree would, and the query clears

#### Scenario: Escape clears the search
- **WHEN** results are shown and the user presses Escape
- **THEN** the field empties, the tree returns, and no results remain

### Requirement: Clicking a result opens it
Clicking a result row SHALL open that file in the preview and clear the
query, the same as opening it from the tree.

#### Scenario: Click opens the preview
- **WHEN** the user clicks a file result
- **THEN** the file previews and the panel returns to the tree view with
  the preview open

