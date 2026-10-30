import type { App } from "obsidian";
import { uniqueId } from "./model";

export interface IndexRecord {
  path: string;
  mtime: number;
  size: number;
  id: string;
  timestamp: string;
}

// IndexedDB is device-local, outside the synced vault. Losing it only costs a
// rebuild; entry Markdown always remains authoritative. Text is kept on disk,
// separately from the small ordering records loaded into memory.
export class LocalIndex {
  private database: Promise<IDBDatabase | undefined>;
  private disabled = false;
  constructor(app: App) {
    this.database = this.open(app).catch(error => { this.fail(error); return undefined; });
  }
  private async open(app: App): Promise<IDBDatabase | undefined> {
    if (typeof indexedDB === "undefined") return undefined;
    const key = "karpathy:index-database:v2";
    let name = app.loadLocalStorage(key);
    if (typeof name !== "string" || !/^karpathy-index-[a-zA-Z0-9-]+$/.test(name)) {
      name = `karpathy-index-${uniqueId()}`;
      app.saveLocalStorage(key, name);
    }
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("metadata", { keyPath: "path" });
        request.result.createObjectStore("search", { keyPath: "path" });
      };
      request.onsuccess = () => {
        const db = request.result;
        if (this.disabled) { db.close(); resolve(undefined); return; }
        db.onversionchange = () => { db.close(); this.disabled = true; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { this.disabled = true; resolve(undefined); };
    });
  }
  private fail(error: unknown): void {
    if (!this.disabled) console.warn("[karpathy] Local index unavailable; using Markdown files.", error);
    this.disabled = true;
  }
  private async read<T>(store: string, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
    try {
      const db = await this.database;
      if (!db || this.disabled) return undefined;
      return await new Promise<T>((resolve, reject) => {
        const request = operation(db.transaction(store, "readonly").objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } catch (error) { this.fail(error); return undefined; }
  }
  async records(): Promise<IndexRecord[]> {
    return await this.read<IndexRecord[]>("metadata", store => store.getAll()) ?? [];
  }
  async text(path: string, mtime: number, size: number): Promise<string | undefined> {
    const record = await this.read<{ mtime: number; size: number; text: string }>("search", store => store.get(path));
    return record?.mtime === mtime && record.size === size ? record.text : undefined;
  }
  async texts(records: IndexRecord[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (!records.length) return result;
    try {
      const db = await this.database;
      if (!db || this.disabled) return result;
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction("search", "readonly");
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
        const store = transaction.objectStore("search");
        for (const record of records) {
          const request = store.get(record.path);
          request.onsuccess = () => {
            const saved = request.result;
            if (saved?.mtime === record.mtime && saved.size === record.size && typeof saved.text === "string") result.set(record.path, saved.text);
          };
        }
      });
    } catch (error) { this.fail(error); result.clear(); }
    return result;
  }
  private async write(work: (meta: IDBObjectStore, search: IDBObjectStore) => void): Promise<void> {
    try {
      const db = await this.database;
      if (!db || this.disabled) return;
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(["metadata", "search"], "readwrite");
        transaction.oncomplete = () => resolve();
        transaction.onerror = transaction.onabort = () => reject(transaction.error);
        work(transaction.objectStore("metadata"), transaction.objectStore("search"));
      });
    } catch (error) { this.fail(error); }
  }
  async put(record: IndexRecord, text: string): Promise<void> {
    await this.write((meta, search) => {
      meta.put(record);
      search.put({ path: record.path, mtime: record.mtime, size: record.size, text });
    });
  }
  async remove(path: string): Promise<void> {
    await this.write((meta, search) => { meta.delete(path); search.delete(path); });
  }
  async clear(): Promise<void> {
    await this.write((meta, search) => { meta.clear(); search.clear(); });
  }
  async close(): Promise<void> { (await this.database)?.close(); }
}
