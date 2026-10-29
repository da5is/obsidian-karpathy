import { Component, ItemView, MarkdownRenderer, Menu, Modal, Notice, Scope, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import { CaptureEditor, editorToolbar } from "./editor";
import { displayDate } from "./dates";
import type KarpathyPlugin from "./main";
import type { Draft } from "./main";
import { Cursor, dailyPath, Entry, entryPrefix, parseEntries, taskRanges, toggleTask, uniqueId } from "./model";

export const VIEW_TYPE = "karpathy-stream";
const WINDOW_SIZE = 120;
interface Row { element: HTMLElement; component: Component; signature: string }
interface Anchor { id: string; top: number }
function entryKey(entry: Entry): string { return `${entry.path}#${entry.id}`; }

function age(timestamp: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(timestamp)) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return displayDate(new Date(timestamp), { compact: true });
}

function rescueHistory(entry: Entry): string {
  const count = entry.rescues ?? 0;
  return count ? `↑ rescued ${age(entry.timestamp)} · written ${age(entry.created ?? entry.timestamp)} · rescued ${count} ${count === 1 ? "time" : "times"}` : `written ${age(entry.timestamp)}`;
}

export class KarpathyView extends ItemView {
  private editor?: CaptureEditor;
  private draft: Draft | null = null;
  private draftKey = "";
  private saveButton!: HTMLButtonElement;
  private attachmentButtons: HTMLButtonElement[] = [];
  private captureStatus!: HTMLElement;
  private subtitle!: HTMLElement;
  private heading!: HTMLElement;
  private scroller!: HTMLElement;
  private list!: HTMLElement;
  private older!: HTMLButtonElement;
  private newer!: HTMLButtonElement;
  private progress!: HTMLElement;
  private search!: HTMLInputElement;
  private rows = new Map<string, Row>();
  private items: Entry[] = [];
  private before: Cursor = { file: 0, offset: 0 };
  private after: Cursor = { file: 0, offset: 0 };
  private startReached = true;
  private endReached = false;
  private loading = false;
  private saving = false;
  private generation = 0;
  private closed = false;
  private query = "";
  private searchTimer?: number;
  private previousScroll = 0;

  constructor(leaf: WorkspaceLeaf, private plugin: KarpathyPlugin) {
    super(leaf);
    this.scope = new Scope(this.app.scope);
  }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Karpathy"; }
  getIcon(): string { return "notebook-pen"; }
  get hasDraft(): boolean { return this.saving || !!this.editor?.pending || !!this.editor?.body.trim(); }
  focusComposer(): void { this.editor?.focus(); }
  attachFiles(photosOnly = false): void {
    if (this.saving || this.closed) return;
    const picker = document.createElement("input");
    picker.type = "file";
    picker.multiple = true;
    if (photosOnly) picker.accept = "image/*";
    picker.hidden = true;
    this.contentEl.appendChild(picker);
    picker.addEventListener("change", () => {
      if (!this.closed) this.editor?.attach(Array.from(picker.files ?? []));
      picker.remove();
    }, { once: true });
    picker.addEventListener("cancel", () => picker.remove(), { once: true });
    picker.click();
  }

  async onOpen(): Promise<void> {
    this.closed = false;
    const root = this.contentEl;
    root.empty();
    root.addClass("karpathy-view");
    this.scroller = root.createDiv({ cls: "karpathy-scroller", attr: { tabindex: "0", "aria-label": "Notes stream" } });
    const header = this.scroller.createDiv({ cls: "karpathy-header karpathy-column" });
    const titles = header.createDiv({ cls: "karpathy-header-titles" });
    this.heading = titles.createEl("h1");
    this.updateDateHeading();
    this.subtitle = titles.createDiv({ cls: "karpathy-subtitle" });
    const searchToggle = header.createEl("button", { cls: "karpathy-search-toggle", attr: { type: "button", title: "Search notes", "aria-label": "Search notes", "aria-expanded": "false" } });
    setIcon(searchToggle, "search");
    const capture = this.scroller.createDiv({ cls: "karpathy-capture karpathy-column" });
    this.captureStatus = capture.createDiv({ cls: "karpathy-capture-status", attr: { role: "status", "aria-live": "polite" } });
    const captureActions = capture.createDiv({ cls: "karpathy-capture-actions" });
    this.attachmentButtons = [];
    for (const [label, icon, photosOnly] of [["Attach a file", "paperclip", false], ["Attach a photo", "image", true]] as const) {
      const button = captureActions.createEl("button", { cls: "karpathy-attach", attr: { type: "button", title: label, "aria-label": label } });
      setIcon(button, icon);
      button.addEventListener("mousedown", event => event.preventDefault());
      button.addEventListener("click", () => this.attachFiles(photosOnly));
      this.attachmentButtons.push(button);
    }
    this.saveButton = captureActions.createEl("button", { text: "Save", cls: "mod-cta karpathy-save", attr: { type: "button" } });
    this.saveButton.addEventListener("mousedown", event => event.preventDefault());
    this.saveButton.addEventListener("click", () => { this.editor?.focus(); void this.save(); });
    this.createEditor(capture);
    const searchBar = header.createDiv({ cls: "karpathy-search" });
    searchBar.hidden = true;
    this.search = searchBar.createEl("input", { type: "search", attr: { placeholder: "Search the stream...", "aria-label": "Search all entries" } });
    const closeSearch = () => {
      searchBar.hidden = true;
      searchToggle.setAttribute("aria-expanded", "false");
      window.clearTimeout(this.searchTimer);
      this.search.value = "";
      this.query = "";
      void this.refresh(false).catch(error => this.plugin.report(error));
      searchToggle.focus();
    };
    searchToggle.addEventListener("click", () => {
      if (!searchBar.hidden) { closeSearch(); return; }
      searchBar.hidden = false;
      searchToggle.setAttribute("aria-expanded", "true");
      this.search.focus();
    });
    this.search.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); closeSearch(); }
    });
    this.search.addEventListener("input", () => {
      window.clearTimeout(this.searchTimer);
      // Cancel an in-flight search immediately, rather than after the debounce.
      this.generation++;
      this.searchTimer = window.setTimeout(() => {
        this.query = this.search.value.trim();
        void this.refresh(false).catch(error => this.plugin.report(error));
      }, 60);
    });
    const stream = this.scroller.createDiv({ cls: "karpathy-column karpathy-stream" });
    this.newer = stream.createEl("button", { text: "Load newer entries", cls: "karpathy-page-button" });
    this.newer.addEventListener("click", () => { void this.loadPage(-1).catch(error => this.plugin.report(error)); });
    this.list = stream.createDiv({ cls: "karpathy-entries" });
    this.progress = stream.createDiv({ cls: "karpathy-progress", attr: { role: "status", "aria-live": "polite" } });
    this.older = stream.createEl("button", { text: "Load older entries", cls: "karpathy-page-button" });
    this.older.addEventListener("click", () => { void this.loadPage(1).catch(error => this.plugin.report(error)); });
    this.scroller.addEventListener("scroll", () => {
      const current = this.scroller.scrollTop;
      const direction = current - this.previousScroll;
      this.previousScroll = current;
      if (this.loading) return;
      if (direction > 0 && current + this.scroller.clientHeight > this.scroller.scrollHeight - 400 && !this.endReached) {
        void this.loadPage(1).catch(error => this.plugin.report(error));
      } else if (direction < 0 && current < 180 && !this.startReached) {
        void this.loadPage(-1).catch(error => this.plugin.report(error));
      }
    });
    this.register(() => window.clearTimeout(this.searchTimer));
    const clock = window.setInterval(() => {
      this.updateDateHeading();
      for (const entry of this.items) {
        const label = this.rows.get(entryKey(entry))?.element.querySelector(".karpathy-rescue-meta");
        if (label) label.textContent = rescueHistory(entry);
      }
    }, 60000);
    this.register(() => window.clearInterval(clock));
    await this.refresh(false);
    this.editor?.focus();
  }

  private createEditor(capture: HTMLElement): void {
    const base = this.plugin.settings.baseFolder;
    this.draftKey = this.plugin.draftKey();
    this.draft = this.plugin.readDraft(this.draftKey);
    const host = capture.createDiv({ cls: "karpathy-editor" });
    this.editor = new CaptureEditor(host, {
      body: this.draft?.body ?? "",
      colors: this.plugin.settings.prefixColors,
      tripleEnter: true,
      completeLink: this.plugin.links.source(() => dailyPath(base, new Date(this.draft?.timestamp ?? Date.now()))),
      resolveImage: link => this.plugin.imageSource(link, dailyPath(base, new Date(this.draft?.timestamp ?? Date.now()))),
      change: body => {
        if (body.trim()) {
          this.draft ??= { id: uniqueId(), timestamp: new Date().toISOString(), body };
          this.draft.body = body;
        } else this.draft = null;
        this.plugin.writeDraft(this.draftKey, this.draft);
        this.updateCaptureStatus();
      },
      save: () => { void this.save(); },
      upload: files => this.upload(files, new Date(this.draft?.timestamp ?? Date.now()), base),
      error: error => this.plugin.report(error),
      busy: () => this.updateCaptureStatus(),
      scope: this.scope ?? undefined
    });
    this.updateCaptureStatus();
  }

  private async upload(files: File[], date: Date, base: string): Promise<string[]> {
    return Promise.all(files.map(file => this.plugin.store.attachment(file, date, base)));
  }

  private updateCaptureStatus(): void {
    const uploading = !!this.editor?.pending;
    this.saveButton.disabled = this.saving || uploading || !this.editor?.body.trim();
    for (const button of this.attachmentButtons) button.disabled = this.saving;
    this.captureStatus.setText(this.saving ? "Saving..." : uploading ? "Saving attachments..." : "");
    this.captureStatus.hidden = !this.saving && !uploading;
  }

  private async save(): Promise<void> {
    if (!this.editor || this.saving) return;
    if (this.editor.pending) { new Notice("Wait for attachments to finish before saving."); return; }
    if (!this.draft || !this.editor.body.trim()) return;
    this.saving = true;
    this.editor.lock(true);
    this.updateCaptureStatus();
    try {
      await this.plugin.store.capture(this.editor.body, new Date(this.draft.timestamp), this.draft.id);
      await this.plugin.rememberPrefix(this.editor.body).catch(error => this.plugin.report(error));
      this.draft = null;
      this.plugin.writeDraft(this.draftKey, null);
      this.editor.setBody("");
      this.query = "";
      this.search.value = "";
      if (!this.closed) {
        void this.refresh(false).catch(error => this.plugin.report(error));
        this.editor.focus();
      }
    } catch (error) { this.plugin.report(error); }
    finally {
      this.saving = false;
      this.editor.lock(false);
      this.updateCaptureStatus();
      if (!this.closed) this.editor.focus();
    }
  }

  async reconfigure(): Promise<void> {
    if (this.editor) await this.editor.destroy();
    const capture = this.contentEl.querySelector<HTMLElement>(".karpathy-capture");
    if (!capture) return;
    capture.querySelector(".karpathy-editor")?.remove();
    capture.querySelector(".karpathy-toolbar")?.remove();
    this.createEditor(capture);
    await this.refresh(false);
  }

  private anchor(): Anchor | null {
    const top = this.scroller.getBoundingClientRect().top;
    for (const entry of this.items) {
      const element = this.rows.get(entryKey(entry))?.element;
      if (element && element.getBoundingClientRect().bottom > top) return { id: entryKey(entry), top: element.getBoundingClientRect().top - top };
    }
    return null;
  }
  private restore(anchor: Anchor | null): void {
    const element = anchor && this.rows.get(anchor.id)?.element;
    if (element && anchor) this.scroller.scrollTop += element.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top - anchor.top;
    this.previousScroll = this.scroller.scrollTop;
  }

  async refresh(preserve: boolean): Promise<void> {
    if (this.closed || !this.list) return;
    this.editor?.updateColors(this.plugin.settings.prefixColors);
    const anchor = preserve ? this.anchor() : null;
    const first = preserve && this.items.length && this.scroller.scrollTop > 30 ? this.items[0] : null;
    const limit = preserve ? Math.max(30, this.items.length) : 30;
    const generation = ++this.generation;
    this.loading = true;
    this.updateDateHeading();
    this.subtitle.setText("Counting notes…");
    const cursor = first ? await this.plugin.store.cursorFor(first) : { file: 0, offset: 0 };
    if (generation !== this.generation || this.closed) return;
    this.before = { ...cursor };
    this.after = { ...cursor };
    this.startReached = cursor.file === 0 && cursor.offset === 0;
    this.endReached = false;
    this.items = [];
    if (!preserve) this.scroller.scrollTop = 0;
    await this.read(1, generation, limit, anchor);
    if (generation === this.generation && !this.closed) {
      void this.plugin.store.countEntries(() => generation === this.generation && !this.closed).then(count => {
        if (count !== null && generation === this.generation && !this.closed)
          this.subtitle.setText(`${count.toLocaleString()} ${count === 1 ? "note" : "notes"} captured`);
      }).catch(error => this.plugin.report(error));
    }
  }

  private async loadPage(direction: 1 | -1): Promise<void> {
    if (this.closed || this.loading || (direction === 1 ? this.endReached : this.startReached)) return;
    this.loading = true;
    await this.read(direction, this.generation, 30, this.anchor());
  }

  private async read(direction: 1 | -1, generation: number, limit: number, anchor: Anchor | null): Promise<void> {
    const previous = {
      items: [...this.items], before: { ...this.before }, after: { ...this.after },
      startReached: this.startReached, endReached: this.endReached
    };
    this.controls();
    const valid = () => generation === this.generation && !this.closed;
    try {
      let cursor = direction === 1 ? this.after : this.before;
      let exhausted = false;
      let found: Entry[] = [];
      do {
        this.progress.setText(this.query ? "Searching daily notes..." : "Loading...");
        const page = await this.plugin.store.page(cursor, direction, this.query, limit - found.length, valid);
        if (!valid()) return;
        found = direction === 1 ? [...found, ...page.entries] : [...page.entries, ...found];
        exhausted = page.exhausted;
        cursor = direction === 1 ? page.end : page.start;
        if (this.query && found.length && found.length < limit && !exhausted) {
          this.items = direction === 1 ? [...previous.items, ...found] : [...found, ...previous.items];
          await this.renderRows(valid);
          if (!valid()) return;
          this.restore(anchor);
          anchor = this.anchor();
        }
        if (!exhausted && found.length < limit) await new Promise(resolve => window.setTimeout(resolve, 0));
      } while (!exhausted && found.length < limit && valid());
      if (direction === 1) { this.after = cursor; this.endReached = exhausted; this.items = [...previous.items, ...found]; }
      else { this.before = cursor; this.startReached = exhausted; this.items = [...found, ...previous.items]; }
      if (this.items.length > WINDOW_SIZE) {
        this.items = direction === 1 ? this.items.slice(-WINDOW_SIZE) : this.items.slice(0, WINDOW_SIZE);
        if (direction === 1) {
          this.before = await this.plugin.store.cursorFor(this.items[0]);
          this.startReached = this.before.file === 0 && this.before.offset === 0;
        } else {
          const last = await this.plugin.store.cursorFor(this.items[this.items.length - 1]);
          this.after = { file: last.file, offset: last.offset + 1 };
          this.endReached = false;
        }
      }
      if (!valid()) return;
      await this.renderRows(valid);
      if (!valid()) return;
      this.restore(anchor);
      this.progress.setText(this.endReached ? this.items.length ? "You're all caught up." :
        this.query ? "No matching entries." : "Your stream starts here. Capture a thought above." : "");
    } catch (error) {
      if (valid()) {
        this.items = previous.items;
        this.before = previous.before;
        this.after = previous.after;
        this.startReached = previous.startReached;
        this.endReached = previous.endReached;
        this.progress.setText("Could not load entries. Use Load older entries or Refresh stream to retry.");
      }
      throw error;
    } finally {
      if (valid()) { this.loading = false; this.controls(); }
    }
  }

  private updateDateHeading(): void {
    this.heading.setText(displayDate(new Date(), { heading: true }));
  }

  private controls(): void {
    this.newer.hidden = this.startReached;
    this.older.hidden = this.endReached;
    this.newer.disabled = this.loading;
    this.older.disabled = this.loading;
  }

  private async renderRows(valid: () => boolean): Promise<void> {
    const keep = new Set(this.items.map(entryKey));
    for (const [id, row] of this.rows) {
      if (!keep.has(id)) { row.element.remove(); this.removeChild(row.component); this.rows.delete(id); }
    }
    let position = 0;
    for (const entry of this.items) {
      if (!valid()) return;
      const key = entryKey(entry);
      const signature = `${entry.path}\n${entry.timestamp}\n${entry.body}\n${JSON.stringify(this.plugin.settings.prefixColors)}`;
      let row = this.rows.get(key);
      if (row && row.signature !== signature) {
        row.element.remove();
        this.removeChild(row.component);
        this.rows.delete(key);
        row = undefined;
      }
      if (!row) {
        const component = this.addChild(new Component());
        const element = document.createElement("article");
        element.className = "karpathy-entry";
        element.dataset.entryId = entry.id;
        const surface = element.createDiv({ cls: "karpathy-entry-surface" });
        const meta = surface.createDiv({ cls: "karpathy-entry-meta" });
        const date = new Date(entry.timestamp);
        meta.createDiv({ text: rescueHistory(entry), cls: "karpathy-rescue-meta", attr: { title: `Written: ${displayDate(new Date(entry.created ?? entry.timestamp), { time: true })}${entry.rescues ? `; last rescued: ${displayDate(date, { time: true })}` : ""}` } });
        const actions = meta.createDiv({ cls: "karpathy-entry-actions" });
        const rescue = actions.createEl("button", { text: "↑ Rescue", attr: { "aria-label": "Rescue entry to the top", title: "Rescue to the top" } });
        rescue.empty();
        setIcon(rescue.createSpan({ cls: "karpathy-action-icon" }), "arrow-up");
        rescue.createSpan({ cls: "karpathy-action-label", text: "Rescue" });
        const performRescue = async () => {
          if (rescue.disabled) return;
          rescue.disabled = true;
          try {
            await this.plugin.store.rescue(entry);
            this.query = "";
            this.search.value = "";
            await this.refresh(false);
          } catch (error) { this.plugin.report(error); }
          finally { rescue.disabled = false; }
        };
        rescue.addEventListener("click", () => { void performRescue(); });
        const edit = actions.createEl("button", { text: "Edit", attr: { "aria-label": "Edit entry" } });
        edit.empty();
        edit.title = "Edit entry";
        setIcon(edit.createSpan({ cls: "karpathy-action-icon" }), "pencil");
        edit.createSpan({ cls: "karpathy-action-label", text: "Edit" });
        edit.addEventListener("click", () => new EntryEditor(this.plugin, entry).open());
        const source = actions.createEl("button", { text: "⋯", attr: { "aria-label": "More entry actions", title: "More actions" } });
        source.addEventListener("click", event => {
          const menu = new Menu();
          menu.addItem(item => item.setTitle("Open daily Markdown note").setIcon("file-text").onClick(() => {
          void (async () => {
            const file = this.app.vault.getAbstractFileByPath(entry.path);
            if (!(file instanceof TFile)) throw new Error("The daily note no longer exists.");
            const leaf = this.app.workspace.getLeaf("tab");
            const text = await this.app.vault.read(file);
            const current = parseEntries(text, file.path).find(item => item.id === entry.id);
            if (!current) throw new Error("This entry no longer exists in the daily note.");
            await leaf.openFile(file, { eState: { line: text.slice(0, current.start).split("\n").length - 1 } });
          })().catch(error => this.plugin.report(error));
          }));
          menu.addSeparator();
          menu.addItem(item => item.setTitle("Delete entry").setIcon("trash-2").setWarning(true).onClick(() => {
            new ConfirmDelete(this.plugin, entry, () => {
              void this.refresh(true).catch(error => this.plugin.report(error));
            }).open();
          }));
          menu.showAtMouseEvent(event);
        });
        const content = surface.createDiv({ cls: "karpathy-entry-content markdown-rendered" });
        try { await MarkdownRenderer.render(this.app, entry.body, content, entry.path, component); }
        catch (error) { this.removeChild(component); throw error; }
        if (!valid()) { this.removeChild(component); return; }
        content.addEventListener("click", event => {
          if (!(event.target instanceof Element)) return;
          const link = event.target.closest<HTMLAnchorElement>("a.internal-link");
          if (!link) return;
          const href = link.getAttribute("data-href") ?? link.getAttribute("href");
          if (!href) return;
          event.preventDefault();
          event.stopPropagation();
          void this.plugin.openStreamLink(href, entry.path).catch(error => this.plugin.report(error));
        }, { capture: true });
        for (const image of content.querySelectorAll("img")) { image.loading = "lazy"; image.decoding = "async"; }
        this.colorPrefix(content);
        const checkboxes = Array.from(content.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
        const supportedTasks = taskRanges(entry.body).length === checkboxes.length;
        checkboxes.forEach((checkbox, index) => {
          checkbox.disabled = !supportedTasks;
          if (!supportedTasks) checkbox.title = "Use Edit or Source to update this checklist syntax.";
          checkbox.addEventListener("click", event => {
            event.stopPropagation();
            checkboxes.forEach(box => { box.disabled = true; });
            const body = toggleTask(entry.body, index, checkbox.checked);
            if (body === entry.body) {
              checkbox.checked = !checkbox.checked;
              this.plugin.report(new Error("This checklist syntax cannot be toggled here. Use Edit or open the source note."));
              checkboxes.forEach(box => { box.disabled = false; });
              return;
            }
            void this.plugin.store.update(entry, body).then(() => this.plugin.changed()).catch(error => {
              checkbox.checked = !checkbox.checked;
              checkboxes.forEach(box => { box.disabled = false; });
              this.plugin.report(error);
              this.plugin.changed();
            });
          });
        });
        row = { component, element, signature };
        this.rows.set(key, row);
      }
      const target = this.list.children.item(position++);
      if (target !== row.element) this.list.insertBefore(row.element, target);
    }
  }

  private colorPrefix(content: HTMLElement): void {
    const node = content.querySelector("p")?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    const match = entryPrefix(node.textContent ?? "");
    if (!match) return;
    const color = this.plugin.settings.prefixColors[match[1].toLowerCase()];
    if (!color) return;
    const span = document.createElement("strong");
    span.className = "karpathy-prefix";
    span.style.color = color;
    span.textContent = match[0];
    node.textContent = node.textContent?.slice(match[0].length) ?? "";
    node.parentNode?.insertBefore(span, node);
  }

  async onClose(): Promise<void> {
    this.closed = true;
    this.generation++;
    window.clearTimeout(this.searchTimer);
    await this.editor?.destroy();
    for (const row of this.rows.values()) this.removeChild(row.component);
    this.rows.clear();
  }
}

class EntryEditor extends Modal {
  private editor?: CaptureEditor;
  private draft: Draft;
  private key: string;
  private saving = false;
  private button!: HTMLButtonElement;
  private status!: HTMLElement;
  private closed = false;
  private base: string;
  constructor(private plugin: KarpathyPlugin, private entry: Entry) {
    super(plugin.app);
    this.base = plugin.settings.baseFolder;
    this.key = plugin.draftKey(entry);
    this.draft = plugin.readDraft(this.key) ?? { body: entry.body, timestamp: entry.timestamp, id: entry.id, original: entry };
  }
  onOpen(): void {
    this.closed = false;
    this.plugin.editing++;
    this.modalEl.addClass("karpathy-edit-modal");
    this.titleEl.setText("Edit entry");
    const host = this.contentEl.createDiv({ cls: "karpathy-editor" });
    this.status = this.contentEl.createDiv({ cls: "karpathy-capture-status", attr: { role: "status" } });
    this.button = this.contentEl.createEl("button", { text: "Save changes", cls: "mod-cta" });
    this.button.addEventListener("click", () => { void this.save(); });
    this.editor = new CaptureEditor(host, {
      body: this.draft.body, colors: this.plugin.settings.prefixColors, tripleEnter: false,
      completeLink: this.plugin.links.source(() => this.entry.path),
      resolveImage: link => this.plugin.imageSource(link, this.entry.path),
      change: body => {
        this.draft.body = body;
        this.plugin.writeDraft(this.key, this.draft);
      },
      save: () => { void this.save(); },
      upload: files => Promise.all(files.map(file => this.plugin.store.attachment(file, new Date(this.entry.timestamp), this.base))),
      error: error => this.plugin.report(error),
      scope: this.scope,
      busy: busy => {
        this.button.disabled = busy || this.saving;
        this.status.setText(busy ? "Saving attachments..." : "Ctrl/Cmd+Enter to save. Closing keeps your draft.");
      }
    });
    editorToolbar(this.contentEl, this.editor);
    const discard = this.contentEl.createEl("button", { text: "Discard local draft", cls: "karpathy-discard" });
    discard.addEventListener("click", () => {
      if (this.saving || this.editor?.pending) { new Notice("Wait for saving to finish."); return; }
      new ConfirmDiscard(this.plugin, () => {
        void (async () => {
          const file = this.app.vault.getAbstractFileByPath(this.entry.path);
          if (!(file instanceof TFile)) throw new Error("The daily note no longer exists.");
          const current = (await this.plugin.store.entries(file)).find(entry => entry.id === this.entry.id);
          if (!current) throw new Error("This entry no longer exists.");
          this.entry = current;
          this.draft = { body: current.body, timestamp: current.timestamp, id: current.id, original: current };
          this.plugin.writeDraft(this.key, null);
          this.editor?.setBody(current.body);
          this.status.setText("Latest saved version loaded.");
        })().catch(error => this.plugin.report(error));
      }).open();
    });
    this.status.setText("Ctrl/Cmd+Enter to save. Closing keeps your draft.");
    this.editor.focus();
  }
  private async save(): Promise<void> {
    if (!this.editor || this.saving) return;
    if (this.editor.pending) { new Notice("Wait for attachments to finish."); return; }
    if (!this.editor.body.trim()) { new Notice("An entry cannot be empty."); return; }
    this.saving = true;
    this.button.disabled = true;
    this.editor.lock(true);
    try {
      await this.plugin.store.update(this.draft.original ?? this.entry, this.editor.body);
      await this.plugin.rememberPrefix(this.editor.body).catch(error => this.plugin.report(error));
      this.plugin.writeDraft(this.key, null);
      this.plugin.changed();
      this.close();
    } catch (error) { this.plugin.report(error); }
    finally {
      this.saving = false;
      this.button.disabled = false;
      this.editor.lock(false);
    }
  }
  onClose(): void {
    if (this.closed) return;
    this.closed = true;
    void (this.editor?.destroy() ?? Promise.resolve()).then(() => { this.plugin.editing--; }).catch(error => this.plugin.report(error));
  }
}

class ConfirmDelete extends Modal {
  constructor(private plugin: KarpathyPlugin, private entry: Entry, private deleted: () => void) { super(plugin.app); }
  onOpen(): void {
    this.modalEl.addClass("karpathy-delete-modal");
    this.titleEl.setText("Delete entry?");
    this.contentEl.createEl("p", { text: "This removes the entry from its daily Markdown note. Other entries and attachments will be kept." });
    this.contentEl.createEl("blockquote", {
      cls: "karpathy-delete-preview",
      text: this.entry.body.length > 280 ? `${this.entry.body.slice(0, 280)}…` : this.entry.body
    });
    const status = this.contentEl.createDiv({ attr: { role: "alert" } });
    const actions = this.contentEl.createDiv({ cls: "modal-button-container" });
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.close());
    const remove = actions.createEl("button", { text: "Delete entry", cls: "mod-warning" });
    let saving = false;
    remove.addEventListener("click", () => {
      if (saving) return;
      saving = true;
      remove.disabled = true;
      status.setText("");
      void this.plugin.store.remove(this.entry).then(() => {
        this.close();
        this.plugin.changed();
        this.deleted();
      }).catch(error => {
        status.setText("Could not delete the entry. It may have changed; reopen it from the stream and try again.");
        this.plugin.report(error);
        saving = false;
        remove.disabled = false;
      });
    });
    cancel.focus();
  }
}

class ConfirmDiscard extends Modal {
  constructor(plugin: KarpathyPlugin, private confirm: () => void) { super(plugin.app); }
  onOpen(): void {
    this.titleEl.setText("Discard local changes?");
    this.contentEl.createEl("p", { text: "The unsaved edit will be replaced with the latest saved entry. The saved note will not be deleted." });
    const cancel = this.contentEl.createEl("button", { text: "Keep draft" });
    cancel.addEventListener("click", () => this.close());
    const discard = this.contentEl.createEl("button", { text: "Discard draft", cls: "mod-warning" });
    discard.addEventListener("click", () => { this.confirm(); this.close(); });
    cancel.focus();
  }
}
