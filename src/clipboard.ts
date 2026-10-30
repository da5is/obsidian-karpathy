import { Platform } from "obsidian";

// Explorer may expose native filenames instead of browser ClipboardEvent files.
// Read only in response to paste and only when that explicit clipboard format exists.
export function nativeClipboardFiles(): AsyncIterable<File> | null {
  if (!Platform.isDesktopApp) return null;
  const { clipboard } = require("electron") as {
    clipboard?: { availableFormats(): string[]; readBuffer(format: string): Uint8Array }
  };
  if (!clipboard) return null;
  const formats = clipboard.availableFormats();
  if (!formats.includes("FileNameW")) return null;
  const paths = new TextDecoder("utf-16le").decode(clipboard.readBuffer("FileNameW")).split("\0").filter(Boolean);
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
