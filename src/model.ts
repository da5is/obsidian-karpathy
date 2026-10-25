export interface Entry {
  id: string;
  timestamp: string;
  body: string;
  path: string;
  start: number;
  end: number;
  created?: string;
  rescues?: number;
}

export interface Cursor {
  file: number;
  offset: number;
}

export interface Page {
  entries: Entry[];
  start: Cursor;
  end: Cursor;
  exhausted: boolean;
}

export function entryPrefix(text: string): RegExpExecArray | null {
  // URL schemes are links, not capture labels (including while typing https:).
  if (/^(?:https?|ftp|file|mailto|tel|data|obsidian):/i.test(text) || /^[a-z][a-z\d+.-]*:\/\//i.test(text)) return null;
  return /^([a-z][\w-]*):/i.exec(text);
}

let lastIdTime = 0;
let idSequence = 0;
export function uniqueId(): string {
  const time = Math.max(Date.now(), lastIdTime);
  idSequence = time === lastIdTime ? idSequence + 1 : 0;
  lastIdTime = time;
  return new Date(time).toISOString().replace(/[^0-9]/g, "") + (idSequence ? `-${idSequence}` : "");
}

export function baseFolder(value: string): string {
  if (!value.trim() || value.trim() === "/") return "";
  const path = value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!path || path.startsWith("/") || /[<>:"|?*\u0000-\u001f]/.test(path) ||
      path.split("/").some(part => !part || part === "." || part === ".." || part.startsWith("."))) {
    throw new Error("Choose a non-hidden folder inside this vault, or leave blank for the vault root.");
  }
  return path;
}

export function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function dailyPath(base: string, date: Date): string {
  const day = localDay(date);
  const folder = baseFolder(base);
  return `${folder ? `${folder}/` : ""}${day.slice(0, 4)}/${day.slice(0, 7)}/${day}.md`;
}

export function attachmentFolder(base: string, date: Date): string {
  const path = dailyPath(base, date);
  return `${path.slice(0, path.lastIndexOf("/") + 1)}attachments`;
}

export function isDailyPath(base: string, path: string): boolean {
  const folder = baseFolder(base);
  const prefix = folder ? `${folder}/` : "";
  if (!path.startsWith(prefix)) return false;
  const match = /^(\d{4})\/(\d{4}-\d{2})\/(\d{4}-\d{2}-\d{2})\.md$/.exec(path.slice(prefix.length));
  if (!match || match[1] !== match[3].slice(0, 4) || match[2] !== match[3].slice(0, 7)) return false;
  const parsed = new Date(`${match[3]}T12:00:00`);
  return !Number.isNaN(parsed.valueOf()) && localDay(parsed) === match[3];
}

export function serializeEntry(id: string, timestamp: string, body: string, created?: string, rescues = 0): string {
  if (!/^[a-zA-Z0-9-]+$/.test(id) || Number.isNaN(Date.parse(timestamp))) throw new Error("Invalid entry identity.");
  if (/^<!-- (?:\/)?karpathy:/m.test(body)) throw new Error("Entry boundary markers cannot appear at the start of a line.");
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString("en-GB", { hour12: false });
  const metadata = created ? ` created=${created} rescues=${rescues}` : "";
  return `<!-- karpathy:${id} ${timestamp}${metadata} -->\n## ${time}\n\n${normalizeBody(body)}\n\n<!-- /karpathy:${id} -->`;
}

function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
}

export function parseEntries(text: string, path: string): Entry[] {
  const entries: Entry[] = [];
  const opening = /^<!-- karpathy:([a-zA-Z0-9-]+) (\S+)(?: created=(\S+) rescues=(\d+))? -->\r?\n## [^\r\n]+\r?\n\r?\n/gm;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(text))) {
    const closing = new RegExp(`^<!-- /karpathy:${match[1]} -->\\r?$`, "gm");
    closing.lastIndex = opening.lastIndex;
    const end = closing.exec(text);
    if (!end || Number.isNaN(Date.parse(match[2]))) continue;
    entries.push({
      id: match[1], timestamp: match[2], path,
      body: normalizeBody(text.slice(opening.lastIndex, end.index)),
      start: match.index, end: end.index + end[0].length,
      created: match[3], rescues: match[4] ? Number(match[4]) : undefined
    });
    opening.lastIndex = end.index + end[0].length;
  }
  return entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id));
}

export function insertEntry(text: string, serialized: string, day: string): string {
  if (!text) return `# ${day}\n\n${serialized}\n`;
  const header = /^(?:---\r?\n[\s\S]*?\r?\n---\r?\n(?:\r?\n)?)?(?:# \d{4}-\d{2}-\d{2}\r?\n(?:\r?\n)?)?/.exec(text)?.[0] ?? "";
  return `${header}${header && !header.endsWith("\n\n") ? "\n" : ""}${serialized}\n\n${text.slice(header.length)}`;
}

export function replaceEntry(text: string, expected: Entry, body: string | null): string {
  const matches = parseEntries(text, expected.path).filter(entry => entry.id === expected.id);
  if (matches.length !== 1) throw new Error("This entry was removed or has a duplicate ID. Reopen it before editing.");
  const current = matches[0];
  if (current.body !== expected.body || current.timestamp !== expected.timestamp) {
    throw new Error("This entry changed elsewhere. Your draft is kept; reopen the latest entry before saving.");
  }
  const replacement = body === null ? "" : serializeEntry(current.id, current.timestamp, body, current.created, current.rescues);
  return text.slice(0, current.start) + replacement + text.slice(current.end);
}

export function matchesQuery(entry: Entry, query: string): boolean {
  const haystack = `${entry.body}\n${entry.timestamp}\n${entry.path}`.toLocaleLowerCase();
  return query.toLocaleLowerCase().trim().split(/\s+/).every(term => haystack.includes(term));
}

export function taskRanges(body: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  markdownLanguage.parser.parse(body).iterate({
    enter(node) {
      if (node.name === "TaskMarker") ranges.push({ from: node.from, to: node.to });
    }
  });
  return ranges;
}

export function toggleTask(body: string, taskIndex: number, checked: boolean): string {
  const range = taskRanges(body)[taskIndex];
  if (!range) throw new Error("Checklist syntax changed. Reopen the entry before toggling this task.");
  return body.slice(0, range.from) + (checked ? "[x]" : "[ ]") + body.slice(range.to);
}

export class LruCache<K, V> {
  private items = new Map<K, { value: V; size: number }>();
  private bytes = 0;
  constructor(private maxItems: number, private maxBytes: number) {}
  get(key: K): V | undefined {
    const item = this.items.get(key);
    if (!item) return undefined;
    this.items.delete(key);
    this.items.set(key, item);
    return item.value;
  }
  set(key: K, value: V, size: number): void {
    this.delete(key);
    if (size > this.maxBytes) return;
    this.items.set(key, { value, size });
    this.bytes += size;
    while (this.items.size > this.maxItems || this.bytes > this.maxBytes) {
      const key = this.items.keys().next().value;
      if (key === undefined) break;
      this.delete(key);
    }
  }
  delete(key: K): void {
    const item = this.items.get(key);
    if (item) this.bytes -= item.size;
    this.items.delete(key);
  }
  clear(): void { this.items.clear(); this.bytes = 0; }
  get size(): number { return this.items.size; }
}
import { markdownLanguage } from "@codemirror/lang-markdown";
