// Preparing an image for `image()`: Herdr resolves that path from its own
// folder, so the file is copied into a small temp folder there first. A file
// on another machine takes the same base64 trip as a download.

import { cleanTemp, downloadFile, tempFolder } from "./download.js";

// Formats the host's image loader draws. An extension Herdr cannot decode
// (HEIC, say) stays on the text path's "no preview" message.
const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tif", "tiff", "svg",
]);

export const MAX_PREVIEW = 32 * 1024 * 1024;

const extension = (name) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

export function isImage(name) {
  return IMAGE_EXTENSIONS.has(extension(name));
}

// Copies `source` to <appHome>/data/files-preview-…/image.<ext> and returns
// `{ dir, path }`: `dir` is the temp folder to remove, `path` is the
// app-relative form `image()` takes. `onDir` sees the folder as soon as it
// exists, so a popup that closes mid-copy can still remove it.
export async function stageImage({ exec, platform, appHome, source, name, on, writeTextFile, onDir }) {
  const ext = /^[a-z0-9]{1,8}$/.test(extension(name)) ? extension(name) : "img";
  const dir = await tempFolder(exec, platform, appHome, "files-preview");
  onDir?.(dir);
  try {
    const dest = `${dir}/image.${ext}`;
    await downloadFile({ exec, platform, appHome, source, dest, on, writeTextFile });
    const root = appHome.replace(/\\/g, "/").replace(/\/+$/, "");
    const path = dest.replace(/\\/g, "/").slice(root.length + 1);
    return { dir, path };
  } catch (e) {
    await cleanTemp(exec, platform, dir).catch(() => {});
    throw e;
  }
}
