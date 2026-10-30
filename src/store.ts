import { App, TFile, TFolder } from "obsidian";
import { attachmentFolder, baseFolder, Cursor, entryPath, Entry, isEntryPath, LruCache, Page, parseEntries, replaceEntry, serializeEntry, uniqueId, validateEntry } from "./model";
import { IndexRecord, LocalIndex } from "./index";

interface CachedFile { mtime: number; size: number; entries: Entry[] }

export class Store {
  private cache = new LruCache<string, CachedFile>(512, 8 * 1024 * 1024);
  private searchCache = new LruCache<string, string>(2048, 8 * 1024 * 1024);
  private records = new Map<string, IndexRecord>();
  private pendingIndex = new Map<string, { record: IndexRecord; text: string }>();
  private candidates = new Map<string, TFile>();
  private dirty = new Set<string>();
  private epochs = new Map<string, number>();
  private writes = new Map<string, Promise<unknown>>();
  private order: TFile[] = [];
  private orderDirty = true;
  private conflicts = new Set<string>();
  private initial: Promise<void>;
  private rebuilding?: Promise<void>;
  private index: LocalIndex;
  private closed = false;
  readonly failures = new Map<string, number>();
  private verification?: Promise<void>;
  private verificationTimer?: ReturnType<typeof setTimeout>;
  onReconciled?: () => void;
  onProgress?: (remaining: number, total: number) => void;
  private lastVerification = 0;

  // Re-read authoritative files in small batches, including same-stat changes.
  reconcile(all = true): Promise<void> {
    if (this.verification) return this.verification;
    this.verification = (async () => {
      await this.initial;
      const files = [...this.candidates.values()].filter(file => all || this.failures.has(file.path));
      for (let i = 0; i < files.length && !this.closed; i += 8) {
        await Promise.all(files.slice(i, i + 8).map(file => {
          this.cache.delete(file.path);
          return this.entries(file, false);
        }));
        await this.flushIndex();
        if (i + 8 < files.length) await new Promise(resolve => setTimeout(resolve, 20));
      }
      if (all) this.lastVerification = Date.now();
      if (!this.closed && files.length) this.onReconciled?.();
    })().finally(() => { this.verification = undefined; });
    return this.verification;
  }
  private scheduleVerification(): void {
    if (this.closed) return;
    this.verificationTimer = setTimeout(() => {
      void this.reconcile(Date.now() - this.lastVerification >= 15 * 60000).catch(error => console.warn("[karpathy] Verification failed", error))
        .finally(() => this.scheduleVerification());
    }, 60000);
    (this.verificationTimer as unknown as { unref?: () => void }).unref?.();
  }
  private indexedBase: string;
  constructor(private app: App, public base: string) {
    this.indexedBase = base;
    this.index = new LocalIndex(app);
    this.reindex();
    this.initial = this.restore();
    this.scheduleVerification();
  }

  private async restore(): Promise<void> {
    for (const record of await this.index.records()) {
      if (!record || typeof record.path !== "string" || typeof record.id !== "string" || typeof record.timestamp !== "string" ||
          !Number.isFinite(record.mtime) || !Number.isFinite(record.size) ||
          (record.id && (!/^[a-zA-Z0-9-]+$/.test(record.id) || !Number.isFinite(Date.parse(record.timestamp))))) continue;
      const file = this.candidates.get(record.path);
      if (file && !this.epochs.has(record.path) && typeof record.id === "string" && typeof record.timestamp === "string" &&
          record.mtime === file.stat.mtime && record.size === file.stat.size) {
        this.records.set(record.path, record);
        this.dirty.delete(record.path);
      } else if (!file) await this.index.remove(record.path);
    }
    this.orderDirty = true;
  }

  // Full enumeration is only for startup, explicit refresh, base changes and
  // folder-level events. Ordinary file events update the candidate map directly.
  reindex(): void {
    if (this.indexedBase !== this.base) {
      this.indexedBase = this.base;
      this.records.clear(); this.cache.clear(); this.searchCache.clear();
    }
    const files = this.app.vault.getMarkdownFiles().filter(file => isEntryPath(this.base, file.path));
    const paths = new Set(files.map(file => file.path));
    for (const path of this.candidates.keys()) if (!paths.has(path)) this.invalidate(path);
    for (const file of files) {
      this.candidates.set(file.path, file);
      const record = this.records.get(file.path);
      if (!record || record.mtime !== file.stat.mtime || record.size !== file.stat.size) this.dirty.add(file.path);
    }
    this.orderDirty = true;
  }
  invalidate(path: string): void {
    if (!this.candidates.has(path) && !this.records.has(path) && !isEntryPath(this.base, path)) return;
    this.failures.delete(path);
    this.epochs.set(path, (this.epochs.get(path) ?? 0) + 1);
    this.cache.delete(path); this.searchCache.delete(path);
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile && isEntryPath(this.base, path)) {
      this.candidates.set(path, file); this.dirty.add(path);
    } else {
      this.candidates.delete(path); this.records.delete(path); this.dirty.delete(path);
    }
    this.orderDirty = true;
    void this.index.remove(path);
  }
  clear(): void {
    this.cache.clear(); this.searchCache.clear(); this.records.clear();
    for (const path of this.candidates.keys()) {
      this.epochs.set(path, (this.epochs.get(path) ?? 0) + 1);
      this.dirty.add(path);
    }
    this.orderDirty = true;
    void this.index.clear();
  }
  async close(): Promise<void> { this.closed = true; clearTimeout(this.verificationTimer); await this.initial; await this.rebuilding; await this.verification; await this.index.close(); }

  get files(): TFile[] {
    if (this.orderDirty) {
      this.order = [...this.candidates.values()].filter(file => this.records.get(file.path)?.id)
        .sort((a, b) => {
          const one = this.records.get(a.path)!, two = this.records.get(b.path)!;
          return two.timestamp.localeCompare(one.timestamp) || two.id.localeCompare(one.id) || b.path.localeCompare(a.path);
        });
      this.orderDirty = false;
      this.conflicts.clear();
      const identities = new Set<string>();
      for (const file of this.order) {
        const id = this.records.get(file.path)!.id;
        if (identities.has(id)) this.conflicts.add(id);
        identities.add(id);
      }
    }
    return this.order;
  }

  private async ready(): Promise<void> {
    await this.initial;
    if (!this.rebuilding) {
      this.rebuilding = (async () => {
        let yielded = performance.now();
        while (this.dirty.size && !this.closed) {
          this.onProgress?.(this.dirty.size, this.candidates.size);
          const paths: string[] = [];
          for (const path of this.dirty) { paths.push(path); if (paths.length === 32) break; }
          for (let i = 0; i < paths.length; i += 8) {
            await Promise.all(paths.slice(i, i + 8).map(async path => {
              const file = this.candidates.get(path);
              if (file) await this.entries(file, false); else this.dirty.delete(path);
            }));
          }
          await this.flushIndex();
          if (this.dirty.size && performance.now() - yielded > 8) {
            await new Promise(resolve => setTimeout(resolve, 0)); yielded = performance.now();
          }
        }
      })().finally(() => { this.rebuilding = undefined; this.onProgress?.(0, this.candidates.size); });
    }
    await this.rebuilding;
  }
  async countEntries(valid: () => boolean = () => true): Promise<number | null> {
    await this.ready();
    return valid() ? this.files.length : null;
  }
  private async flushIndex(): Promise<void> {
    const values = [...this.pendingIndex.values()].filter(value => this.records.get(value.record.path) === value.record && !this.dirty.has(value.record.path));
    this.pendingIndex.clear();
    await this.index.putMany(values);
    for (const { record } of values) if (this.records.get(record.path) !== record || this.dirty.has(record.path)) await this.index.remove(record.path);
  }
  private async remember(file: TFile, text: string, epoch: number, mtime: number, size: number, persist = true): Promise<Entry[]> {
    const entries = parseEntries(text, file.path);
    if ((this.epochs.get(file.path) ?? 0) !== epoch || this.app.vault.getAbstractFileByPath(file.path) !== file ||
        file.stat.mtime !== mtime || file.stat.size !== size) return entries;
    const entry = entries[0];
    const record: IndexRecord = { path: file.path, mtime, size, id: entry?.id ?? "", timestamp: entry?.timestamp ?? "" };
    const search = entry ? [entry.body, entry.created, entry.timestamp, file.path].join("\n").toLocaleLowerCase() : "";
    const previous = this.records.get(file.path);
    if (!previous || previous.id !== record.id || previous.timestamp !== record.timestamp) this.orderDirty = true;
    this.records.set(file.path, record);
    this.failures.delete(file.path);
    this.dirty.delete(file.path);
    this.cache.set(file.path, { mtime, size, entries }, text.length * 4 + 256);
    this.searchCache.set(file.path, search, search.length * 2 + 128);
    if (persist) await this.index.put(record, search);
    else this.pendingIndex.set(file.path, { record, text: search });
    return entries;
  }
  async entries(file: TFile, persist = true): Promise<Entry[]> {
    await this.initial;
    const cached = this.cache.get(file.path);
    if (!this.dirty.has(file.path) && cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size) return cached.entries;
    const epoch = this.epochs.get(file.path) ?? 0;
    const { mtime, size } = file.stat;
    try { return await this.remember(file, await this.app.vault.read(file), epoch, mtime, size, persist); }
    catch {
      if ((this.epochs.get(file.path) ?? 0) === epoch) {
        this.failures.set(file.path, Date.now());
        this.dirty.delete(file.path);
        this.records.delete(file.path);
        this.cache.delete(file.path); this.searchCache.delete(file.path);
        this.orderDirty = true;
        await this.index.remove(file.path);
      }
      return [];
    }
  }
  private async searchTexts(files: TFile[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const missing: IndexRecord[] = [];
    for (const file of files) {
      const cached = this.searchCache.get(file.path);
      if (cached !== undefined && !this.dirty.has(file.path)) result.set(file.path, cached);
      else {
        const record = this.records.get(file.path);
        if (record && !this.dirty.has(file.path)) missing.push(record);
      }
    }
    for (const [path, text] of await this.index.texts(missing)) {
      result.set(path, text); this.searchCache.set(path, text, text.length * 2 + 128);
    }
    const unread = files.filter(file => !result.has(file.path));
    for (let i = 0; i < unread.length; i += 8) await Promise.all(unread.slice(i, i + 8).map(async file => {
      const entry = (await this.entries(file))[0];
      result.set(file.path, entry ? [entry.body, entry.created, entry.timestamp, file.path].join("\n").toLocaleLowerCase() : "");
    }));
    return result;
  }

  async page(cursor: Cursor, direction: 1 | -1, query: string, limit = 30, valid: () => boolean = () => true): Promise<Page> {
    await this.ready();
    const snapshot = this.files;
    let position = Math.max(0, Math.min(snapshot.length, cursor.file + cursor.offset));
    const initial = position;
    const found: Entry[] = [];
    const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    let scanned = 0;
    while (valid() && found.length < limit && scanned < 256 && (direction === 1 ? position < snapshot.length : position > 0)) {
      const amount = Math.min(terms.length ? 256 : Math.min(8, limit - found.length), 256 - scanned, direction === 1 ? snapshot.length - position : position);
      const batch = Array.from({ length: amount }, (_, i) => snapshot[direction === 1 ? position + i : position - 1 - i]);
      const texts = terms.length ? await this.searchTexts(batch) : undefined;
      if (!valid()) break;
      const matched: TFile[] = [];
      let consumed = 0;
      for (const file of batch) {
        consumed++;
        if (!texts || terms.every(term => texts.get(file.path)?.includes(term))) matched.push(file);
        if (matched.length === limit - found.length) break;
      }
      for (let i = 0; i < matched.length && valid(); i += 8) {
        const entries = await Promise.all(matched.slice(i, i + 8).map(async file => {
          const entry = (await this.entries(file))[0];
          return entry ? { ...entry, conflict: this.conflicts.has(entry.id) } : undefined;
        }));
        if (!valid()) break;
        for (const entry of entries) if (entry) direction === 1 ? found.push(entry) : found.unshift(entry);
      }
      position += direction * consumed; scanned += consumed;
    }
    const before = { file: direction === 1 ? initial : position, offset: 0 };
    const after = { file: direction === 1 ? position : initial, offset: 0 };
    return { entries: found, start: before, end: after, exhausted: direction === 1 ? position >= snapshot.length : position <= 0 };
  }
  async cursorFor(entry: Entry): Promise<Cursor> {
    await this.ready();
    return { file: Math.max(0, this.files.findIndex(file => file.path === entry.path)), offset: 0 };
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

  async capture(body: string, date: Date, id: string): Promise<void> {
    if (!body.trim()) throw new Error("Write something before saving.");
    await this.initial;
    const path = entryPath(this.base, date, id);
    const text = serializeEntry(id, date.toISOString(), body);
    await this.serial(path, async () => {
      await this.folder(path.slice(0, path.lastIndexOf("/")));
      let file = this.app.vault.getAbstractFileByPath(path);
      if (!file) {
        try { file = await this.app.vault.create(path, text); }
        catch (error) { file = this.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) throw error; }
      }
      if (!(file instanceof TFile)) throw new Error("A folder occupies the entry path: " + path);
      if (await this.app.vault.read(file) !== text) throw new Error("A different version of this capture already exists. Your draft is kept; copy it into a new entry.");
      this.candidates.set(path, file);
      await this.remember(file, text, this.epochs.get(path) ?? 0, file.stat.mtime, file.stat.size);
    });
  }
  async update(entry: Entry, body: string): Promise<void> {
    if (!body.trim()) throw new Error("An entry cannot be empty.");
    await this.change(entry, text => replaceEntry(text, entry, body));
  }
  private async change(entry: Entry, work: (text: string) => string): Promise<void> {
    await this.initial;
    await this.serial(entry.path, async () => {
      const file = this.app.vault.getAbstractFileByPath(entry.path);
      if (!(file instanceof TFile)) throw new Error("The entry note no longer exists.");
      const text = await this.app.vault.process(file, work);
      this.cache.delete(entry.path); this.searchCache.delete(entry.path);
      await this.remember(file, text, this.epochs.get(entry.path) ?? 0, file.stat.mtime, file.stat.size);
    });
  }
  async rescue(entry: Entry, date = new Date()): Promise<void> {
    await this.change(entry, text => replaceEntry(text, entry, entry.body, date.toISOString()));
  }
  async remove(entry: Entry): Promise<void> {
    await this.initial;
    await this.serial(entry.path, async () => {
      const file = this.app.vault.getAbstractFileByPath(entry.path);
      if (!(file instanceof TFile)) throw new Error("The entry note no longer exists.");
      validateEntry(await this.app.vault.read(file), entry);
      await this.app.vault.trash(file, true);
      this.invalidate(entry.path);
    });
  }

  async attachment(file: File, date: Date, base = this.base): Promise<string> {
    if (file.size > 50 * 1024 * 1024) throw new Error("Attachments are limited to 50 MiB each. Add larger files to the vault and link them.");
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
      let filename = `${stem}-${uniqueId()}${extension}`;
      let path = `${folder}/${filename}`;
      while (existing.has(filename.toLowerCase()) || this.app.vault.getAbstractFileByPath(path)) {
        filename = `${stem}-${uniqueId()}-${++suffix}${extension}`;
        path = `${folder}/${filename}`;
      }
      await this.app.vault.createBinary(path, data);
      return file.type.startsWith("image/") ? `![[${path}]]` : `[[${path}|${name}]]`;
    });
  }
}
