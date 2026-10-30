import { parseYaml, stringifyYaml } from "obsidian";
export interface Entry {
  id: string;
  timestamp: string;
  body: string;
  path: string;
  start: number;
  end: number;
  created?: string;
  rescues?: number;
  source?: string;
  conflict?: boolean;
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

export function uniqueId(): string {
  // Independent devices must not rely on a shared counter or synchronized clock.
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => byte.toString(16).padStart(2, "0")).join("");
  return new Date().toISOString().replace(/[^0-9]/g, "") + `-${suffix}`;
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

export function entryPath(base: string, date: Date, id: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error("Invalid entry identity.");
  const day = localDay(date);
  const folder = baseFolder(base);
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()].map(value => String(value).padStart(2, "0")).join("") + String(date.getMilliseconds()).padStart(3, "0");
  const name = /^\d{17}-[a-f0-9]{12}$/.test(id) ? `${time}-${id.slice(-12)}` : id;
  return `${folder ? `${folder}/` : ""}${day.slice(0, 4)}/${day.slice(0, 7)}/${day}-${name}.md`;
}

export function attachmentFolder(base: string, date: Date): string {
  const path = entryPath(base, date, "attachment");
  return `${path.slice(0, path.lastIndexOf("/") + 1)}attachments`;
}

export function isEntryPath(base: string, path: string): boolean {
  const folder = baseFolder(base);
  const prefix = folder ? `${folder}/` : "";
  if (!path.startsWith(prefix)) return false;
  // Accept renamed/conflict copies within the month too; metadata establishes
  // identity. Old daily files and attachments are not entry files.
  const match = /^(\d{4})\/(\d{4}-\d{2})\/(\d{4}-\d{2}-\d{2})-[^/]+\.md$/.exec(path.slice(prefix.length));
  if (!match || match[1] !== match[3].slice(0, 4) || match[2] !== match[3].slice(0, 7)) return false;
  const parsed = new Date(`${match[3]}T12:00:00`);
  return !Number.isNaN(parsed.valueOf()) && localDay(parsed) === match[3];
}

export function serializeEntry(id: string, timestamp: string, body: string, created = timestamp, rescues = 0, properties: Record<string, unknown> = {}): string {
  if (!/^[a-zA-Z0-9-]+$/.test(id) || !validDate(timestamp) || !validDate(created) || !Number.isSafeInteger(rescues) || rescues < 0) {
    throw new Error("Invalid entry metadata.");
  }
  const metadata = { ...properties, karpathy: 2, id, created, rescued: rescues ? timestamp : null, rescues };
  return "---\n" + stringifyYaml(metadata).trimEnd() + "\n---\n\n" + normalizeBody(body) + "\n";
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}
function normalizeBody(body: string): string {
  return body.replace(/\r\n/g, "\n").replace(/^\n+|\n+$/g, "");
}
function frontmatter(text: string): { properties: Record<string, unknown>; end: number } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return null;
  try {
    const properties: unknown = parseYaml(match[1]);
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) return null;
    return { properties: properties as Record<string, unknown>, end: match[0].length };
  } catch { return null; }
}

// A single standard Markdown document is the complete source of truth.
export function parseEntries(text: string, path: string): Entry[] {
  const header = frontmatter(text);
  if (!header) return [];
  const { karpathy, id, created, rescued, rescues } = header.properties;
  if (karpathy !== 2 || typeof id !== "string" || !/^[a-zA-Z0-9-]+$/.test(id) || !validDate(created) ||
      typeof rescues !== "number" || !Number.isSafeInteger(rescues) || rescues < 0 ||
      (rescues > 0 ? !validDate(rescued) : rescued !== null && rescued !== undefined)) return [];
  return [{ id, timestamp: rescues ? new Date(rescued as string).toISOString() : new Date(created).toISOString(),
    created: new Date(created).toISOString(), rescues, path, body: normalizeBody(text.slice(header.end)),
    start: header.end, end: text.length, source: text }];
}

export function validateEntry(text: string, expected: Entry): Entry {
  const current = parseEntries(text, expected.path)[0];
  if (!current || current.id !== expected.id) throw new Error("This entry was removed or its identity changed. Reopen it before editing.");
  if (expected.source !== undefined ? text !== expected.source :
      current.body !== expected.body || current.timestamp !== expected.timestamp || current.rescues !== expected.rescues) {
    throw new Error("This entry changed elsewhere. Your draft is kept; reopen the latest entry before saving.");
  }
  return current;
}
export function replaceEntry(text: string, expected: Entry, body: string, rescuedAt?: string): string {
  const current = validateEntry(text, expected);
  return serializeEntry(current.id, rescuedAt ?? current.timestamp, body, current.created,
    (current.rescues ?? 0) + (rescuedAt ? 1 : 0), frontmatter(text)!.properties);
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
