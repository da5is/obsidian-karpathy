import { App, TFile, TFolder } from "obsidian";
import { attachmentFolder, baseFolder, Cursor, dailyPath, Entry, insertEntry, isDailyPath, localDay, LruCache, Page, parseEntries, replaceEntry, serializeEntry } from "./model";

interface CachedFile { mtime: number; size: number; entries: Entry[] }
interface Rescue { source: Entry; target: string; timestamp: string; body: string }

export class Store {
  private cache = new LruCache<string, CachedFile>(16, 4 * 1024 * 1024);
  private searchIndex = new LruCache<string, { mtime: number; size: number; text: string }>(1024, 8 * 1024 * 1024);
  private searchable = new WeakMap<Entry, string>();
  private revision = 0;
  private counts = new Map<string, { mtime: number; size: number; count: number }>();
  private writes = new Map<string, Promise<unknown>>();
  files: TFile[] = [];
  constructor(private app: App, public base: string) { this.reindex(); }

  reindex(): void {
    this.files = this.app.vault.getMarkdownFiles().filter(file => isDailyPath(this.base, file.path))
      .sort((a, b) => b.path.localeCompare(a.path));
    const paths = new Set(this.files.map(file => file.path));
    for (const path of this.counts.keys()) if (!paths.has(path)) this.counts.delete(path);
  }
  invalidate(path: string): void {
    this.cache.delete(path);
    this.searchIndex.delete(path);
    this.counts.delete(path);
    this.revision++;
  }
  clear(): void { this.cache.clear(); this.searchIndex.clear(); this.counts.clear(); this.revision++; }

  async countEntries(valid: () => boolean = () => true): Promise<number | null> {
    const revision = this.revision;
    let total = 0;
    for (const file of [...this.files]) {
      if (!valid() || revision !== this.revision) return null;
      let count = this.counts.get(file.path);
      if (!count || count.mtime !== file.stat.mtime || count.size !== file.stat.size) {
        const { mtime, size } = file.stat;
        const text = await this.app.vault.read(file);
        if (!valid() || revision !== this.revision || mtime !== file.stat.mtime || size !== file.stat.size) return null;
        count = { mtime, size, count: parseEntries(text, file.path).length };
        this.counts.set(file.path, count);
        // Count in the background without retaining or evicting rendered-note data.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      total += count.count;
    }
    return valid() && revision === this.revision ? total : null;
  }

  async entries(file: TFile): Promise<Entry[]> {
    const cached = this.cache.get(file.path);
    if (cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size) return cached.entries;
    const revision = this.revision;
    const mtime = file.stat.mtime;
    const size = file.stat.size;
    const text = await this.app.vault.read(file);
    const entries = parseEntries(text, file.path);
    if (revision === this.revision && mtime === file.stat.mtime && size === file.stat.size) {
      this.counts.set(file.path, { mtime, size, count: entries.length });
      this.cache.set(file.path, { mtime, size, entries }, text.length * 2 + entries.reduce((n, entry) => n + entry.body.length * 2 + 256, 0));
      const searchText = entries.map(entry => this.searchText(entry)).join("\n");
      this.searchIndex.set(file.path, { mtime, size, text: searchText }, searchText.length * 2 + 128);
    }
    return entries;
  }

  private searchText(entry: Entry): string {
    let text = this.searchable.get(entry);
    if (text === undefined) {
      text = `${entry.body}\n${entry.timestamp}\n${entry.path}`.toLocaleLowerCase();
      this.searchable.set(entry, text);
    }
    return text;
  }

  async page(cursor: Cursor, direction: 1 | -1, query: string, limit = 30, valid: () => boolean = () => true): Promise<Page> {
    const snapshot = [...this.files];
    const position = { ...cursor };
    const found: Entry[] = [];
    let scannedFiles = 0;
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const matches = (entry: Entry) => terms.every(term => this.searchText(entry).includes(term));
    while (position.file >= 0 && position.file < snapshot.length && found.length < limit && scannedFiles < 8 && valid()) {
      const file = snapshot[position.file];
      const indexed = terms.length ? this.searchIndex.get(file.path) : undefined;
      const skip = indexed && indexed.mtime === file.stat.mtime && indexed.size === file.stat.size && !terms.every(term => indexed.text.includes(term));
      const entries = skip ? [] : await this.entries(file);
      if (direction === -1) position.offset = Math.min(position.offset, entries.length);
      if (!valid()) break;
      if (direction === 1) {
        while (position.offset < entries.length && found.length < limit) {
          const entry = entries[position.offset++];
          if (matches(entry)) found.push(entry);
        }
        if (position.offset >= entries.length) { position.file++; position.offset = 0; scannedFiles++; }
      } else {
        while (position.offset > 0 && found.length < limit) {
          const entry = entries[--position.offset];
          if (entry && matches(entry)) found.unshift(entry);
        }
        if (position.offset === 0) {
          position.file--;
          position.offset = position.file >= 0 ? (await this.entries(snapshot[position.file])).length : 0;
          scannedFiles++;
        }
      }
    }
    return {
      entries: found,
      start: direction === 1 ? { ...cursor } : position,
      end: direction === 1 ? position : { ...cursor },
      exhausted: direction === 1 ? position.file >= snapshot.length : position.file < 0
    };
  }

  async cursorFor(entry: Entry): Promise<Cursor> {
    const file = this.files.findIndex(file => file.path === entry.path);
    if (file < 0) return { file: 0, offset: 0 };
    const offset = (await this.entries(this.files[file])).findIndex(item => item.id === entry.id);
    return { file, offset: Math.max(0, offset) };
  }

  private async serial<T>(path: string, work: () => Promise<T>): Promise<T> {
    const previous = this.writes.get(path) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.writes.set(path, next);
    try { return await next; }
    finally { if (this.writes.get(path) === next) this.writes.delete(path); }
  }

  async folder(path: string): Promise<void> {
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const current = parts.slice(0, i).join("/");
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFolder) continue;
      if (existing) throw new Error(`A file occupies the folder path: ${current}`);
      try { await this.app.vault.createFolder(current); }
      catch (error) {
        if (!(this.app.vault.getAbstractFileByPath(current) instanceof TFolder)) throw error;
      }
    }
  }

  async capture(body: string, date: Date, id: string, created?: string, rescues = 0): Promise<void> {
    if (!body.trim()) throw new Error("Write something before saving.");
    const path = dailyPath(this.base, date);
    const serialized = serializeEntry(id, date.toISOString(), body, created, rescues);
    await this.serial(path, async () => {
      await this.folder(path.slice(0, path.lastIndexOf("/")));
      let file = this.app.vault.getAbstractFileByPath(path);
      if (!file) {
        try { await this.app.vault.create(path, insertEntry("", serialized, localDay(date))); return; }
        catch (error) {
          file = this.app.vault.getAbstractFileByPath(path);
          if (!(file instanceof TFile)) throw error;
        }
      }
      if (!(file instanceof TFile)) throw new Error(`A folder occupies the daily note path: ${path}`);
      await this.app.vault.process(file, text => {
        const existing = parseEntries(text, path).find(entry => entry.id === id);
        if (existing) {
          if (existing.body !== parseEntries(serialized, path)[0].body || existing.timestamp !== date.toISOString()) {
            throw new Error("A different version of this capture already exists. Your draft is kept; copy it into a new entry.");
          }
          return text;
        }
        return insertEntry(text, serialized, localDay(date));
      });
    });
    this.invalidate(path);
    this.reindex();
  }

  async update(entry: Entry, body: string | null): Promise<void> {
    await this.serial(entry.path, async () => {
      const file = this.app.vault.getAbstractFileByPath(entry.path);
      if (!(file instanceof TFile)) throw new Error("The daily note no longer exists.");
      await this.app.vault.process(file, text => replaceEntry(text, entry, body));
    });
    this.invalidate(entry.path);
  }

  private get rescueKey(): string { return `karpathy:rescue:${this.base}`; }

  async rescue(entry: Entry, date = new Date()): Promise<void> {
    await this.serial("rescue", async () => {
      await this.recoverRescue();
      const target = dailyPath(this.base, date);
      if (target === entry.path) {
        await this.serial(entry.path, async () => {
          const file = this.app.vault.getAbstractFileByPath(entry.path);
          if (!(file instanceof TFile)) throw new Error("The daily note no longer exists.");
          await this.app.vault.process(file, text => insertEntry(replaceEntry(text, entry, null),
            serializeEntry(entry.id, date.toISOString(), entry.body, entry.created ?? entry.timestamp, (entry.rescues ?? 0) + 1), localDay(date)));
        });
      } else {
        // Store links created by this plugin are vault-relative and remain valid.
        // User-written relative links need rebasing before their source file changes.
        const file = this.app.vault.getAbstractFileByPath(entry.path);
        if (!(file instanceof TFile)) throw new Error("The daily note no longer exists.");
        const text = await this.app.vault.read(file);
        replaceEntry(text, entry, null);
        const body = this.rebaseLinks(entry, text);
        const record: Rescue = { source: entry, target, timestamp: date.toISOString(), body };
        this.app.saveLocalStorage(this.rescueKey, record);
        await this.finishRescue(record);
      }
      this.clear();
      this.reindex();
    });
  }

  private rebaseLinks(entry: Entry, text: string): string {
    const cache = this.app.metadataCache.getFileCache?.(this.app.vault.getAbstractFileByPath(entry.path) as TFile);
    const links = [...(cache?.links ?? []), ...(cache?.embeds ?? [])].sort((a, b) => b.position.start.offset - a.position.start.offset);
    let body = entry.body;
    const bodyStart = text.indexOf(entry.body, entry.start);
    if (bodyStart < 0) throw new Error("Entry changed while preparing rescue. Reload it and try again.");
    // Cached offsets refer to the full file. Only change links in this entry,
    // in descending order so repeated links keep their original positions.
    for (const link of links) {
      const at = link.position.start.offset - bodyStart;
      if (at < 0 || at + link.original.length > entry.body.length || entry.body.slice(at, at + link.original.length) !== link.original) continue;
      const destination = this.app.metadataCache.getFirstLinkpathDest(link.link.split("#")[0], entry.path);
      if (!destination) continue;
      const fragment = link.link.includes("#") ? link.link.slice(link.link.indexOf("#")) : "";
      const original = link.original;
      if (link.link === destination.path + fragment) continue;
      const label = link.displayText || destination.basename;
      const embedded = original.startsWith("!");
      const replacement = `${embedded ? "!" : ""}[[${destination.path}${fragment}|${label}]]`;
      body = body.slice(0, at) + replacement + body.slice(at + original.length);
    }
    return body;
  }

  async recoverRescue(): Promise<void> {
    const record = this.app.loadLocalStorage(this.rescueKey) as Rescue | null;
    if (!record) return;
    if (!isDailyPath(this.base, record.source?.path ?? "") || !isDailyPath(this.base, record.target ?? "") ||
        record.target !== dailyPath(this.base, new Date(record.timestamp)) || typeof record.body !== "string") {
      throw new Error("Invalid rescue recovery record; it has been preserved for inspection.");
    }
    await this.finishRescue(record);
    this.clear();
    this.reindex();
  }

  private async finishRescue(record: Rescue): Promise<void> {
    const { source, target, timestamp, body } = record;
    await this.serial(source.path, async () => {
      const file = this.app.vault.getAbstractFileByPath(source.path);
      const text = file instanceof TFile ? await this.app.vault.read(file) : "";
      const current = parseEntries(text, source.path).find(item => item.id === source.id);
      if (current) replaceEntry(text, source, null); // Validate before creating the destination.
      const destination = this.app.vault.getAbstractFileByPath(target);
      const moved = destination instanceof TFile ? parseEntries(await this.app.vault.read(destination), target).find(item => item.id === source.id) : undefined;
      if (!current && !moved) throw new Error("Rescue source is missing. Recovery record retained.");
      if (moved && (moved.body !== body || moved.timestamp !== timestamp)) throw new Error("Rescued entry changed elsewhere. Both versions retained; resolve the rescue before retrying.");
      if (!moved) await this.capture(body, new Date(timestamp), source.id, source.created ?? source.timestamp, (source.rescues ?? 0) + 1);
      // Destination is durable before deleting the source. A failure keeps the recovery record.
      if (current && file instanceof TFile) await this.app.vault.process(file, latest => replaceEntry(latest, source, null));
      this.app.saveLocalStorage(this.rescueKey, null);
    });
  }

  async attachment(file: File, date: Date, base = this.base): Promise<string> {
    const folder = attachmentFolder(baseFolder(base), date);
    await this.folder(folder);
    const cleaned = file.name.replace(/[<>:"/\\|?*#^[\]\u0000-\u001f]/g, "-").replace(/^[. ]+|[. ]+$/g, "").slice(-140);
    const extensions: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/heic": ".heic", "image/avif": ".avif" };
    const original = cleaned && cleaned !== "image" ? cleaned : `image${extensions[file.type] ?? ".bin"}`;
    const name = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(original) ? `_${original}` : original;
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    return this.serial(folder, async () => {
      const data = await file.arrayBuffer();
      const directory = this.app.vault.getAbstractFileByPath(folder);
      if (!(directory instanceof TFolder)) throw new Error("The attachment folder no longer exists.");
      const existing = new Set(directory.children.map(child => child.name.toLowerCase()));
      let suffix = 1;
      let filename = name;
      let path = `${folder}/${filename}`;
      while (existing.has(filename.toLowerCase()) || this.app.vault.getAbstractFileByPath(path)) {
        filename = `${stem}-${++suffix}${extension}`;
        path = `${folder}/${filename}`;
      }
      await this.app.vault.createBinary(path, data);
      return file.type.startsWith("image/") ? `![[${path}]]` : `[[${path}|${filename}]]`;
    });
  }
}
