import assert from "node:assert/strict";
import { test } from "node:test";
import { clipboardFilePaths } from "../src/clipboard";

function clipboard(formats: Record<string, string | Uint8Array>) {
  const bytes = (value: string | Uint8Array) => typeof value === "string" ? new TextEncoder().encode(value) : value;
  return {
    availableFormats: () => Object.keys(formats),
    readBuffer: (format: string) => bytes(formats[format] ?? ""),
    read: (format: string) => typeof formats[format] === "string" ? formats[format] as string : ""
  };
}

test("copied files are found in Windows, macOS and Linux clipboard formats", () => {
  const windows = new Uint8Array(Buffer.from("C:\\notes\\a.png\0C:\\notes\\b.pdf\0\0", "utf16le"));
  assert.deepEqual(clipboardFilePaths(clipboard({ FileNameW: windows })), ["C:\\notes\\a.png", "C:\\notes\\b.pdf"]);
  const plist = '<?xml version="1.0"?><plist><array><string>/Users/me/A &amp; B.png</string><string>/Users/me/c.txt</string></array></plist>';
  assert.deepEqual(clipboardFilePaths(clipboard({ NSFilenamesPboardType: plist })), ["/Users/me/A & B.png", "/Users/me/c.txt"]);
  assert.deepEqual(clipboardFilePaths(clipboard({ "public.file-url": "file:///Users/me/My%20Photo.jpg" })), ["/Users/me/My Photo.jpg"]);
  assert.deepEqual(clipboardFilePaths(clipboard({ "text/uri-list": "# comment\r\nfile:///home/me/one.png\r\nfile:///home/me/two%20words.txt\r\n" })),
    ["/home/me/one.png", "/home/me/two words.txt"]);
});

test("web links and ordinary text on the clipboard are not treated as files", () => {
  assert.deepEqual(clipboardFilePaths(clipboard({ "text/uri-list": "https://example.com/page", "text/plain": "https://example.com/page" })), []);
  assert.deepEqual(clipboardFilePaths(clipboard({ "text/plain": "/home/me/file.png" })), []);
  assert.deepEqual(clipboardFilePaths(clipboard({ "public.file-url": "not a url" })), []);
});
