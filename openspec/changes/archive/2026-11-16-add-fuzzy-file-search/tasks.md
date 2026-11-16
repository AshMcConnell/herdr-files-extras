## 1. Scorer module

- [x] 1.1 Create `mods/files-extras/fuzzy.js`: `match(query, path)` returning `{ score, indices }` or null — case-insensitive subsequence with boundary bonuses (start, after `/ . - _`, camelCase humps), consecutive-run bonuses, gap penalty, shorter-path tie-break
- [x] 1.2 Add `rank(query, paths, limit)` sorting by score then path length, returning the top N with indices

## 2. Candidate gathering

- [x] 2.1 In `main.js`, add `candidates(context)`: `git ls-files -co --exclude-standard` piped through `head -n 20001` via `exec` with the context's `cwd`/`on`; on failure fall back to `find . -name .git -prune -o -type f -print | head -n 20001`
- [x] 2.2 Add the Windows-local PowerShell fallback (skip `.git`, cap, relative paths), matching `directory()`'s pattern
- [x] 2.3 Cache per context key; set `truncated` when the cap is hit; use the `current(context)` pattern so a context switch abandons a stale gather

## 3. Search UI

- [x] 3.1 Add the search field row under the header: InputState + Input styled to the panel, placeholder "Search files"
- [x] 3.2 Render the results list for a non-empty query: top 200 rows in the tree-row style (28px, icons), folder part dimmed, matched characters bright; truncation and "and N more" notes
- [x] 3.3 Keep the tree path untouched for an empty query; re-score per keystroke

## 4. Interaction

- [x] 4.1 Keyboard: up/down move a visible selection, enter opens the selected file via `show(path)` and clears the query, Escape clears (and blurs)
- [x] 4.2 Click on a result row: preview the file and clear the query
- [x] 4.3 Reset field, results, selection and candidates cache on a context switch

## 5. Verify

- [x] 5.1 `./install.sh` (check passes) and `herdr-app status` clean
- [x] 5.2 In the app: search in a git repo (ignored files absent), a non-repo folder, and a remote space; enter, click and Escape behave per spec
- [x] 5.3 Empty query renders the tree byte-identical to before; screenshot with `herdr-app shot` to compare rows
