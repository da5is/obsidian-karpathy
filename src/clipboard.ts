import { Platform } from "obsidian";

interface NativeClipboard {
  availableFormats(): string[];
  readBuffer(format: string): Uint8Array;
  read?(format: string): string;
}

function fileUrlPath(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "file:" && parsed.pathname ? decodeURIComponent(parsed.pathname) : null;
  } catch { return null; }
}

// File managers put copied files on the clipboard in platform-specific formats:
// Windows Explorer as FileNameW, macOS Finder as a filename plist or file URL,
// and Linux file managers as a text/uri-list. Non-file URLs are ignored.
export function clipboardFilePaths(clipboard: NativeClipboard): string[] {
  const formats = clipboard.availableFormats();
  if (formats.includes("FileNameW")) {
    return new TextDecoder("utf-16le").decode(clipboard.readBuffer("FileNameW")).split("\0").filter(Boolean);
  }
  if (formats.includes("NSFilenamesPboardType")) {
    const plist = new TextDecoder().decode(clipboard.readBuffer("NSFilenamesPboardType"));
    const paths = Array.from(plist.matchAll(/<string>([^<]*)<\/string>/g), match => match[1]
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&"));
    if (paths.length) return paths;
  }
  const read = (format: string) => clipboard.read?.(format) || new TextDecoder().decode(clipboard.readBuffer(format));
  if (formats.includes("public.file-url")) {
    const path = fileUrlPath(read("public.file-url"));
    if (path) return [path];
  }
  if (formats.includes("text/uri-list")) {
    return read("text/uri-list").split(/\r?\n/).filter(line => line.trim() && !line.startsWith("#"))
      .map(fileUrlPath).filter((path): path is string => !!path);
  }
  return [];
}

// Explorer/Finder may expose native filenames instead of browser ClipboardEvent files.
// Read only in response to paste and only when an explicit file format exists.
export function nativeClipboardFiles(): AsyncIterable<File> | null {
  if (!Platform.isDesktopApp) return null;
  const { clipboard } = require("electron") as { clipboard?: NativeClipboard };
  if (!clipboard) return null;
  const paths = clipboardFilePaths(clipboard);
  if (!paths.length) return null;
  return (async function* () {
    const fs = require("node:fs/promises") as typeof import("node:fs/promises");
    const images: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", heic: "image/heic", avif: "image/avif" };
    for (const path of paths) {
      const stat = await fs.stat(path);
      if (stat.size > 50 * 1024 * 1024) throw new Error("Attachments are limited to 50 MiB each. Add larger files to the vault and link them.");
      if (!stat.isFile()) throw new Error("Paste files individually; folders cannot be attached.");
      const name = path.split(/[\\/]/).pop()!;
      const bytes = await fs.readFile(path);
      yield new File([bytes], name, { type: images[name.split(".").pop()!.toLowerCase()] ?? "application/octet-stream" });
    }
  })();
}
