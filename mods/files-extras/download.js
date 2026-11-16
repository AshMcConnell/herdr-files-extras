// Copying a file or folder out of the Files panel to this computer.
//
// The host calls come in as arguments, so the shell work can be tried
// without the app. A file on another machine comes back as base64 pieces
// through exec (its output is capped at 8 MiB), kept in small local temp
// files (writeTextFile stops at 1 MiB), then decoded in one go.

// Bytes read per exec. Its base64 is ~5.6 MB, under the 8 MiB output cap.
// A multiple of 3, so each chunk encodes without `=` padding and the pieces
// join into one valid base64 stream.
const CHUNK = 4 * 1024 * 1024 - 1;
// Characters per temp file, under writeTextFile's 1 MiB text limit.
const PART = 1000000;

export const trimEnd = (path) => path.replace(/[\\/]+$/, "");
export const norm = (path) => trimEnd(path).replace(/\\/g, "/");
const mb = (bytes) => `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

// `foo.txt` at 2 becomes `foo (2).txt`; a dotfile stays whole.
export function addSuffix(name, n) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
}

export const sizeText = mb;

// A single-quoted PowerShell string.
export const psq = (s) => `'${String(s).replace(/['‘’‚‛]/g, "$&$&")}'`;
// A double-quoted AppleScript string.
export const asq = (s) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

async function sh(exec, on, script, args = []) {
  return exec("sh", ["-c", script, "download", ...args], { on, timeout: 600000 });
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

async function isDir(exec, on, path, platform) {
  if (platform === "windows") return (await ps(exec, on, `Test-Path -LiteralPath ${psq(path)} -PathType Container`)).stdout.trim().toLowerCase() === "true";
  return (await sh(exec, on, 'test -d "$1"', [path])).code === 0;
}

async function exists(exec, on, path, platform) {
  if (platform === "windows") return (await ps(exec, on, `Test-Path -LiteralPath ${psq(path)}`)).stdout.trim().toLowerCase() === "true";
  return (await sh(exec, on, 'test -e "$1"', [path])).code === 0;
}

// `folder/name`, adding " (2)" and so on until the name is free.
export async function uniquePath(exec, on, folder, name, platform) {
  for (let n = 1; ; n++) {
    const candidate = `${trimEnd(folder)}/${n === 1 ? name : addSuffix(name, n)}`;
    if (!(await exists(exec, on, candidate, platform))) return candidate;
  }
}

async function firstFolder(exec, platform, folders) {
  for (const folder of folders) if (folder && await isDir(exec, null, folder, platform).catch(() => false)) return folder;
  return folders.find(Boolean) ?? ".";
}

// Where to save: a save panel on macOS, starting in the last folder used;
// Herdr's folder picker elsewhere, with the name made unique there.
export async function chooseDestination({ exec, pickFolder, platform, name, last, home: userHome, prompt }) {
  const start = await firstFolder(exec, platform, [last, `${userHome}/Downloads`, userHome]);
  if (platform === "macos") {
    const script = `set p to choose file name with prompt ${asq(prompt)} default name ${asq(name)} default location (POSIX file ${asq(start)})\nPOSIX path of p`;
    const r = await exec("osascript", ["-e", script], { timeout: 600000 }).catch(e => ({ code: -1, stdout: "", stderr: String(e) }));
    if (r.code === 0 && r.stdout.trim()) {
      const path = r.stdout.trim();
      const cut = path.lastIndexOf("/");
      return { path, folder: cut > 0 ? path.slice(0, cut) : "/" };
    }
    if (/User canceled|\(-128\)/i.test(r.stderr)) return null;
    // No osascript (or it was refused): fall through to Herdr's own picker.
  }
  const picked = await pickFolder({ prompt });
  if (!picked) return null;
  return { path: await uniquePath(exec, null, picked, name, platform), folder: picked };
}

export async function hasZip(exec, on, platform) {
  if (!on && platform === "windows") return true;
  return (await sh(exec, on, 'command -v zip >/dev/null 2>&1')).code === 0;
}

// How a machine can open an uploaded folder archive: "unzip", "tar"
// (tar + gzip), or null when it has neither — one probe, so the local
// half of an upload can pick a matching archive format.
export async function extractor(exec, on) {
  const r = await sh(exec, on, 'command -v unzip >/dev/null 2>&1 && echo unzip || { command -v tar >/dev/null 2>&1 && echo tar; }');
  return r.stdout.trim() || null;
}

async function tempFolder(exec, platform, appHome) {
  const dir = `${appHome}/data/files-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (platform === "windows") await ps(exec, null, `New-Item -ItemType Directory -Force -Path ${psq(dir)} | Out-Null`);
  else await shell(exec, null, 'mkdir -p "$1"', [dir]);
  return dir;
}

async function cleanTemp(exec, platform, dir) {
  if (platform === "windows") await ps(exec, null, `Remove-Item -LiteralPath ${psq(dir)} -Recurse -Force -ErrorAction SilentlyContinue`);
  else await sh(exec, null, 'rm -rf "$1"', [dir]);
}

async function decode({ exec, platform, dir, dest }) {
  if (platform === "windows") {
    await ps(exec, null, `$s = (Get-ChildItem -LiteralPath ${psq(dir)} -Filter 'part-*.b64' | Sort-Object Name | ForEach-Object { [IO.File]::ReadAllText($_.FullName) }) -join ''; [IO.File]::WriteAllBytes(${psq(dest)}, [Convert]::FromBase64String($s))`);
  } else {
    await shell(exec, null, platform === "macos" ? 'cat "$1"/part-*.b64 | base64 -D > "$2"' : 'cat "$1"/part-*.b64 | base64 -d > "$2"', [dir, dest]);
  }
}

// A file on another machine: read it in exec-sized pieces, keep the base64
// in temp files, decode them into `dest` here. Returns its size in bytes.
async function fetchRemote({ exec, platform, appHome, on, source, dest, writeTextFile }) {
  const size = Number((await shell(exec, on, 'wc -c < "$1"', [source])).stdout.trim());
  if (!Number.isFinite(size)) throw new Error("Cannot read the file's size");
  if (size === 0) {
    if (platform === "windows") await ps(exec, null, `[IO.File]::WriteAllBytes(${psq(dest)}, [byte[]]@())`);
    else await shell(exec, null, ': > "$1"', [dest]);
    return 0;
  }
  const dir = await tempFolder(exec, platform, appHome);
  try {
    let part = 0;
    for (let i = 0; i * CHUNK < size; i++) {
      const out = (await shell(exec, on, 'dd if="$1" bs="$2" skip="$3" count=1 2>/dev/null | base64 | tr -d "\\n"', [source, String(CHUNK), String(i)])).stdout;
      for (let at = 0; at < out.length; at += PART) {
        await writeTextFile(`${dir}/part-${String(part++).padStart(5, "0")}.b64`, out.slice(at, at + PART), null);
      }
    }
    await decode({ exec, platform, dir, dest });
    return size;
  } finally {
    await cleanTemp(exec, platform, dir).catch(() => {});
  }
}

export async function downloadFile({ exec, platform, appHome, source, dest, on, writeTextFile }) {
  if (!on && norm(source) === norm(dest)) throw new Error("That is the file itself");
  if (!on && platform === "windows") {
    await ps(exec, null, `Copy-Item -LiteralPath ${psq(source)} -Destination ${psq(dest)} -Force`);
    return 0;
  }
  if (!on) {
    await shell(exec, null, 'cp "$1" "$2"', [source, dest]);
    return 0;
  }
  return fetchRemote({ exec, platform, appHome, on, source, dest, writeTextFile });
}

// `zip` says whether the machine has zip(1); without it a .tar.gz is made.
// Returns the archive's size in bytes.
export async function downloadFolder({ exec, platform, appHome, source, base, dest, on, writeTextFile, zip }) {
  const root = trimEnd(source);
  if (!on && (norm(dest) === norm(root) || norm(dest).startsWith(`${norm(root)}/`))) throw new Error("Choose a place outside the folder being zipped");
  if (!on) {
    if (platform === "windows") {
      try { await ps(exec, null, `Compress-Archive -LiteralPath ${psq(root)} -DestinationPath ${psq(dest)} -Force`); }
      catch (e) { await ps(exec, null, `Remove-Item -LiteralPath ${psq(dest)} -Force -ErrorAction SilentlyContinue`); throw e; }
      return 0;
    }
    const script = zip ? 'rm -f "$2"; cd "$1/.." && zip -qry "$2" "$3"' : 'tar -czf "$2" -C "$1/.." "$3"';
    try { await shell(exec, null, script, [root, dest, base]); }
    catch (e) { await sh(exec, null, 'rm -f "$1"', [dest]); throw e; }
    return 0;
  }
  const made = await shell(exec, on, 'd=$(mktemp -d 2>/dev/null) || exit 1; printf "%s" "$d"', []);
  const tmp = made.stdout.trim();
  const archive = `${tmp}/download.${zip ? "zip" : "tar.gz"}`;
  try {
    const script = zip ? 'cd "$1/.." && zip -qry "$2" "$3"' : 'tar -czf "$2" -C "$1/.." "$3"';
    await shell(exec, on, script, [root, archive, base]);
    return await fetchRemote({ exec, platform, appHome, on, source: archive, dest, writeTextFile });
  } finally {
    await sh(exec, on, 'rm -rf "$1"', [tmp]).catch(() => {});
  }
}
