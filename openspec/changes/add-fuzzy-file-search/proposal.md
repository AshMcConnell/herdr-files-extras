## Why

Finding a file in a big tree means expanding folder after folder. Every
coding editor and the terminal itself (fzf) answers this with a fuzzy
finder: type a few characters, pick from a ranked list. The Files panel
has no way to do that today.

## What Changes

- A search field in the Files panel; typing switches the panel from the
  tree to a flat, fuzzy-matched results list; clearing it (or Escape)
  returns to the tree.
- The candidate list is the focused folder's files, gathered recursively
  the first time a search starts: `git ls-files -co --exclude-standard`
  where git says it's a repo (so .gitignore holds), a pruned `find`
  otherwise. Like everything else in the panel, it runs on the machine
  the folder lives on, including remote spaces.
- fzf-style matching: subsequence match, scored by boundary and run
  bonuses, shorter paths winning ties; matched characters highlighted in
  the results.
- Keyboard: type to filter, up/down to move, enter to open the selection
  (a file previews; Escape leaves the search), and clicking a result
  opens it like clicking it in the tree.
- Results and candidates are capped, with a visible note when truncated,
  matching the tree's existing limits.

## Capabilities

### New Capabilities

- `file-search`: fuzzy search over the focused folder's files — the
  search field, candidate gathering (git/find, local or remote), scoring
  and ordering, result display with highlights, keyboard and click
  behaviour, limits.

### Modified Capabilities

<!-- None: openspec/specs/ is empty; browsing with an empty query is unchanged. -->

## Impact

- `mods/files-extras/main.js`: search state, the field and results list
  in render, key handling; tree rendering untouched when the query is
  empty.
- `mods/files-extras/fuzzy.js` (new): the scorer/matcher, pure functions
  so it can be tried without the app.
- No new dependencies, no keys.json changes, no mod.json change; `exec`
  gains `git ls-files` and `find` calls it doesn't make today (same
  programs the panel already trusts on the same machines).
