// Renaming and deleting an entry where it lives — the right-click menu's
// two actions that change the folder itself rather than moving files in
// or out of it.
//
// The host calls come in as arguments, so the shell work can be tried
// without the app. An entry on another machine is renamed or removed by
// sh on that machine; a local Windows folder is the one place PowerShell
// does it, with -LiteralPath so a name holding wildcards stays a name.
// Paths always arrive absolute — built from the browsed root — so a file
// called `-rf` can never be read as an option, and every name travels as
// a quoted positional argument, wildcards included.

import { psq } from "./download.js";
import { listNames } from "./upload.js";

async function sh(exec, on, script, args = []) {
  return exec("sh", ["-c", script, "fileops", ...args], { on, timeout: 600000 });
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

// A refused name is not an error toast: the menu shows the reason and
// keeps the field open for correcting.
function refuse(reason) {
  const e = new Error(reason);
  e.refusal = true;
  return e;
}

// Everything a rename must clear before any shell call runs: a real
// name, no separators, not the dots, and — judged against one listing of
// the folder — not another entry's name. The entry's own current name is
// allowed through, so a case-only rename stays possible. Returns the
// destination path to move to, or null when the name is unchanged (which
// the caller treats as "just close"). Unlike uploads, a taken name is
// refused rather than suffixed: the person typed this one.
export async function checkedDestination({ exec, platform, parent, from, to, on }) {
  if (!to) throw refuse("Type a name");
  if (to.includes("/") || to.includes("\\")) throw refuse("A name cannot contain / or \\");
  if (to === "." || to === "..") throw refuse("That name belongs to the folder itself");
  if (to === from) return null;
  let taken;
  try { taken = await listNames(exec, on, parent, platform); }
  catch { throw refuse("The folder holding it is gone"); }
  if (taken.has(to)) throw refuse(`${to} is already in this folder`);
  return `${parent}/${to}`;
}

// Rename exactly the right-clicked path inside its own folder: `mv` on
// the entry's machine, `Rename-Item -LiteralPath` for a local Windows
// folder. Returns the new name, or null when nothing moved.
export async function renameEntry({ exec, platform, source, parent, from, to, on }) {
  const dest = await checkedDestination({ exec, platform, parent, from, to, on });
  if (!dest) return null;
  if (!on && platform === "windows") {
    await ps(exec, null, `Rename-Item -LiteralPath ${psq(source)} -NewName ${psq(to)}`);
    return to;
  }
  await shell(exec, on, 'mv "$1" "$2"', [source, dest]);
  return to;
}

// Delete exactly the right-clicked path, contents and all — permanent on
// every machine, so the confirmation in the menu is the only safeguard:
// `rm -rf` on the entry's machine, `Remove-Item -LiteralPath … -Recurse
// -Force` for a local Windows folder.
export async function deleteEntry({ exec, platform, source, on }) {
  if (!on && platform === "windows") {
    await ps(exec, null, `Remove-Item -LiteralPath ${psq(source)} -Recurse -Force`);
    return;
  }
  await shell(exec, on, 'rm -rf "$1"', [source]);
}
