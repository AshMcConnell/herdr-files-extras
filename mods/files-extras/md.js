// The markdown body renderer, based on the OpenSpec mod's
// (https://github.com/AshMcConnell/herdr-openspec, MIT) so a markdown file
// opened in Files reads the same way as in the OpenSpec change viewer, plus
// GFM tables (which the OpenSpec viewer leaves literal).
//
// gpui-kit's TextView.markdown styles itself from the app theme, which is why
// the OpenSpec mod draws its own: this renderer colours every element from the
// fixed Tokyo Night palette below. Blocks: headings, fenced code, lists (one
// nesting level; deeper indents nest), blockquotes, rules, tables, paragraphs
// (consecutive non-block lines merge, like markdown). Inline: `code`, **bold**,
// *italic*, _italic_ and [text](url). Anything else — images, escapes — stays
// literal text: nothing is ever dropped.

import { div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { settings } from "herdr";

const NIGHT = {
  bg: "#1a1b26",    // --background-primary
  bgAlt: "#16161e", // --background-secondary (tab bar/footer chrome)
  border: "#292e42",// --background-modifier-border
  fg: "#c0caf5",    // --text-normal
  muted: "#a9b1d6", // --text-muted (unselected tabs)
  faint: "#565f89", // --text-faint (footer path, loading/absent/empty states)
  error: "#db4b4b", // --text-error (read failure)
  accent: "#bb9af7", // --magenta (the selected tab's underline)
};

const NIGHT_MD = {
  h: ["#ff757f", "#e0af68", "#9ece6a", "#7dcfff", "#7aa2f7", "#bb9af7"],
    // --h1-color..--h6-color: var(--red)/--yellow/--green/--cyan/--blue/--magenta
  bold: "#7dcfff",    // --bold-color: var(--cyan)
  italic: "#7dcfff",  // --italic-color: var(--cyan)
  link: "#bb9af7",    // --link-color and --link-external-color: var(--magenta)
  linkHover: "#7dcfff", // --link-color-hover/--link-external-color-hover: var(--cyan)
  codeBg: "#242838",  // --code-background: var(--bg_highlight_dark) (inline and fenced share it)
  codeFg: "#c0caf5",  // --code-normal: var(--fg)
  quoteBar: "#80d0ff",// the owner's Tokyo Night theme accent (hsl(202,100%,75%))
  quoteBg: "#16161e", // --blockquote-background-color: var(--bg_dark)
  hr: "#292e42",      // Obsidian's default --hr-color: var(--background-modifier-border)
  marker: "#565f89",  // Obsidian's default --list-marker-color: var(--text-faint)
  done: "#9ece6a",    // --checkbox-color: var(--green) (a checked task box)
};

// Block cap for a pathological file; change documents are a few KB.
const MAX_MD_BLOCKS = 2000;
// A table can be one block with an unbounded number of rows; cap them so a
// pathological file can't build a million elements.
const MAX_MD_TABLE_ROWS = 500;

// Heading text sizes on the 15px reading size, at roughly Obsidian's em
// proportions (1.8/1.5/1.34/1.2/1.1/1.0em): H1 at document scale. `mt` is the
// extra top margin for big headings (on top of the block gap) so they don't
// sit glued to the previous paragraph. Colours come from NIGHT_MD.h.
const MD_HEAD = [
  { size: 30, lh: "40px", mt: 14 }, { size: 22.5, lh: "30px", mt: 10 },
  { size: 19, lh: "26px", mt: 6 }, { size: 16.5, lh: "22px", mt: 2 },
  { size: 15, lh: "21px", mt: 2 }, { size: 14, lh: "20px", mt: 2 },
];

// A table row -> its cells, split on unescaped pipes and trimmed. A leading
// and trailing pipe are optional (GFM), and `\|` is a literal pipe.
function mdCells(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

// The `|---|:---:|` line under a table's header: every cell is dashes with
// optional alignment colons.
function mdTableSeparator(line) {
  const cells = mdCells(line);
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c));
}

// A markdown document -> { blocks, truncated }. Blocks are {kind:"h",level,text},
// {kind:"p",text}, {kind:"code",lang,lines}, {kind:"quote",text},
// {kind:"list",items:[{marker,depth,task,text}]} (task: null, or the checkbox
// state), {kind:"table",header,aligns,rows}, {kind:"hr"}.
function mdBlocks(text) {
  const lines = text.split(/\r?\n/), blocks = [];
  let para = null, truncated = false;
  const flush = () => { if (para) { blocks.push({ kind: "p", text: para }); para = null; } };
  for (let i = 0; i < lines.length; i++) {
    if (blocks.length >= MAX_MD_BLOCKS) { truncated = true; break; }
    const line = lines[i];
    if (/^\s*$/.test(line)) { flush(); continue; }
    const fence = /^\s*(`{3,}|~{3,})\s*(.*?)\s*$/.exec(line);
    if (fence) {
      flush();
      const close = new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`), code = [];
      let j = i + 1;
      for (; j < lines.length && !close.test(lines[j]); j++) code.push(lines[j]);
      blocks.push({ kind: "code", lang: fence[2] || "", lines: code });
      i = j; // past the closing fence, or EOF
      continue;
    }
    const head = /^(#{1,6})\s+(.*?)(?:\s+#+\s*)?$/.exec(line);
    if (head) { flush(); blocks.push({ kind: "h", level: head[1].length, text: head[2].trim() }); continue; }
    if (/^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); blocks.push({ kind: "hr" }); continue; }
    const quoted = /^ {0,3}> ?(.*)$/.exec(line);
    if (quoted) {
      flush();
      const text = [quoted[1]];
      let j = i + 1;
      for (; j < lines.length; j++) {
        const q = /^ {0,3}> ?(.*)$/.exec(lines[j]);
        if (!q) break;
        text.push(q[1]);
      }
      blocks.push({ kind: "quote", text: text.join(" ") });
      i = j - 1;
      continue;
    }
    if (/^(\s*)([-*+]|\d+[.)])\s+(.+)$/.test(line)) {
      flush();
      const items = [];
      let j = i;
      for (; j < lines.length; j++) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.+)$/.exec(lines[j]);
        if (m) {
          const task = /^\[( |x|X)\]\s*(.*)$/.exec(m[3]);
          items.push({
            marker: /\d/.test(m[2]) ? m[2] : "•",
            depth: m[1].length >= 2 ? 1 : 0,
            task: task ? task[1].toLowerCase() === "x" : null,
            text: task ? task[2] : m[3],
          });
          continue;
        }
        // An indented non-marker line continues the item above it (markdown's
        // wrapped item text); a blank or flush-left line ends the list.
        const cont = /^ {2,}(\S.*)$/.exec(lines[j]);
        if (!cont || !items.length) break;
        const last = items[items.length - 1];
        last.text = `${last.text} ${cont[1]}`;
      }
      blocks.push({ kind: "list", items });
      i = j - 1;
      continue;
    }
    // A table: a header row, a `|---|---|` separator, then rows. GFM's leading
    // and trailing pipes are optional; the separator's cell count is the
    // column count, so a short row is padded and a long one trimmed.
    if (line.includes("|") && lines[i + 1]?.includes("|") && mdTableSeparator(lines[i + 1])) {
      flush();
      const aligns = mdCells(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /^-+:$/.test(c) ? "right" : "left"));
      const fit = (cells) => {
        const out = cells.slice(0, aligns.length);
        while (out.length < aligns.length) out.push("");
        return out;
      };
      const header = fit(mdCells(line)), rows = [];
      let j = i + 2;
      for (; j < lines.length && lines[j].includes("|") && !/^\s*$/.test(lines[j]); j++) {
        if (rows.length < MAX_MD_TABLE_ROWS) rows.push(fit(mdCells(lines[j])));
        else truncated = true;
      }
      blocks.push({ kind: "table", header, aligns, rows });
      i = j - 1;
      continue;
    }
    para = para ? `${para} ${line.trim()}` : line.trim();
  }
  flush();
  return { blocks, truncated };
}

// One inline run splitter for everything: `code`, **bold**, [text](url),
// *italic*, _italic_ (underscore requires a non-word before and after, so
// snake_case stays literal). Alternatives are ordered so ** wins over *.
const MD_INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^()\s]+\))|(\*[^*\n]+\*)|((?<![\w`])_[^_\n]+_(?![\w`]))/g;

// A paragraph's text -> runs {t:"text"|"code"|"bold"|"italic"|"link", s, url}.
function mdInline(text) {
  const runs = [];
  let at = 0, m;
  MD_INLINE.lastIndex = 0;
  while ((m = MD_INLINE.exec(text))) {
    if (m.index > at) runs.push({ t: "text", s: text.slice(at, m.index) });
    const s = m[0];
    if (m[1]) runs.push({ t: "code", s: s.slice(1, -1) });
    else if (m[2]) runs.push({ t: "bold", s: s.slice(2, -2) });
    else if (m[3]) {
      const link = /^\[([^\]\n]+)\]\(([^()\s]+)\)$/.exec(s);
      runs.push({ t: "link", s: link[1], url: link[2] });
    } else runs.push({ t: "italic", s: s.slice(1, -1) });
    at = m.index + s.length;
  }
  if (at < text.length) runs.push({ t: "text", s: text.slice(at) });
  return runs;
}

// Code and links keep their text whole; plain/bold/italic runs split into
// word+trailing-space chunks so the flex_wrap row below wraps mid-sentence
// the way inline text does (a whole sentence as one flex child could not).
const mdChunks = (s) => s.match(/\S+\s*|\s+/g) ?? [];

// The mono face for code: the terminal font (a mono face, settings.json's
// `font`), falling back to JetBrains Mono, which ships with Herdr.
const monoFont = () => (typeof settings()?.font === "string" && settings().font) || "JetBrains Mono";

// Inline runs -> styled elements laid out inline inside a flex_wrap row. The
// container supplies colour and line height; runs add their own, and take
// `size` explicitly — a heading's text_size must land on the words even if
// the style failed to cascade, so the hierarchy can't silently flatten.
function mdRuns(tokens, key, size) {
  const out = [];
  tokens.forEach((r, n) => {
    if (r.t === "code") {
      out.push(div().flex_none().px(5).rounded(4).bg(NIGHT_MD.codeBg).text_color(NIGHT_MD.codeFg)
        .font_family(monoFont()).text_size(13).child(r.s || " "));
    } else if (r.t === "link") {
      if (/^https?:\/\//i.test(r.url ?? "")) {
        out.push(div().flex_none().id(`files-md-link-${key}-${n}`).text_size(size).text_color(NIGHT_MD.link).underline()
          .cursor_pointer().hover((st) => st.text_color(NIGHT_MD.linkHover))
          .on_click((_e, cx) => cx.open_url(r.url)).child(r.s));
      } else { // a relative or non-http target: coloured, not clickable
        out.push(div().flex_none().text_size(size).text_color(NIGHT_MD.link).underline().child(r.s));
      }
    } else {
      const bold = r.t === "bold", italic = r.t === "italic";
      out.push(...mdChunks(r.s).map((chunk) => {
        const el = div().flex_none().text_size(size).child(chunk);
        if (bold) el.font_bold().text_color(NIGHT_MD.bold);
        if (italic) el.italic().text_color(NIGHT_MD.italic);
        return el;
      }));
    }
  });
  return out;
}

// A styled paragraph row: the words of every run flowing and wrapping inline.
const mdPara = (text, key, size, lh) => h_flex().flex_wrap().items_baseline().flex_none()
  .text_size(size).line_height(lh).text_color(NIGHT.fg)
  .children(mdRuns(mdInline(text), key, size));

// The document's blocks as flat elements. `prefix` keeps the inline link ids
// apart when several documents share one scroll.
export function mdBody(text, prefix = "md") {
  const { blocks, truncated } = mdBlocks(text);
  const out = [];
  blocks.forEach((b, i) => {
    const key = `${prefix}${i}`;
    if (b.kind === "h") {
      const head = MD_HEAD[b.level - 1];
      out.push(h_flex().flex_wrap().items_baseline().flex_none().text_size(head.size)
        .line_height(head.lh).text_color(NIGHT_MD.h[b.level - 1]).font_bold()
        .when(i > 0, (e) => e.mt(head.mt))
        .children(mdRuns(mdInline(b.text), key, head.size)));
    } else if (b.kind === "code") {
      const box = v_flex().flex_none().mt(2).rounded(6).bg(NIGHT_MD.codeBg)
        .border_1().border_color(NIGHT.border).overflow_hidden()
        .when(Boolean(b.lang), (e) => e.child(div().px(10).pt(6).text_size(10).text_color(NIGHT.faint).child(b.lang)));
      box.child(v_flex().flex_none().px(10).py(8)
        .children(b.lines.map((ln) => div().font_family(monoFont()).text_size(12.5).line_height("19px")
          .text_color(NIGHT_MD.codeFg).child(ln.length ? ln : " "))));
      out.push(box);
    } else if (b.kind === "quote") {
      out.push(mdPara(b.text, key, 15, "24px").mt(2).py(4).pl(10)
        .bg(NIGHT_MD.quoteBg).border_l(2).border_color(NIGHT_MD.quoteBar));
    } else if (b.kind === "list") {
      const list = v_flex().flex_none().gap(1);
      b.items.forEach((it, j) => {
        const done = it.task === true;
        list.child(h_flex().flex_none().items_start().gap(7).pl(8 + it.depth * 16)
          .child(div().flex_none().min_w(14).text_size(15).line_height("24px")
            .text_color(done ? NIGHT_MD.done : NIGHT_MD.marker)
            .child(it.task === null ? it.marker : done ? "✓" : "○"))
          .child(mdPara(it.text, `${key}-${j}`, 15, "24px").flex_1().min_w(0)));
      });
      out.push(list);
    } else if (b.kind === "table") {
      // Weight each column by its longest cell, so a `key` column stays narrow
      // beside a wide description. Clamped to 1..4 so one long cell can't
      // squeeze the rest away.
      const weights = b.aligns.map((_, c) => {
        let longest = b.header[c].length;
        for (const r of b.rows) longest = Math.max(longest, r[c].length);
        return Math.max(1, Math.min(4, Math.ceil(longest / 12)));
      });
      const table = v_flex().flex_none().mt(2).rounded(6).border_1().border_color(NIGHT.border).overflow_hidden();
      const row = (cells, header, r) => h_flex().flex_none().items_start()
        .when(header, (e) => e.bg(NIGHT.bgAlt))
        .when(r < b.rows.length, (e) => e.border_b(1).border_color(NIGHT.border))
        .children(cells.map((text, c) => h_flex().flex_1().flex_grow(weights[c]).min_w(0).items_start().px(8).py(4)
          .child(mdPara(text, `${key}-${r}-${c}`, 14, "21px").flex_1().min_w(0)
            .when(header, (e) => e.font_bold()))));
      table.child(row(b.header, true, 0));
      b.rows.forEach((cells, r) => table.child(row(cells, false, r + 1)));
      out.push(table);
    } else if (b.kind === "hr") {
      out.push(div().flex_none().mt(2).h(1).bg(NIGHT_MD.hr));
    } else out.push(mdPara(b.text, key, 15, "24px"));
  });
  if (truncated) out.push(div().flex_none().mt(2).text_size(12).text_color(NIGHT.faint)
    .child("… truncated — the rest of this file is not shown"));
  return out;
}

// A whole document: the blocks, padded so the text never touches the pane's
// edges (the padding scrolls with the content), blocks spaced on a common
// rhythm. The file name is already in the Files header, so no title here.
export function mdView(text, prefix = "md") {
  return v_flex().flex_none().p(14).gap(6).children(mdBody(text, prefix));
}
