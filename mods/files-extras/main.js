// A lazy file browser for the focused pane's folder, with bounded read-only previews.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, writeTextFile, watchFolder, theme, settings, window, props,
  home, appHome, notify, openOverlay, closeOverlay, shared, setShared, pickFolder } from "herdr";
import { mdView } from "./md.js";
import { chooseDestination, downloadFile, downloadFolder, hasZip, sizeText } from "./download.js";

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
const PER_FOLDER = 500, TOTAL = 5000;

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

export default class Files extends View {
  init(_props, cx) {
    // The right-click menu is this same mod opened as a pointer popup with
    // props { menu: { source, name, dir, on } }: it draws just the menu.
    this.menu = props()?.menu ?? null;
    if (this.menu) { this.handle = cx.focus_handle(); this.handle.focus(); return; }
    this.saved = new Map();
    this.entries = new Map(); this.folders = new Set(); this.pending = new Set(); this.marks = {};
    this.code = null; this.md = null;
    // Keep inline link ids unique when more than one Files copy shows the
    // same markdown document (the panel and a pane, say).
    this.mdPrefix = `fmd-${Math.random().toString(36).slice(2, 8)}-`;
    // A pane or layout can open one file directly: props { file: "docs/x.md" }
    // (relative to the folder this copy follows). Cleared once shown, so the
    // 10-second refresh doesn't reopen it after the person goes back.
    this.wanted = typeof props()?.file === "string" ? props().file : null;
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
          await this.loadFolder(path, context);
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
    const source = `${this.root.replace(/[\\/]+$/, "")}/${path}`;
    openOverlay({ mod: "files-extras", kind: "popup", width: 262, height: 74,
      props: { menu: { source, name: entry.name, dir: entry.dir, on: this.on } } });
  }

  choose() {
    const menu = this.menu;
    closeOverlay(props().overlay);
    download(menu);
  }

  renderMenu() {
    const t = theme(), m = this.menu;
    return v_flex().id("files-menu").track_focus(this.handle).w_full().p(5).bg(t.popover).text_size(12.8)
      .on_key_down(e => {
        if (e.key === "enter") this.choose();
        else if (e.key === "escape") closeOverlay(props().overlay);
      })
      .child(h_flex().px(9).pt(3).pb(5).gap(7).items_center()
        .child(svg(`mods/files-extras/${m.dir ? "folder" : "file"}.svg`).size(13).flex_none().text_color(t.muted))
        .child(div().flex_1().min_w(0).truncate().child(m.name))
        .when(Boolean(m.on), el => el.child(div().flex_none().max_w(110).truncate().text_size(11).text_color(t.dim).child(`on ${m.on}`))))
      .child(h_flex().id("files-menu-download").h(32).px(9).gap(9).rounded(7).items_center().cursor_pointer().hover(s => s.bg(t.hover))
        .on_click(() => this.choose())
        .child(svg("mods/files-extras/download.svg").size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(m.dir ? "Download as zip…" : "Download…"))
        .child(div().text_size(11).text_color(t.dim).child("enter")));
  }

  render(cx) {
    if (this.menu) return this.renderMenu();
    if (key() !== this.context?.key) this.refresh(cx);
    const t = theme();
    return v_flex().id("files").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .when(Boolean(this.file), el => el.child(div().id("files-back").w(20).cursor_pointer().text_color(t.muted).on_click((_e, cx) => { this.show(null); cx.notify(); }).child("←")))
        .child(div().font_semibold().child("Files"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ?? this.root?.split(/[\\/]/).pop() ?? "")))
      .when(!this.file, el => el.child(v_flex().id("files-tree").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(this.rows("", 0, [], t))
        .when(Boolean(this.error) || !this.entries.get("")?.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.error || (this.loading ? "Loading files…" : this.root ? "No files" : "No folder"))))
        .when(this.limited, el => el.child(div().p(8).text_size(11).text_color(t.dim).child("File list limited to 500 entries per folder and 5,000 total")))))
      .when(Boolean(this.file), el => el.child(this.md !== null
        ? this.md === "" ? div().p(12).text_color(t.dim).child("Empty file")
          : v_flex().id(`files-extras-${this.mdPrefix}`).flex_1().min_h(0).overflow_y_scrollbar().child(mdView(this.md, this.mdPrefix))
        : this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(12).text_color(t.dim).child(this.fileError || "Loading file…")));
  }
}
