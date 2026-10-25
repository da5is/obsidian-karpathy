import { Platform } from "obsidian";

// Explorer may expose native filenames instead of browser ClipboardEvent files.
// Read only in response to paste and only when that explicit clipboard format exists.
export function nativeClipboardFiles(): Promise<File[]> | null {
  if (!Platform.isDesktopApp) return null;
  const { clipboard } = require("electron") as {
    clipboard?: { availableFormats(): string[]; readBuffer(format: string): Uint8Array }
  };
  if (!clipboard) return null;
  const formats = clipboard.availableFormats();
  if (!formats.includes("FileNameW")) return null;
  const paths = new TextDecoder("utf-16le").decode(clipboard.readBuffer("FileNameW")).split("\0").filter(Boolean);
  if (!paths.length) return null;
  return (async () => {
    const fs = require("node:fs/promises") as typeof import("node:fs/promises");
    const images: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", heic: "image/heic", avif: "image/avif" };
    const files: File[] = [];
    for (const path of paths) {
      if (!(await fs.stat(path)).isFile()) throw new Error("Paste files individually; folders cannot be attached.");
      const name = path.split(/[\\/]/).pop()!;
      const bytes = await fs.readFile(path);
      files.push(new File([new Uint8Array(bytes)], name, { type: images[name.split(".").pop()!.toLowerCase()] ?? "application/octet-stream" }));
    }
    return files;
  })();
}
