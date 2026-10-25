import { FileSystemAdapter, getLinkpath, Notice, Platform, Plugin, TAbstractFile, TFile } from "obsidian";
import { baseFolder, Entry, entryPrefix } from "./model";
import { DEFAULT_SETTINGS, KarpathySettingsTab, parseSettings, Settings, themePrefixColor } from "./settings";
import { Store } from "./store";
import { KarpathyView, VIEW_TYPE } from "./view";

export interface Draft { body: string; timestamp: string; id: string; original?: Entry }

export default class KarpathyPlugin extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  store!: Store;
  private hiddenStyle?: HTMLStyleElement;
  private folderObserver?: MutationObserver;
  private hideFrame?: number;
  private refreshTimer?: number;
  editing = 0;
  private prefixWrites: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    // Invalid persisted paths must not quietly redirect writes to another folder.
    this.settings = parseSettings(await this.loadData());
    this.store = new Store(this.app, this.settings.baseFolder);
    await this.store.recoverRescue().catch(error => this.report(error));
    this.registerView(VIEW_TYPE, leaf => new KarpathyView(leaf, this));
    this.addSettingTab(new KarpathySettingsTab(this.app, this));
    this.addRibbonIcon("notebook-pen", "Open Karpathy", () => { void this.open().catch(error => this.report(error)); });
    this.addCommand({ id: "open-stream", name: "Open stream", callback: () => { void this.open().catch(error => this.report(error)); } });
    this.addCommand({ id: "capture", name: "Capture a thought", callback: () => {
      void this.open().then(view => view.focusComposer()).catch(error => this.report(error));
    } });
    this.addCommand({ id: "attach-files", name: "Attach files to capture", callback: () => {
      const view = this.views()[0];
      if (view) view.attachFiles();
      else void this.open().then(view => view.attachFiles()).catch(error => this.report(error));
    } });
    this.addCommand({ id: "refresh", name: "Refresh stream and cache", callback: () => {
      this.store.clear();
      this.changed();
    } });
    this.addCommand({ id: "recover-rescue", name: "Retry interrupted rescue", callback: () => {
      void this.store.recoverRescue().then(() => this.changed()).catch(error => this.report(error));
    } });
    this.registerEvent(this.app.vault.on("create", file => this.fileChanged(file)));
    this.registerEvent(this.app.vault.on("modify", file => this.fileChanged(file)));
    this.registerEvent(this.app.vault.on("delete", file => this.fileChanged(file)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.store.invalidate(oldPath);
      this.fileChanged(file, oldPath);
    }));
    this.app.workspace.onLayoutReady(() => {
      this.applyFolderHiding();
      if (this.settings.openOnStartup) void this.open().catch(error => this.report(error));
    });
    this.register(() => {
      window.clearTimeout(this.refreshTimer);
      if (this.hideFrame !== undefined) window.cancelAnimationFrame(this.hideFrame);
      this.folderObserver?.disconnect();
      this.unhide();
      this.hiddenStyle?.remove();
      this.store.clear();
    });
  }

  views(): KarpathyView[] {
    return this.app.workspace.getLeavesOfType(VIEW_TYPE).map(leaf => leaf.view).filter((view): view is KarpathyView => view instanceof KarpathyView);
  }

  async open(): Promise<KarpathyView> {
    let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    if (!(leaf.view instanceof KarpathyView)) throw new Error("Could not open the stream.");
    return leaf.view;
  }

  async openStreamLink(linktext: string, sourcePath: string): Promise<void> {
    const file = this.app.metadataCache.getFirstLinkpathDest(getLinkpath(linktext), sourcePath);
    if (file && (file.extension !== "md" || file.path.includes("/attachments/")) &&
        Platform.isDesktopApp && this.app.vault.adapter instanceof FileSystemAdapter) {
      const electron: { shell: { openPath(path: string): Promise<string> } } = require("electron");
      const error = await electron.shell.openPath(this.app.vault.adapter.getFullPath(file.path));
      if (error) throw new Error(`Could not open ${file.name}: ${error}`);
      return;
    }
    await this.app.workspace.openLinkText(linktext, sourcePath, "tab");
  }

  imageSource(link: string, sourcePath: string): string | null {
    if (/^https?:\/\//i.test(link)) return link;
    let decoded = link;
    try { decoded = decodeURIComponent(link); } catch { /* Keep literal filenames. */ }
    const file = this.app.metadataCache.getFirstLinkpathDest(decoded, sourcePath);
    return file instanceof TFile && /^(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(file.extension) ? this.app.vault.getResourcePath(file) : null;
  }

  private fileChanged(file: TAbstractFile, oldPath?: string): void {
    const base = this.settings.baseFolder;
    const relevant = (path: string) => path === base || path.startsWith(`${base}/`) || base.startsWith(`${path}/`);
    if (!relevant(file.path) && (!oldPath || !relevant(oldPath))) return;
    this.store.invalidate(file.path);
    if (!(file instanceof TFile) || file.extension === "md" || oldPath?.endsWith(".md")) this.changed();
  }

  changed(): void {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.store.reindex();
      for (const view of this.views()) void view.refresh(true).catch(error => this.report(error));
    }, 180);
  }

  async changeBase(value: string): Promise<void> {
    const folder = baseFolder(value);
    await this.store.recoverRescue();
    if (this.views().some(view => view.hasDraft) || this.editing) {
      throw new Error("Save or clear the current draft and close entry editors before changing the base folder.");
    }
    const next = { ...this.settings, baseFolder: folder };
    await this.saveData(next);
    this.settings = next;
    this.store.base = folder;
    this.store.clear();
    this.store.reindex();
    for (const view of this.views()) await view.reconfigure();
    new Notice(`Karpathy now reads and writes in ${folder}. Existing files have not been moved.`);
  }

  async persistSettings(): Promise<void> {
    try { await this.saveData(this.settings); this.changed(); }
    catch (error) { this.report(error); throw error; }
  }

  rememberPrefix(body: string): Promise<void> {
    const prefix = entryPrefix(body)?.[1].toLowerCase();
    if (!prefix) return Promise.resolve();
    const work = this.prefixWrites.catch(() => undefined).then(async () => {
      if (Object.prototype.hasOwnProperty.call(this.settings.prefixColors, prefix)) return;
      const next = { ...this.settings, prefixColors: { ...this.settings.prefixColors, [prefix]: themePrefixColor(prefix) } };
      await this.saveData(next);
      this.settings = next;
      this.changed();
    });
    this.prefixWrites = work;
    return work;
  }

  draftKey(entry?: Entry): string {
    return entry ? `karpathy:edit:${entry.path}:${entry.id}` : `karpathy:capture:${this.settings.baseFolder}`;
  }
  readDraft(key: string): Draft | null {
    const value: unknown = this.app.loadLocalStorage(key);
    if (!value || typeof value !== "object") return null;
    const draft = value as Partial<Draft>;
    if (typeof draft.body !== "string" || typeof draft.id !== "string" || !/^[a-zA-Z0-9-]+$/.test(draft.id) ||
        typeof draft.timestamp !== "string" || Number.isNaN(Date.parse(draft.timestamp))) {
      this.report(new Error("A saved draft is invalid. Its local storage value has been left untouched."));
      return null;
    }
    const cleaned = draft.body.replace(/<!-- uploading:[a-zA-Z0-9-]+ -->/g, "");
    if (cleaned !== draft.body) new Notice("An attachment upload was interrupted. Your text draft was restored; reattach the missing files.");
    return { body: cleaned, id: draft.id, timestamp: draft.timestamp, original: draft.original };
  }
  writeDraft(key: string, draft: Draft | null): void {
    try { this.app.saveLocalStorage(key, draft); }
    catch (error) { this.report(new Error(`Could not preserve the draft on this device: ${String(error)}`)); }
  }

  report(error: unknown): void {
    console.error("[karpathy]", error);
    new Notice(`Karpathy: ${error instanceof Error ? error.message : String(error)}`, 9000);
  }

  private unhide(): void {
    for (const document of this.documents()) {
      document.querySelectorAll(".karpathy-hidden-folder").forEach(element => element.classList.remove("karpathy-hidden-folder"));
    }
  }
  private documents(): Document[] {
    return [...new Set([document, ...this.app.workspace.getLeavesOfType("file-explorer").map(leaf => leaf.view.containerEl.ownerDocument)])];
  }
  applyFolderHiding(): void {
    this.folderObserver?.disconnect();
    this.unhide();
    if (!this.settings.hiddenFolders.length) return;
    const mark = () => {
      for (const doc of this.documents()) {
        doc.querySelectorAll<HTMLElement>(".nav-folder-title[data-path]").forEach(title => {
          const path = title.getAttribute("data-path") ?? "";
          const hidden = this.settings.hiddenFolders.some(folder => path === folder || path.startsWith(`${folder}/`));
          title.parentElement?.classList.toggle("karpathy-hidden-folder", hidden);
        });
      }
    };
    mark();
    this.folderObserver = new MutationObserver(() => {
      if (this.hideFrame !== undefined) return;
      this.hideFrame = window.requestAnimationFrame(() => { this.hideFrame = undefined; mark(); });
    });
    for (const doc of this.documents()) this.folderObserver.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-path"] });
    if (!this.hiddenStyle) {
      this.hiddenStyle = document.head.createEl("style", { text: ".karpathy-hidden-folder { display: none !important; }" });
    }
  }
}
