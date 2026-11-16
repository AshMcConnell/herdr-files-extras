## Context

The Files panel is a lazy tree (500 entries/folder, 5,000 total) with a
read-only preview; it follows the focused pane's folder, local or on
another machine (`on`), and already runs `git` there for status marks.
Panels are gpui-kit views: no terminal, no DOM. `download.js` set the
pattern of pure helper modules that take host calls as arguments so they
run without the app. `openspec/changes/add-fuzzy-file-search/proposal.md`
motivates the feature; `specs/file-search/spec.md` states the behaviour.

## Goals / Non-Goals

**Goals:**

- Type a few characters, see the focused folder's files ranked fzf-style,
  open one by click or enter; Escape returns to the tree.
- Works on every machine kind the panel already works on (local
  macOS/Linux/Windows, remote Unix spaces) with no new dependencies.
- The panel stays cheap when search is unused: nothing is gathered until
  the user types.

**Non-Goals:**

- Not shelling out to the `fzf` binary (see Decisions).
- No folder-name results, no search history, no multi-folder or
  cross-machine search; candidates are gathered once per folder context
  (a stale list during a long search session is acceptable).

## Decisions

- **Native scorer, not the fzf binary.** fzf is a full-screen terminal
  program; a panel can't host it, and requiring it on every remote space
  (and Windows) breaks the mod's "works wherever the panel works" rule.
  A subsequence matcher with fzf's bonus scheme is ~50 lines in
  `fuzzy.js`. Alternative rejected: piping `ls-files` into fzf via exec.
- **Candidates: `git ls-files -co --exclude-standard`, `find` fallback.**
  Where `git rev-parse` says repo (the panel already asks), tracked +
  untracked-but-not-ignored is exactly the tree's notion of "has files";
  the pipe is bounded with `head -n 20001` so huge repos can't hit exec's
  8 MiB output cap mid-line. Not a repo: `find . -name .git -prune -o
  -type f -print | head -n 20001`. Windows local: `Get-ChildItem
  -Recurse -Force` skipping `.git`, capped, relative paths — the pattern
  `directory()` already uses. Cap 20,000 with a truncated note, in the
  spirit of the tree's visible limits.
- **Scoring** (case-insensitive subsequence over the whole path):
  consecutive-run bonuses, boundary bonuses (start, after `/ . - _`,
  camelCase humps), gap penalty; ties break to the shorter path. Returns
  match indices so render can highlight matched characters. Pure module,
  host-free like `download.js`.
- **UI:** a slim field row under the header (placeholder "Search files"),
  InputState + Input from gpui-base styled to the panel. Non-empty query
  swaps the tree for a flat list of the top 200 scored results (plus an
  "and N more" note); rows reuse the tree row look (28px, icons), folder
  part dimmed, matched characters bright.
- **Opening:** a file result previews via the existing `show(path)` (so
  Markdown and code previews come free), then the query clears and the
  tree returns behind the preview. Keys: up/down move the selection,
  enter opens it, Escape clears the query.
- **Lifecycle:** candidates cache per context key; a context switch
  (panel follows another folder) resets field, results and selection via
  the same `current(context)` pattern `loadFolder` uses.

## Risks / Trade-offs

- [Huge non-repo folders make `find` slow] → bounded by `head`, the 30 s
  exec timeout, and a visible "Searching files…" state.
- [A stale candidate list after files change mid-search] → accepted
  (Non-Goal); clearing and retyping regathers on a new context only if
  the folder changed, so Escape + requery reuses the cache knowingly.
- [Input focus keeps the panel's keyboard] → Escape always clears and
  returns focus to browsing; clicking a terminal takes it back as usual.
- [Scoring every keystroke over 20k paths] → single pass of cheap char
  math per path (~ms); render capped at 200 rows.

## Migration Plan

Panel-only change; install with `./install.sh` and the layout needs
nothing. Rollback is reverting the folder. No state format changes:
`shared.json` keys are untouched.

## Open Questions

None blocking; selection wrap-around at list ends is left to taste
during implementation (no wrap keeps Escape-exit predictable).
