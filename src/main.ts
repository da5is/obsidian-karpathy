import { StorageHealth } from "./health";
import { FileSystemAdapter, getLinkpath, Notice, Platform, Plugin, TAbstractFile, TFile } from "obsidian";
import { baseFolder, Entry, entryPrefix } from "./model";
import { DEFAULT_SETTINGS, KarpathySettingsTab, parseSettings, Settings, themePrefixColor } from "./settings";
import { Store } from "./store";
import { WikilinkIndex } from "./links";
import { KarpathyView, VIEW_TYPE } from "./view";

export interface Draft { body: string; timestamp: string; id: string; original?: Entry }

export default class KarpathyPlugin extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  store!: Store;
  readonly links = new WikilinkIndex(this.app);
  private folderObservers: MutationObserver[] = [];
  private refreshTimer?: number;
  editing = 0;
  private settingsWrites: Promise<void> = Promise.resolve();
  private pendingSettings?: Settings;
  private draftOwners = new Map<string, { owner: object; focus: () => void }>();
  private pendingDrafts = new Map<string, Draft | null>();
  private draftTimer?: ReturnType<typeof setTimeout>;

  claimDraft(key: string, owner: object, focus: () => void): boolean {
    const current = this.draftOwners.get(key);
    if (current && current.owner !== owner) { current.focus(); return false; }
    this.draftOwners.set(key, { owner, focus });
    return true;
  }
  releaseDraft(key: string, owner: object): void {
    this.flushDrafts();
    if (this.draftOwners.get(key)?.owner === owner) this.draftOwners.delete(key);
  }
  updateSettings(change: (next: Settings) => void): Promise<void> {
    const work = this.settingsWrites.catch(() => {}).then(async () => {
      const next = structuredClone(this.settings);
      change(next);
      if (JSON.stringify(next) === JSON.stringify(this.settings)) return;
      const pendingBase = this.pendingSettings?.baseFolder;
      const persisted = pendingBase !== undefined && next.baseFolder === this.settings.baseFolder ? { ...next, baseFolder: pendingBase } : next;
      await this.saveData(persisted);
      if (this.pendingSettings) this.pendingSettings = persisted.baseFolder === next.baseFolder ? undefined : persisted;
      this.settings = next;
      this.changed();
    });
    this.settingsWrites = work;
    return work;
  }
  async onExternalSettingsChange(): Promise<void> {
    const work = this.settingsWrites.catch(() => {}).then(async () => {
      this.pendingSettings = parseSettings(await this.loadData());
      await this.adoptPendingSettings();
    });
    this.settingsWrites = work;
    await work;
  }
  applyPendingSettings(): Promise<void> {
    const work = this.settingsWrites.catch(() => {}).then(() => this.adoptPendingSettings());
    this.settingsWrites = work;
    return work;
  }
  private async adoptPendingSettings(): Promise<void> {
    const next = this.pendingSettings;
    if (!next) return;
    if (next.baseFolder !== this.settings.baseFolder && (this.views().some(view => view.hasDraft) || this.editing)) {
      new Notice("Synced folder change is waiting. Save your drafts and close entry editors, then run Apply synced settings.");
      return;
    }
    this.pendingSettings = undefined;
    const changedBase = next.baseFolder !== this.settings.baseFolder;
    this.settings = next;
    if (changedBase) {
      this.store.base = next.baseFolder; this.store.clear(); this.store.reindex();
      for (const view of this.views()) await view.reconfigure();
    }
    this.applySidebarHiding(); this.applyFolderHiding(); this.changed();
  }
  private sidebarDocuments = new Set<Document>();

  async onload(): Promise<void> {
    // Invalid persisted paths must not quietly redirect writes to another folder.
    this.settings = parseSettings(await this.loadData());
    this.store = new Store(this.app, this.settings.baseFolder);
    this.store.onProgress = (remaining, total) => { for (const view of this.views()) view.indexProgress(remaining, total); };
    this.store.onReconciled = () => this.changed();
    this.registerDomEvent(document, "visibilitychange", () => { if (document.hidden) this.flushDrafts(); });
    this.registerDomEvent(window, "pagehide", () => this.flushDrafts());
    this.register(() => this.flushDrafts());
    this.addCommand({ id: "apply-synced-settings", name: "Apply synced settings", callback: () => {
      void this.applyPendingSettings().catch(error => this.report(error));
    } });
    this.addCommand({ id: "storage-health", name: "Review storage health", callback: () => new StorageHealth(this.app, this.settings.baseFolder).open() });
    this.registerView(VIEW_TYPE, leaf => new KarpathyView(leaf, this));
    this.addSettingTab(new KarpathySettingsTab(this.app, this));
    this.addCommand({ id: "toggle-sidebars", name: "Toggle hidden sidebars", callback: () => {
      void this.setSidebarsHidden(!this.settings.hideSidebars).catch(error => this.report(error));
    } });
    this.registerEvent(this.app.workspace.on("layout-change", () => { this.applySidebarHiding(); this.applyFolderHiding(); }));
    this.register(() => this.clearSidebarHiding());
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
      this.store.reindex();
      this.changed();
    } });
    this.registerEvent(this.app.vault.on("create", file => this.fileChanged(file)));
    this.registerEvent(this.app.metadataCache.on("changed", file => this.links.changed(file)));
    this.registerEvent(this.app.vault.on("modify", file => this.fileChanged(file)));
    this.registerEvent(this.app.vault.on("delete", file => this.fileChanged(file)));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      this.store.invalidate(oldPath);
      this.fileChanged(file, oldPath);
    }));
    this.app.workspace.onLayoutReady(() => {
      this.applySidebarHiding();
      this.applyFolderHiding();
      if (this.settings.openOnStartup) void this.open().catch(error => this.report(error));
    });
    this.register(() => {
      window.clearTimeout(this.refreshTimer);
      this.folderObservers.forEach(observer => observer.disconnect());
      this.unhide();

      void this.store.close();
      this.links.clear();
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
    this.links.changed(file, oldPath);
    const base = this.settings.baseFolder;
    const relevant = (path: string) => !base || path === base || path.startsWith(`${base}/`) || base.startsWith(`${path}/`);
    if (!relevant(file.path) && (!oldPath || !relevant(oldPath))) return;
    this.store.invalidate(file.path);
    if (!(file instanceof TFile)) this.store.reindex();
    if (!(file instanceof TFile) || file.extension === "md" || oldPath?.endsWith(".md")) this.changed();
  }

  changed(): void {
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      for (const view of this.views()) void view.refresh(true).catch(error => this.report(error));
    }, 180);
  }

  async changeBase(value: string): Promise<void> {
    const folder = baseFolder(value);
    if (this.views().some(view => view.hasDraft) || this.editing) {
      throw new Error("Save or clear the current draft and close entry editors before changing the base folder.");
    }
    await this.updateSettings(next => {
      if (this.views().some(view => view.hasDraft) || this.editing) throw new Error("Save drafts before changing folders.");
      next.baseFolder = folder;
    });
    this.store.base = folder;
    this.store.clear();
    this.store.reindex();
    for (const view of this.views()) await view.reconfigure();
    new Notice(`Karpathy now reads and writes in ${folder || "the vault root"}. Existing files have not been moved.`);
  }

  rememberPrefix(body: string): Promise<void> {
    const prefix = entryPrefix(body)?.[1].toLowerCase();
    if (!prefix) return Promise.resolve();
    if (Object.prototype.hasOwnProperty.call(this.settings.prefixColors, prefix)) return Promise.resolve();
    return this.updateSettings(next => {
      if (!Object.prototype.hasOwnProperty.call(next.prefixColors, prefix)) next.prefixColors[prefix] = themePrefixColor(prefix);
    });
  }

  draftKey(entry?: Entry): string {
    return entry ? `karpathy:edit:${entry.path}:${entry.id}` : `karpathy:capture:${this.settings.baseFolder}`;
  }
  readDraft(key: string): Draft | null {
    const value: unknown = this.pendingDrafts.has(key) ? this.pendingDrafts.get(key) : this.app.loadLocalStorage(key);
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
    this.pendingDrafts.set(key, draft ? { ...draft } : null);
    if (!draft) { this.flushDrafts(); return; }
    if (!this.draftTimer) this.draftTimer = setTimeout(() => this.flushDrafts(), 250);
  }
  flushDrafts(): void {
    clearTimeout(this.draftTimer); this.draftTimer = undefined;
    for (const [key, draft] of this.pendingDrafts) {
      try { this.app.saveLocalStorage(key, draft); this.pendingDrafts.delete(key); }
      catch (error) { this.report(new Error("Could not preserve the draft on this device: " + String(error))); }
    }
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
  async setSidebarsHidden(hidden: boolean): Promise<void> {
    await this.updateSettings(next => { next.hideSidebars = hidden; });
    this.applySidebarHiding();
  }

  private clearSidebarHiding(): void {
    for (const doc of this.sidebarDocuments) {
      doc.body.classList.remove("karpathy-hide-sidebars");
      doc.querySelector(".karpathy-show-sidebars")?.remove();
    }
    this.sidebarDocuments.clear();
  }

  applySidebarHiding(): void {
    if (!this.settings.hideSidebars) { this.clearSidebarHiding(); return; }
    const documents = new Set<Document>([document]);
    this.app.workspace.iterateAllLeaves(leaf => { documents.add(leaf.view.containerEl.ownerDocument); });
    for (const doc of documents) {
      this.sidebarDocuments.add(doc);
      doc.body.classList.add("karpathy-hide-sidebars");

    }
  }
  private documents(): Document[] {
    return [...new Set([document, ...this.app.workspace.getLeavesOfType("file-explorer").map(leaf => leaf.view.containerEl.ownerDocument)])];
  }
  applyFolderHiding(): void {
    this.folderObservers.forEach(observer => observer.disconnect());
    this.folderObservers = [];
    this.unhide();
    if (!this.settings.hiddenFolders.length) return;
    for (const leaf of this.app.workspace.getLeavesOfType("file-explorer")) {
      const root = leaf.view.containerEl;
      const mark = () => root.querySelectorAll<HTMLElement>(".nav-folder-title[data-path]").forEach(title => {
        const path = title.getAttribute("data-path") ?? "";
        title.parentElement?.classList.toggle("karpathy-hidden-folder", this.settings.hiddenFolders.some(folder => path === folder || path.startsWith(folder + "/")));
      });
      mark();
      const observer = new root.ownerDocument.defaultView!.MutationObserver(mark);
      observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-path"] });
      this.folderObservers.push(observer);
    }
  }
}
