// Copying files and folders from this computer into the Files panel —
// dropped from outside the app, or picked from the native dialog.
//
// The host calls come in as arguments, so the shell work can be tried
// without the app. A local target is a plain copy. A target on another
// machine goes through hc (herdr-core): `hc file write --on <machine>`
// reads the file from this computer's stdin, so one call ships any
// file; a folder goes as one archive, pushed once and extracted there.

import { addSuffix, asq, extractor, hasZip, norm, psq, trimEnd } from "./download.js";

async function sh(exec, on, script, args = []) {
  return exec("sh", ["-c", script, "upload", ...args], { on, timeout: 600000 });
}

async function shell(exec, on, script, args) {
  const r = await sh(exec, on, script, args);
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || `Command failed (${r.code})`).trim());
  return r;
}

async function ps(exec, on, script) {
  const r = await exec("powershell", ["-NoProfile", "-Command", script], { on, timeout: 600000 });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || `PowerShell failed (${r.code})`).trim());
  return r;
}

const baseName = (p) => p.split(/[\\/]/).pop();

// What dropped paths are, decided in one shell between them: kind
// (`d`/`f`) and name, NUL-separated like the tree's own listing. Dropped
// paths are always on this computer, so this runs locally.
export async function describe(exec, paths, platform) {
  if (platform === "windows") {
    const script = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); foreach ($p in @(${paths.map(psq).join(",")})) { $kind = if ([IO.Directory]::Exists($p)) { 'd' } else { 'f' }; [Console]::Out.Write($kind + [string][char]0 + (Split-Path -Leaf $p) + [string][char]0) }`;
    return kinds(await ps(exec, null, script), paths);
  }
  const r = await shell(exec, null, 'while [ "$#" -gt 0 ]; do if [ -d "$1" ]; then printf "d\\0%s\\0" "${1##*/}"; else printf "f\\0%s\\0" "${1##*/}"; fi; shift; done', paths);
  return kinds(r.stdout, paths);
}

function kinds(out, paths) {
  const fields = out.split("\0");
  return paths.map((p, i) => {
    const kind = fields[i * 2], name = fields[i * 2 + 1];
    // A path the shell could not see still counts as a file: copying
    // it will fail with a proper message.
    return kind && name ? { path: p, dir: kind === "d", name } : { path: p, dir: false, name: baseName(p) };
  });
}

// Every name currently in `folder`, in one listing — the judge for
// which names an upload can keep. Runs on the folder's machine.
export async function listNames(exec, on, folder, platform) {
  if (!on && platform === "windows") {
    const r = await ps(exec, null, `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::Out.Write(((Get-ChildItem -LiteralPath ${psq(folder)} -Force -Name) -join ([string][char]0)))`);
    return new Set(r.stdout.split("\0").filter(Boolean));
  }
  const r = await shell(exec, on, 'for p in "$1"/* "$1"/.[!.]* "$1"/..?*; do [ -e "$p" ] || [ -L "$p" ] || continue; printf "%s\\0" "${p##*/}"; done; [ -d "$1" ] || { echo "The folder to upload into is gone"; exit 3; }', [folder]);
  return new Set(r.stdout.split("\0").filter(Boolean));
}

// Where each item lands: its name, then `name (2)`, `name (3)`, …,
// judged against one listing of the target plus names earlier items of
// the same batch claimed, so no two arrivals collide. Returns the
// final names in input order.
export async function uniqueNames(exec, on, target, names, platform) {
  const taken = await listNames(exec, on, target, platform);
  return names.map(name => {
    let candidate = name, n = 1;
    while (taken.has(candidate)) candidate = addSuffix(name, ++n);
    taken.add(candidate);
    return candidate;
  });
}

// The hop to another machine: local hc reads `source` on stdin and
// writes it as `dest` there, making missing folders. It prints
// {"bytes":N}, which is the size for the toast.
async function pushFile(exec, platform, source, dest, machine) {
  let r;
  if (platform === "windows") {
    // cmd's `<` redirect is byte-safe, unlike PowerShell's object
    // pipes. Windows paths carry no quotes, so this quoting holds.
    const win = (p) => `"${String(p).replace(/"/g, "")}"`;
    r = await exec("cmd", ["/c", `hc file write --json --on ${win(machine)} ${win(dest)} < ${win(source)}`], { timeout: 600000 });
  } else {
    r = await shell(exec, null, 'hc file write --json --on "$1" "$2" < "$3"', [machine, dest, source]);
  }
  if (r.code !== 0) throw new Error((r.stderr || r.stdout || `hc failed (${r.code})`).trim());
  try { return JSON.parse(r.stdout).bytes ?? 0; } catch { return 0; }
}

// One file to `dest` (a full path inside the target). A local target
// is a plain copy; a machine target is the hc push. Returns its size
// in bytes — 0 for a local copy, which download also leaves uncounted.
export async function uploadFile({ exec, platform, source, dest, on }) {
  if (!on) {
    if (platform === "windows") await ps(exec, null, `Copy-Item -LiteralPath ${psq(source)} -Destination ${psq(dest)} -Force`);
    else await shell(exec, null, 'cp "$1" "$2"', [source, dest]);
    return 0;
  }
  return pushFile(exec, platform, source, dest, on);
}

// A folder arrives whole. A local target is a recursive copy; a
// machine target takes one archive: zipped (or tarred) here, pushed as
// a single file, extracted into `target` there, archive and temp
// folder gone after. Returns the pushed archive's size.
export async function uploadFolder({ exec, platform, appHome, source, name, target, on }) {
  const dest = `${trimEnd(target)}/${name}`;
  if (!on) {
    if (platform === "windows") await ps(exec, null, `Copy-Item -LiteralPath ${psq(source)} -Destination ${psq(dest)} -Recurse -Force`);
    else await shell(exec, null, 'cp -R "$1" "$2"', [source, dest]);
    return 0;
  }
  const how = await extractor(exec, on);
  if (!how) throw new Error(`${on} has neither unzip nor tar, so folders cannot arrive there (files still can)`);
  const dir = `${appHome}/data/files-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (platform === "windows") await ps(exec, null, `New-Item -ItemType Directory -Force -Path ${psq(dir)} | Out-Null`);
  else await shell(exec, null, 'mkdir -p "$1"', [dir]);
  try {
    const base = trimEnd(source).split(/[\\/]/).pop();
    // Zip when the far end can open one and zip exists here; a .tar.gz
    // otherwise — tar is on every machine this mod runs on, Windows
    // 10's System32 included.
    const zipped = how === "unzip" && (platform === "windows" || (await hasZip(exec, null, platform)));
    const archive = `${dir}/upload.${zipped ? "zip" : "tar.gz"}`;
    if (platform === "windows") {
      if (zipped) await ps(exec, null, `Compress-Archive -LiteralPath ${psq(source)} -DestinationPath ${psq(archive)} -Force`);
      else {
        const parent = trimEnd(source).slice(0, trimEnd(source).length - base.length - 1) || ".";
        const r = await exec("tar", ["-czf", archive, "-C", parent, base], { timeout: 600000 });
        if (r.code !== 0) throw new Error((r.stderr || `tar failed (${r.code})`).trim());
      }
    } else if (zipped) {
      await shell(exec, null, 'rm -f "$2"; cd "$1/.." && zip -qry "$2" "$3"', [source, archive, base]);
    } else {
      await shell(exec, null, 'tar -czf "$2" -C "$1/.." "$3"', [source, archive, base]);
    }
    const made = await shell(exec, on, 'd=$(mktemp -d 2>/dev/null) || exit 1; printf "%s" "$d"', []);
    const tmp = made.stdout.trim();
    try {
      await pushFile(exec, platform, archive, `${tmp}/upload`, on);
      // Both archive kinds hold the folder itself at their root, so
      // extracting into `target` lands it like cp -R would.
      await shell(exec, on, zipped
        ? 'mkdir -p "$2" && unzip -qo "$1" -d "$2"'
        : 'mkdir -p "$2" && tar -xzf "$1" -C "$2"', [`${tmp}/upload`, target]);
    } finally {
      await sh(exec, on, 'rm -rf "$1"', [tmp]).catch(() => {});
    }
    return 0;
  } finally {
    if (platform === "windows") await ps(exec, null, `Remove-Item -LiteralPath ${psq(dir)} -Recurse -Force -ErrorAction SilentlyContinue`).catch(() => {});
    else await sh(exec, null, 'rm -rf "$1"', [dir]).catch(() => {});
  }
}

// The native file picker, several files at once: AppleScript on macOS
// (POSIX paths, one per line), Windows' OpenFileDialog elsewhere.
// Cancelling comes back as null and copies nothing.
export async function pickUploads({ exec, platform, prompt }) {
  const dead = (e) => { throw new Error(String(e?.message ?? e).trim() || "The file picker did not open (drag files in instead)"); };
  if (platform === "macos") {
    const script = `set out to ""\nrepeat with f in (choose file with prompt ${asq(prompt)} with multiple selections allowed)\nset out to out & (POSIX path of f) & linefeed\nend repeat\nreturn out`;
    const r = await exec("osascript", ["-e", script], { timeout: 600000 }).catch(e => ({ code: -1, stdout: "", stderr: String(e) }));
    if (r.code === 0) return r.stdout.split("\n").map(s => s.trim()).filter(Boolean);
    if (/User canceled|\(-128\)/i.test(r.stderr)) return null;
    return dead(new Error(r.stderr));
  }
  const script = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = ${psq(prompt)}; $d.Multiselect = $true; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); [Console]::Out.Write(($d.FileNames -join ([string][char]0))) }`;
  const r = await exec("powershell", ["-STA", "-NoProfile", "-Command", script], { timeout: 600000 }).catch(e => ({ code: -1, stdout: "", stderr: String(e) }));
  if (r.code !== 0) return dead(new Error(r.stderr));
  return r.stdout ? r.stdout.split("\0").filter(Boolean) : null;
}

// One drop or pick, end to end: skip what is already here, plan the
// final names, copy each item in turn, keep score. `items` is
// [{ path, name, dir }]; `target` the absolute folder they land in;
// `on` the machine it lives on (null for this computer). Returns what
// happened, for the toasts.
export async function uploadItems({ exec, platform, appHome, items, target, on }) {
  const failed = [], skipped = [];
  const within = (a, b) => a === b || a.startsWith(b + "/");
  const going = items.filter(item => {
    // The target is the item or inside it (nothing to do, and a copy
    // would recurse onto itself), or the item is already here.
    if (!on && (within(norm(target), norm(item.path)) || within(norm(item.path), norm(target)))) { skipped.push(item.name); return false; }
    return true;
  });
  let uploaded = 0, bytes = 0;
  if (!going.length) return { uploaded, bytes, failed, skipped };
  const names = await uniqueNames(exec, on, target, going.map(i => i.name), platform);
  for (let i = 0; i < going.length; i++) {
    const item = going[i];
    try {
      bytes += item.dir
        ? await uploadFolder({ exec, platform, appHome, source: item.path, name: names[i], target, on })
        : await uploadFile({ exec, platform, source: item.path, dest: `${trimEnd(target)}/${names[i]}`, on });
      uploaded++;
    } catch (e) { failed.push({ name: item.name, message: String(e?.message ?? e) }); }
  }
  return { uploaded, bytes, failed, skipped };
}
