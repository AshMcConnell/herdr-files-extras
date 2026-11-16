// A lazy file browser for the focused pane's folder, with bounded read-only previews.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState, InputState, Input, ScrollHandle } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, writeTextFile, watchFolder, theme, settings, window, props,
  home, appHome, notify, openOverlay, closeOverlay, shared, setShared, pickFolder } from "herdr";
import { mdView } from "./md.js";
import { chooseDestination, downloadFile, downloadFolder, hasZip, sizeText } from "./download.js";
import { describe, pickUploads, uploadItems } from "./upload.js";
import { renameEntry, deleteEntry } from "./fileops.js";
import { rank } from "./fuzzy.js";

function location() {
  // A pane or layout can pin the folder: props { folder: "/path" }. Without
  // it, follow the focused terminal as before.
  const pinned = typeof props()?.folder === "string" ? props().folder : null;
  const space = spaces().find(s => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pinned || pane?.cwd || f?.cwd || space?.folder, on, space: space?.id };
}
const key = () => JSON.stringify(location());
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
// Markdown is drawn by the OpenSpec mod's renderer (./md.js) instead of the
// plain code editor, so headings, lists, checkboxes, quotes and fenced code
// read as they do in the OpenSpec change viewer.
const MARKDOWN = new Set(["md", "markdown", "mdx"]);
// An absolute POSIX path, or a Windows drive path (`C:\…` / `C:/…`).
const absolutePath = (p) => p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
const baseName = (p) => p.split(/[\\/]/).pop();
const PER_FOLDER = 500, TOTAL = 5000;
// Search candidates: files only, capped like the tree is. The extra head
// line reports the truncation.
const FILE_CAP = 20000, RESULT_CAP = 200;

async function directory(path, on) {
  const windowsDirectory = async () => {
    // Windows PowerShell otherwise uses the console code page; exec decodes UTF-8.
    // Links keep directory attributes even when dangling; check their target.
    // Other reparse points (OneDrive's folders) have no LinkType and are folders.
    // PowerShell reads curly single quotes as quotes too, so they're doubled like '.
    const r = await exec("powershell", ["-NoProfile", "-Command", "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); & { param($p) @(Get-ChildItem -LiteralPath $p -Force -ErrorAction Stop | Where-Object Name -ne '.git' | Select-Object -First 501 | ForEach-Object { @{ name=$_.Name; dir=($_.PSIsContainer -and (-not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -or -not $_.LinkType -or ($_.Target -and [IO.Directory]::Exists(([IO.Path]::Combine([IO.Path]::GetDirectoryName($_.FullName), $_.Target[0])))))) } }) | ConvertTo-Json -Compress } '" + path.replace(/['‘’‚‛]/g, "$&$&") + "'"], { on });
    if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
    const result = JSON.parse(r.stdout || "[]");
    return Array.isArray(result) ? result : [result];
  };
  if (!on && window()?.platform === "windows") return windowsDirectory();
  const script = 'n=0; for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; name=${p##*/}; [ "$name" = .git ] && continue; if [ -d "$p" ]; then kind=d; else kind=f; fi; printf "%s\\0%s\\0" "$kind" "$name"; n=$((n+1)); [ "$n" -gt 500 ] && break; done; test -d "$1"';
  let r;
  try { r = await exec("sh", ["-c", script, "files", path], { on }); }
  catch (e) {
    if (on && String(e).includes("cannot start sh: program not found")) return windowsDirectory();
    throw e;
  }
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder");
  const fields = r.stdout.split("\0"), out = [];
  for (let i = 0; i + 1 < fields.length; i += 2) out.push({ name: fields[i + 1], dir: fields[i] === "d" });
  return out;
}

// The fuzzy search's candidate list for `root`, as paths relative to it:
// tracked + untracked-but-not-ignored files where git says repository, a
// .git-pruned recursive listing otherwise, files only and capped. It runs
// on the folder's machine, like everything else in this panel.
async function candidateList(exec, root, on) {
  if (!on && window()?.platform === "windows") return windowsFiles(exec, root);
  const r = await exec("sh", ["-c",
    'cd "$1" || exit 9; if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git ls-files -co --exclude-standard 2>/dev/null; else find . -name .git -prune -o -type f -print 2>/dev/null; fi | head -n 20001',
    "search", root], { on });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder's files");
  const lines = r.stdout.split("\n").filter(Boolean).map(p => p.replace(/^\.\//, ""));
  return { files: lines.slice(0, FILE_CAP), truncated: lines.length > FILE_CAP };
}

// The same for a local Windows folder, through PowerShell: git first
// (it works there too), a recursive Get-ChildItem otherwise.
async function windowsFiles(exec, root) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const r = await exec("powershell", ["-NoProfile", "-Command",
    `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); Set-Location -LiteralPath ${q(root)}; ` +
    `if (git rev-parse --is-inside-work-tree 2>$null) { git ls-files -co --exclude-standard 2>$null | Select-Object -First 20001 } ` +
    `else { Get-ChildItem -Recurse -Force -File | Where-Object { $_.FullName -notmatch '\\\\.git\\\\' } | Select-Object -First 20001 | ForEach-Object { $_.FullName.Substring((Get-Location).Path.Length + 1) } }`],
    { timeout: 120000 });
  if (r.code !== 0) throw new Error(r.stderr || "Cannot list this folder's files");
  const lines = r.stdout.split("\n").map(s => s.trim()).filter(Boolean);
  return { files: lines.slice(0, FILE_CAP), truncated: lines.length > FILE_CAP };
}

// Right-click → Download. Asked where to save every time, starting in the
// last folder used; a folder is zipped on its own machine first.
async function download(menu) {
  try {
    const platform = window()?.platform ?? "linux";
    const stored = shared("files.download.folder");
    const last = typeof stored === "string" ? stored : null;
    const zip = menu.dir ? await hasZip(exec, menu.on, platform).catch(() => true) : true;
    const name = menu.dir ? `${menu.name}.${zip ? "zip" : "tar.gz"}` : menu.name;
    const choice = await chooseDestination({
      exec, platform, pickFolder, name,
      last,
      home: home(),
      prompt: menu.dir ? `Download ${menu.name} as a zip` : `Download ${menu.name}`,
    });
    if (!choice) return;
    if (choice.folder !== last) setShared("files.download.folder", choice.folder);
    // A local file is a plain copy, and done before the toast could show;
    // everything else can take a while, so say it started.
    if (menu.on || menu.dir) notify({ title: menu.dir && !menu.on ? `Zipping ${menu.name}` : `Downloading ${menu.name}`, body: menu.on ? `From ${menu.on}` : choice.folder, level: "info" });
    const size = menu.dir
      ? await downloadFolder({ exec, platform, appHome: appHome(), source: menu.source, base: menu.name, dest: choice.path, on: menu.on, writeTextFile, zip })
      : await downloadFile({ exec, platform, appHome: appHome(), source: menu.source, dest: choice.path, on: menu.on, writeTextFile });
    notify({ title: `Downloaded ${menu.name}`, body: `${choice.path}${size ? ` · ${sizeText(size)}` : ""}`, level: "success", timeout: 8000 });
  } catch (e) {
    notify({ title: `Couldn't download ${menu?.name ?? "the file"}`, body: String(e?.message ?? e), level: "error", timeout: 12000 });
  }
}

// Right-click → Upload files…: the native picker, then the same batch
// a drop runs. Files and folders both — the picker returns paths, and
// describe decides what each one is, exactly as a drop does. The menu
// carries the absolute target folder and its machine.
async function uploadMenu(menu) {
  try {
    const platform = window()?.platform ?? "linux";
    const picks = await pickUploads({ exec, platform, prompt: `Upload files into ${baseName(menu.target)}` });
    if (!picks?.length) return;
    const items = await describe(exec, picks, platform);
    startToast(items, menu.on, menu.target);
    report(await uploadItems({ exec, platform, appHome: appHome(), items, target: menu.target, on: menu.on }), menu.target);
  } catch (e) {
    notify({ title: "Couldn't upload", body: String(e?.message ?? e), level: "error", timeout: 12000 });
  }
}

// The "it started" toast: not for a single local file, which finishes
// before a toast could matter (the download flow has the same rule).
function startToast(items, on, targetPath) {
  if (items.length === 1 && !items[0].dir && !on) return;
  notify({ title: items.length === 1 ? `Uploading ${items[0].name}` : `Uploading ${items.length} items`,
    body: on ? `To ${on}` : targetPath, level: "info" });
}

// The end of a batch: an error toast per failed item, then one
// success toast — or an "already here" one when everything was
// skipped, which is worth saying on its own.
function report(r, targetPath) {
  for (const f of r.failed) notify({ title: `Couldn't upload ${f.name}`, body: f.message, level: "error", timeout: 12000 });
  const skipped = r.skipped.length > 3
    ? `${r.skipped.slice(0, 3).join(", ")} +${r.skipped.length - 3} more` : r.skipped.join(", ");
  if (r.uploaded) notify({ title: `Uploaded ${r.uploaded === 1 ? "1 item" : `${r.uploaded} items`}`,
    body: `${targetPath}${r.bytes ? ` · ${sizeText(r.bytes)}` : ""}${skipped ? ` · skipped ${skipped}` : ""}`,
    level: "success", timeout: 8000 });
  else if (!r.failed.length && r.skipped.length)
    notify({ title: "Already here", body: skipped, level: "info", timeout: 8000 });
}

export default class Files extends View {
  init(_props, cx) {
    // The right-click menu is this same mod opened as a pointer popup with
    // props { menu: { source, name, dir, on, target, parent } }: it draws
    // just the menu, which is either its rows, a rename field, or a delete
    // confirmation. The field's state is built here, in init, where the
    // live host call exists — the same rule as the search field.
    this.menu = props()?.menu ?? null;
    if (this.menu) {
      this.mode = "menu"; this.working = false;
      this.rename = { input: InputState.new({ value: this.menu.name }), error: null };
      this.rename.input.on("submit", (_e, cx) => this.doRename(cx));
      this.handle = cx.focus_handle(); this.handle.focus(); return;
    }
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.uploading = false;
    this.code = null; this.md = null;
    // Keep inline link ids unique when more than one Files copy shows the
    // same markdown document (the panel and a pane, say).
    this.mdPrefix = `fmd-${Math.random().toString(36).slice(2, 8)}-`;
    // A pane or layout can open one file directly: props { file: "docs/x.md" }
    // (relative to the folder this copy follows). Cleared once shown, so the
    // 10-second refresh doesn't reopen it after the person goes back.
    this.wanted = typeof props()?.file === "string" ? props().file : null;
    // Fuzzy search (fzf-style): the field's retained state is built here,
    // in init, where the live host call exists; the candidate list is
    // gathered once per folder, the first time a query is typed.
    this.search = { input: InputState.new({ placeholder: "Search files" }), query: "",
      files: null, truncated: false, loading: false, error: null, results: [], total: 0, selected: -1 };
    this.search.input.on("change", (_e, cx) => { this.search.query = this.search.input.value(); this.updateSearch(cx); });
    this.search.input.on("submit", (_e, cx) => this.openResult(cx));
    this.handle = cx.focus_handle();
    this.searchScroll = ScrollHandle.new();
    this.refresh(cx);
    cx.timer.every(10000, cx => this.refresh(cx));
  }

  watch(root, cx) {
    if (this.on || this.watched === root) return;
    this.watched = root;
    const context = this.context;
    cx.spawn(async cx => {
      try { while (this.context === context) { await watchFolder(root); if (this.current(context)) this.refresh(cx); } }
      catch { if (this.context === context) this.watched = null; }
    });
  }

  current(context) {
    return this.context === context && key() === context.key;
  }

  async loadFolder(path, context) {
    const { on, cwd: root } = context;
    const entries = await directory(path ? `${root}/${path}` : root, on);
    if (!this.current(context) || (path && !this.folders.has(path))) return;
    const used = [...this.entries.entries()].filter(([p]) => p !== path).reduce((n, [, e]) => n + e.length, 0);
    this.entries.set(path, entries.slice(0, Math.max(0, Math.min(PER_FOLDER, TOTAL - used))).sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name)));
    if (entries.length > PER_FOLDER || used + entries.length > TOTAL) this.limited = true;
  }

  refresh(cx) {
    const { cwd, on } = location(), next = key();
    if (next !== this.context?.key) {
      if (this.context) this.saved.set(this.context.key, { folders: this.folders, file: this.file });
      const saved = this.saved.get(next);
      const keep = this.file && absolutePath(this.file) ? this.file : null;
      this.context = { key: next, cwd, on }; this.root = cwd; this.on = on; this.entries = new Map(); this.folders = new Set(saved?.folders);
      this.pending = new Set(); this.marks = {}; this.show(keep, cx); this.watched = null; this.error = null; this.limited = false;
      this.loading = false;
      // The search belongs to the folder it was typed in.
      const s = this.search;
      s.files = null; s.truncated = false; s.loading = false; s.error = null; s.results = []; s.total = 0; s.selected = -1;
      if (s.query) { s.query = ""; s.input.set_value(""); }
      if (saved?.file && !keep) this.show(saved.file, cx);
    }
    if (this.wanted && (this.root || absolutePath(this.wanted))) { const file = this.wanted; this.wanted = null; this.show(file, cx); }
    if (!cwd || this.loading) return;
    const context = this.context;
    this.loading = true;
    this.limited = false;
    cx.spawn(async cx => {
      try {
        for (const path of ["", ...this.folders]) {
          if (!this.current(context)) return;
          try { await this.loadFolder(path, context); }
          catch (e) {
            // A folder that no longer lists — deleted here through the
            // menu, or outside the app — just collapses. Only the root
            // reports, as the panel-wide error it always was.
            if (path === "") throw e;
            this.folders.delete(path);
            this.entries.delete(path);
          }
        }
        const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
        const marks = {};
        if (top?.code === 0) {
          // Writes nothing under .git (index lock, fsmonitor cookie): the folder watch would refresh again.
          const status = await exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd, on }).catch(() => null);
          if (status?.code === 0) for (const entry of status.stdout.split("\0").filter(Boolean).slice(0, TOTAL)) {
            const xy = entry.slice(0, 2);
            marks[`${top.stdout.trim()}/${entry.slice(3)}`] = xy === "??" || xy.includes("A") ? "A" : xy.includes("U") ? "U" : xy.includes("D") ? "D" : "M";
          }
        }
        if (!this.current(context)) return;
        this.marks = marks; this.error = null; this.watch(cwd, cx);
      } catch (e) { if (this.current(context)) this.error = String(e); }
      finally { if (this.context === context) this.loading = false; cx.notify(); }
    });
  }

  toggle(path, cx) {
    if (this.folders.has(path)) {
      for (const folder of [...this.folders]) if (folder === path || folder.startsWith(path + "/")) {
        this.folders.delete(folder);
        this.entries.delete(folder);
      }
    } else {
      this.folders.add(path);
      if (!this.entries.has(path) && !this.pending.has(path)) {
        const context = this.context;
        this.pending.add(path);
        cx.spawn(async cx => {
          try { await this.loadFolder(path, context); }
          catch (e) { if (this.current(context)) this.error = String(e); }
          finally { if (this.context === context) this.pending.delete(path); cx.notify(); }
        });
      }
    }
    cx.notify();
  }

  show(path, cx) {
    this.code?.release(); this.code = null; this.md = null; this.file = path; this.fileError = null;
    if (!path || !cx) return;
    const context = this.context, root = this.root, on = this.on;
    const target = absolutePath(path) ? path : `${root}/${path}`;
    cx.spawn(async cx => {
      try {
        const text = await readTextFile(target, { on });
        if (this.file !== path || !this.current(context)) return;
        if (text === null) { this.fileError = "This file is no longer available"; return; }
        if (text.includes("\0")) { this.fileError = "Binary file · no text preview"; return; }
        const t = theme(), ext = path.includes(".") ? path.split(".").pop().toLowerCase() : "txt";
        const value = text.length > 400000 ? text.slice(0, 400000) + "\n… (file truncated)" : text;
        if (MARKDOWN.has(ext)) { this.md = value; return; }
        this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
          value, font_family: settings().font_family, font_size: 12,
          syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 } });
      } catch { if (this.file === path && this.current(context)) this.fileError = "Cannot preview this file (binary, too large, or unreadable)"; }
      finally { cx.notify(); }
    });
  }

  rows(prefix, depth, out, t) {
    if (out.length >= TOTAL || depth > 40) return out;
    for (const entry of this.entries.get(prefix) ?? []) {
      if (out.length >= TOTAL) break;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name, open = this.folders.has(path), mark = this.marks[`${this.root}/${path}`];
      out.push(h_flex().id(`file-${path}`).h(28).flex_none().pl(8 + depth * 18).pr(8).gap(7).items_center().rounded(7).cursor_pointer().hover(s => s.bg(t.hover))
        .on_click((_e, cx) => entry.dir ? this.toggle(path, cx) : this.show(path, cx))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openMenu(path, entry); })
        .when(entry.dir, el => el.on_drop((e, cx) => { cx.stop_propagation(); this.onDrop(e.paths, path, cx); }))
        .child(entry.dir ? svg(`mods/files-extras/chevron-${open ? "down" : "right"}.svg`).size(12).flex_none().text_color(t.dim) : div().w(12).flex_none())
        .child(svg(`mods/files-extras/${entry.dir ? "folder" : "file"}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(entry.name))
        .when(Boolean(mark), el => el.child(div().text_size(11).text_color(mark === "A" ? t.ansi2 : mark === "D" || mark === "U" ? t.ansi1 : t.blocked).child(mark))));
      if (entry.dir && open) this.rows(path, depth + 1, out, t);
    }
    return out;
  }

  openMenu(path, entry) {
    if (!this.root) return;
    const base = this.root.replace(/[\\/]+$/, "");
    const source = `${base}/${path}`;
    // Uploads go into the row's folder — the row itself when it is a
    // folder, its parent when it is a file. Rename and delete always act
    // on the row's parent, whatever the row is.
    const cut = path.lastIndexOf("/");
    const rel = entry.dir ? path : cut > 0 ? path.slice(0, cut) : "";
    const parent = cut > 0 ? `${base}/${path.slice(0, cut)}` : base;
    openOverlay({ mod: "files-extras", kind: "popup", width: 262, height: 170,
      props: { menu: { source, name: entry.name, dir: entry.dir, on: this.on, target: `${base}${rel ? `/${rel}` : ""}`, parent } } });
  }

  // Right-click on the tree itself — its empty space, the only target an
  // empty folder has: uploads into the browsed root, nothing else, since
  // there is no entry to download, rename or delete.
  openRootMenu() {
    if (!this.root) return;
    const base = this.root.replace(/[\\/]+$/, "");
    openOverlay({ mod: "files-extras", kind: "popup", width: 262, height: 74,
      props: { menu: { source: null, name: base.split(/[\\/]/).pop(), dir: true, on: this.on, target: base, rootMenu: true } } });
  }

  choose() {
    // Keep this copy (and its popup) alive until the download settles:
    // closing the overlay first would cancel this copy's pending calls,
    // so the save panel would never open and no toast could show.
    if (this.choosing) return;
    this.choosing = true;
    const overlay = props().overlay;
    download(this.menu).catch(() => {}).finally(() => closeOverlay(overlay));
  }

  chooseUpload() {
    // Same keep-alive as the download's chooser: the popup copy runs
    // the picker and the batch, and only closes once they settle.
    if (this.choosing) return;
    this.choosing = true;
    const overlay = props().overlay;
    uploadMenu(this.menu).catch(() => {}).finally(() => closeOverlay(overlay));
  }

  // The rename field: the current name again (the stem preselected, like
  // Finder), a refusal or failure shown in the menu with the field kept
  // open, and the popup closing only once a real rename has settled.
  startRename(cx) {
    this.mode = "rename";
    this.rename.error = null;
    this.rename.input.set_value(this.menu.name);
    const dot = this.menu.name.lastIndexOf(".");
    this.rename.input.set_selected_range({ start: 0, end: dot > 0 ? dot : this.menu.name.length });
    this.rename.input.focus();
    cx.notify();
  }

  // Back to the plain rows from the rename field or the delete
  // confirmation, keyboard and all.
  back(cx) {
    this.mode = "menu";
    this.handle.focus();
    cx.notify();
  }

  // The delete confirmation names what goes — a folder says everything
  // inside it goes too — and nothing has happened until it is confirmed.
  confirmDelete(cx) {
    this.mode = "confirm";
    cx.notify();
  }

  // Right-click → Rename, submitted from the field: refused names come
  // back without a toast (the menu shows them), a shell failure toasts
  // as well, and an unchanged name just closes. The keep-alive rule as
  // everywhere in this popup: the overlay closes after the work settles,
  // never while it runs.
  doRename(cx) {
    if (this.working) return;
    const m = this.menu, overlay = props().overlay;
    const to = this.rename.input.value().trim();
    this.working = true;
    this.rename.error = null;
    cx.notify();
    renameEntry({ exec, platform: window()?.platform ?? "linux", source: m.source, parent: m.parent, from: m.name, to, on: m.on })
      .then(moved => {
        if (moved) notify({ title: `Renamed ${m.name}`, body: `${moved}${m.on ? ` · on ${m.on}` : ""}`, level: "success", timeout: 8000 });
        closeOverlay(overlay);
      })
      .catch(e => {
        this.rename.error = String(e?.message ?? e);
        if (!e?.refusal) notify({ title: `Couldn't rename ${m.name}`, body: String(e?.message ?? e), level: "error", timeout: 12000 });
        cx.notify();
      })
      .finally(() => { this.working = false; });
  }

  // Right-click → Delete, confirmed: one path, permanent, and the popup
  // closes in a finally so the command is never cut short by its own menu.
  doDelete(cx) {
    if (this.working) return;
    const m = this.menu, overlay = props().overlay;
    this.working = true;
    deleteEntry({ exec, platform: window()?.platform ?? "linux", source: m.source, on: m.on })
      .then(() => notify({ title: `Deleted ${m.name}`, body: m.on ? `on ${m.on}` : m.parent, level: "success", timeout: 8000 }))
      .catch(e => notify({ title: `Couldn't delete ${m.name}`, body: String(e?.message ?? e), level: "error", timeout: 12000 }))
      .finally(() => closeOverlay(overlay));
  }

  // Keys follow the mode: in the rename field only escape is the
  // container's (typing and enter belong to the input); over the
  // confirmation enter confirms; on the plain rows the menu's own
  // shortcuts and escape-to-close hold.
  menuKey(e, cx) {
    if (this.mode === "rename") {
      if (e.key === "escape") this.back(cx);
      return;
    }
    if (this.mode === "confirm") {
      if (e.key === "enter") this.doDelete(cx);
      else if (e.key === "escape") this.back(cx);
      return;
    }
    if (e.key === "enter" && !this.menu.rootMenu) this.choose();
    else if (e.key === "u") this.chooseUpload();
    else if (e.key === "r" && !this.menu.rootMenu) this.startRename(cx);
    else if (e.key === "d" && !this.menu.rootMenu) this.confirmDelete(cx);
    else if (e.key === "escape") closeOverlay(props().overlay);
  }

  // Files dropped from outside the app: `target` is the folder they
  // land in, relative to the browsed root ("" for the root itself).
  // One batch at a time; the arrivals are revealed when it settles.
  onDrop(paths, target, cx) {
    if (!this.root || this.uploading || !paths?.length) return;
    const context = this.context, root = this.root, on = this.on;
    const platform = window()?.platform ?? "linux";
    const targetPath = `${root.replace(/[\\/]+$/, "")}${target ? `/${target}` : ""}`;
    this.uploading = true;
    cx.spawn(async cx => {
      try {
        const items = await describe(exec, paths, platform);
        startToast(items, on, targetPath);
        report(await uploadItems({ exec, platform, appHome: appHome(), items, target: targetPath, on }), targetPath);
      } catch (e) {
        notify({ title: "Couldn't upload", body: String(e?.message ?? e), level: "error", timeout: 12000 });
      } finally {
        this.uploading = false;
        if (this.current(context)) this.arrive(target, cx);
        cx.notify();
      }
    });
  }

  // Open the folder an upload landed in — or reload the root — so the
  // arrivals show right away. The folder watch would find them
  // eventually, but only in folders already expanded.
  arrive(target, cx) {
    if (target && !this.folders.has(target)) this.toggle(target, cx);
    else this.refresh(cx);
  }

  // Re-rank on every keystroke. The candidates are gathered once per
  // folder, on the first query; until they land the panel says it is
  // searching.
  updateSearch(cx) {
    const s = this.search, query = s.query.trim();
    if (!query) { s.results = []; s.total = 0; s.selected = -1; cx.notify(); return; }
    if (s.files === null && !s.loading) this.gatherFiles(cx);
    if (s.files !== null) {
      const { results, total } = rank(query, s.files, RESULT_CAP);
      s.results = results; s.total = total;
      s.selected = results.length ? 0 : -1;
      this.revealSelected();
    }
    cx.notify();
  }

  gatherFiles(cx) {
    const context = this.context;
    this.search.loading = true;
    cx.spawn(async (cx) => {
      try {
        const { files, truncated } = await candidateList(exec, this.root, this.on);
        if (!this.current(context)) return;
        this.search.files = files; this.search.truncated = truncated; this.search.error = null;
      } catch (e) {
        if (this.current(context)) { this.search.files = []; this.search.error = String(e?.message ?? e); }
      } finally {
        if (this.current(context)) { this.search.loading = false; this.updateSearch(cx); }
      }
    });
  }

  clearSearch(cx) {
    const s = this.search;
    s.input.set_value(""); s.query = ""; s.results = []; s.total = 0; s.selected = -1;
    cx.notify();
  }

  openResult(cx) {
    const r = this.search.results[this.search.selected];
    if (!r) return;
    this.clearSearch(cx);
    this.show(r.path, cx);
  }

  // Keep the selected row visible as the selection moves.
  revealSelected() {
    const s = this.search;
    if (s.selected < 0) return;
    const ahead = (s.error ? 1 : 0) + (s.loading && s.files === null && !s.error ? 1 : 0);
    this.searchScroll.scroll_to_item(s.selected + ahead);
  }

  key(e, cx) {
    const s = this.search;
    if (e.key === "escape") {
      cx.stop_propagation();
      if (s.query) this.clearSearch(cx);
      else s.input.release();
      cx.notify();
    } else if (e.key === "down" && s.results.length) {
      cx.stop_propagation();
      s.selected = Math.min(s.selected + 1, s.results.length - 1);
      this.revealSelected();
      cx.notify();
    } else if (e.key === "up" && s.results.length) {
      cx.stop_propagation();
      s.selected = Math.max(s.selected - 1, 0);
      this.revealSelected();
      cx.notify();
    }
  }

  field(t) {
    return h_flex().h(32).flex_none().px(10).gap(7).items_center().border_b(1).border_color(t.border)
      .child(svg("mods/workspace-chrome/search.svg").size(13).flex_none().text_color(t.dim))
      .child(Input.new(this.search.input).flex_1().h_full().text_size(12.5).text_color(t.foreground));
  }

  results(t) {
    const s = this.search;
    return v_flex().id("files-search").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.searchScroll).p(6)
      .when(Boolean(s.error), el => el.child(div().p(8).text_size(12).text_color(t.dim).child(s.error)))
      .when(s.loading && s.files === null && !s.error, el => el.child(div().p(8).text_size(12).text_color(t.dim).child("Searching files…")))
      .children(s.results.map((r, i) => this.resultRow(r, i, t)))
      .when(!s.results.length && s.files !== null && !s.loading && !s.error, el => el.child(div().p(8).text_size(12).text_color(t.dim).child("No matches")))
      .when(s.total > s.results.length, el => el.child(div().p(8).text_size(11).text_color(t.dim).child(`and ${(s.total - s.results.length).toLocaleString()} more matches`)))
      .when(Boolean(s.truncated), el => el.child(div().p(8).text_size(11).text_color(t.dim).child(`Search list truncated at ${FILE_CAP.toLocaleString()} files`)));
  }

  resultRow(r, i, t) {
    const s = this.search, matched = new Set(r.indices), base = r.path.lastIndexOf("/") + 1;
    // Styled runs laid out inline (h_flex + flex_none, like the markdown
    // renderer's words — a block child would wrap the line). Basename
    // first, so a long folder clips at its far end and the part being
    // picked stays visible. Brightness ladder: dim < muted < foreground,
    // so matches always read brighter than their surroundings.
    const runs = (from, to, hit, rest) => {
      const out = [];
      for (let j = from; j < to;) {
        const isHit = matched.has(j);
        let end = j + 1;
        while (end < to && matched.has(end) === isHit) end++;
        out.push(div().flex_none().text_color(isHit ? hit : rest).child(r.path.slice(j, end)));
        j = end;
      }
      return out;
    };
    return h_flex().id(`search-${i}`).h(28).flex_none().pl(8).pr(8).gap(7).items_center().rounded(7).cursor_pointer()
      .when(i === s.selected, el => el.bg(t.selected))
      .hover(st => st.bg(t.hover))
      .on_click((_e, cx) => { s.selected = i; this.openResult(cx); })
      .child(svg("mods/files-extras/file.svg").size(14).flex_none().text_color(t.muted))
      .child(h_flex().flex_1().min_w(0).overflow_hidden()
        .children(runs(base, r.path.length, t.foreground, t.muted))
        .children(runs(0, base, t.muted, t.dim)));
  }

  renderMenu() {
    const t = theme(), m = this.menu;
    // One menu row: icon, label, key hint, hover, click.
    const row = (id, icon, label, hint, on_click) => h_flex().id(id).h(32).px(9).gap(9).rounded(7).items_center().cursor_pointer().hover(s => s.bg(t.hover))
      .on_click(on_click)
      .child(icon ? svg(`mods/files-extras/${icon}.svg`).size(14).flex_none().text_color(t.muted) : div().w(14).flex_none())
      .child(div().flex_1().min_w(0).truncate().child(label))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(hint));
    const head = h_flex().px(9).pt(3).pb(5).gap(7).items_center()
      .child(svg(`mods/files-extras/${m.dir ? "folder" : "file"}.svg`).size(13).flex_none().text_color(t.muted))
      .child(div().flex_1().min_w(0).truncate().child(m.name))
      .when(Boolean(m.on), el => el.child(div().flex_none().max_w(110).truncate().text_size(11).text_color(t.dim).child(`on ${m.on}`)));
    return v_flex().id("files-menu").track_focus(this.handle).w_full().p(5).bg(t.popover).text_size(12.8)
      .on_key_down((e, cx) => this.menuKey(e, cx))
      .child(head)
      .when(this.mode === "rename", el => el
        .child(h_flex().h(32).px(9).items_center()
          .child(Input.new(this.rename.input).flex_1().h_full().text_size(12.5).text_color(t.foreground)))
        .child(div().px(9).min_w(0).truncate().text_size(11)
          .text_color(this.rename.error ? t.ansi1 : t.dim)
          .child(this.working ? "Renaming…" : this.rename.error || "enter renames · escape back")))
      .when(this.mode === "confirm", el => el
        .child(row("files-menu-delete-go", "trash", m.dir ? `Delete ${m.name} and everything inside it` : `Delete ${m.name}`, "enter", (_e, cx) => this.doDelete(cx)))
        .child(row("files-menu-delete-back", null, "Keep it", "escape", (_e, cx) => this.back(cx))))
      .when(this.mode === "menu", el => (m.rootMenu
        ? el.child(row("files-menu-upload", "upload", "Upload files…", "u", () => this.chooseUpload()))
        : el.child(row("files-menu-download", "download", m.dir ? "Download as zip…" : "Download…", "enter", () => this.choose()))
          .child(row("files-menu-upload", "upload", "Upload files…", "u", () => this.chooseUpload()))
          .child(row("files-menu-rename", "rename", "Rename…", "r", (_e, cx) => this.startRename(cx)))
          .child(row("files-menu-delete", "trash", "Delete…", "d", (_e, cx) => this.confirmDelete(cx)))));
  }

  render(cx) {
    if (this.menu) return this.renderMenu();
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme(), q = this.search.query.trim();
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .track_focus(this.handle)
      .on_key_down((e, cx) => this.key(e, cx))
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? "")))
      .child(this.field(t))
      .when(Boolean(q), el => el.child(this.results(t)))
      .when(Boolean(this.file) && !q, el => el.child(this.md !== null
        ? this.md === "" ? div().p(12).text_color(t.dim).child("Empty file")
          : v_flex().id(`files-extras-${this.mdPrefix}`).flex_1().min_h(0).overflow_y_scrollbar().child(mdView(this.md, this.mdPrefix))
        : this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")))
      .when(!this.file && !q, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .on_drop((e, cx) => this.onDrop(e.paths, "", cx))
        .on_mouse_down("right", (_e, cx) => { cx.stop_propagation(); this.openRootMenu(); })
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))));
  }
}
