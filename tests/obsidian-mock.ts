import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", { pretendToBeVisual: true, url: "https://test.invalid" });
for (const key of ["window", "document", "Node", "HTMLElement", "Element", "MutationObserver", "DOMRect", "Range", "KeyboardEvent", "Event", "MouseEvent", "Window"]) {
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
}
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
dom.window.Range.prototype.getClientRects = () => [];
dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();

function create(parent: HTMLElement, tag: string, options: Record<string, unknown> | string = {}) {
  const element = parent.ownerDocument.createElement(tag);
  if (typeof options === "string") element.className = options;
  else {
    if (options.cls) element.className = String(options.cls);
    if (options.text) element.textContent = String(options.text);
    if (options.type) element.setAttribute("type", String(options.type));
    for (const [key, value] of Object.entries(options.attr ?? {})) element.setAttribute(key, String(value));
  }
  parent.appendChild(element);
  return element;
}
Object.assign(dom.window.HTMLElement.prototype, {
  createEl(tag: string, options: Record<string, unknown>) { return create(this, tag, options); },
  createDiv(options: Record<string, unknown>) { return create(this, "div", options); },
  createSpan(options: Record<string, unknown>) { return create(this, "span", options); },
  empty() { this.replaceChildren(); },
  addClass(...names: string[]) { this.classList.add(...names); },
  setText(text: string) { this.textContent = text; }
});

export class TAbstractFile { path = ""; name = ""; parent = null; }
export class TFile extends TAbstractFile { extension = "md"; basename = ""; stat = { mtime: 1, ctime: 1, size: 0 }; }
export class TFolder extends TAbstractFile { children: TAbstractFile[] = []; }

export const Platform = { isDesktopApp: true };
export class FileSystemAdapter {
  getFullPath(path: string) { return `C:\\vault\\${path.replace(/\//g, "\\")}`; }
}
export function getLinkpath(linktext: string) { return linktext.split("#")[0]; }
export function parseFrontMatterAliases(frontmatter?: Record<string, unknown>) {
  const aliases = frontmatter?.aliases;
  return typeof aliases === "string" ? [aliases] : Array.isArray(aliases) ? aliases.filter((alias): alias is string => typeof alias === "string") : null;
}

export class Scope {
  handlers: { modifiers: string[]; key: string; callback: (event: KeyboardEvent) => unknown }[] = [];
  constructor(private parent?: Scope) {}
  register(modifiers: string[], key: string, callback: (event: KeyboardEvent) => unknown) {
    const handler = { modifiers, key, callback };
    this.handlers.push(handler);
    return handler;
  }
  unregister(handler: typeof this.handlers[number]) { this.handlers = this.handlers.filter(item => item !== handler); }
  handle(event: KeyboardEvent): boolean {
    for (const handler of this.handlers) {
      if (handler.key === event.key && handler.modifiers.includes("Ctrl") === event.ctrlKey &&
          handler.modifiers.includes("Meta") === event.metaKey && !event.shiftKey && !event.altKey) {
        if (handler.callback(event) === false) return false;
      }
    }
    return this.parent?.handle(event) ?? true;
  }
}

export class MemoryVault {
  adapter = new FileSystemAdapter();
  files = new Map<string, TAbstractFile>();
  texts = new Map<string, string>();
  binaries = new Map<string, ArrayBuffer>();
  reads = 0;
  clock = 1;
  locks = new Map<string, Promise<unknown>>();
  failWrites = false;
  listings = 0;
  getFiles() { this.listings++; return [...this.files.values()].filter((file): file is TFile => file instanceof TFile); }
  getMarkdownFiles() { return [...this.files.values()].filter((file): file is TFile => file instanceof TFile && file.extension === "md"); }
  getAbstractFileByPath(path: string) { return this.files.get(path) ?? null; }
  private linkToParent(file: TAbstractFile) {
    const parent = this.files.get(file.path.slice(0, file.path.lastIndexOf("/")));
    if (parent instanceof TFolder) parent.children.push(file);
  }
  async createFolder(path: string) {
    if (this.files.has(path)) throw new Error("Already exists");
    const folder = Object.assign(new TFolder(), { path, name: path.split("/").pop() });
    this.files.set(path, folder);
    this.linkToParent(folder);
    return folder;
  }
  async create(path: string, text: string) {
    if (this.failWrites) throw new Error("Disk full");
    if (this.files.has(path)) throw new Error("Already exists");
    const file = Object.assign(new TFile(), { path, name: path.split("/").pop(), stat: { mtime: ++this.clock, ctime: this.clock, size: text.length } });
    file.extension = file.name.split(".").pop() ?? "";
    file.basename = file.name.slice(0, -(file.extension.length + 1));
    this.files.set(path, file);
    this.linkToParent(file);
    this.texts.set(path, text);
    return file;
  }
  async read(file: TFile) { this.reads++; return this.texts.get(file.path) ?? ""; }
  async process(file: TFile, work: (text: string) => string) {
    const old = this.locks.get(file.path) ?? Promise.resolve();
    const next = old.catch(() => undefined).then(async () => {
      if (this.failWrites) throw new Error("Disk full");
      const text = work(this.texts.get(file.path) ?? "");
      this.texts.set(file.path, text);
      file.stat = { ...file.stat, mtime: ++this.clock, size: text.length };
      return text;
    });
    this.locks.set(file.path, next);
    return next;
  }
  async createBinary(path: string, data: ArrayBuffer) {
    const file = await this.create(path, "");
    file.extension = path.split(".").pop() ?? "";
    this.binaries.set(path, data);
    return file;
  }
}

export class App {
  scope = new Scope();
  vault = new MemoryVault();
  local = new Map<string, unknown>();
  fileCaches = new Map<string, { frontmatter?: Record<string, unknown> }>();
  cacheReads = 0;
  linkRequests: { path: string; source: string }[] = [];
  workspace = {
    opened: [] as { linktext: string; sourcePath: string; newLeaf: string }[],
    openLinkText: async (linktext: string, sourcePath: string, newLeaf: string) => {
      this.workspace.opened.push({ linktext, sourcePath, newLeaf });
    },
    getLeavesOfType: () => [],
    iterateAllLeaves: (_callback: (leaf: any) => void) => {},
    onLayoutReady: (callback: () => void) => callback(),
    getLeaf: () => { throw new Error("Not implemented by test workspace"); }
  };
  metadataCache = {
    getFileCache: (file: TFile) => { this.cacheReads++; return this.fileCaches.get(file.path) ?? null; },
    fileToLinktext: (file: TFile, source: string, omitMdExtension: boolean) => {
      this.linkRequests.push({ path: file.path, source });
      const unique = this.vault.getFiles().filter(candidate => candidate.name === file.name).length === 1;
      const link = unique ? file.name : file.path;
      return file.extension === "md" && omitMdExtension ? link.slice(0, -3) : link;
    },
    getFirstLinkpathDest: (path: string, source: string) => {
      return this.vault.getAbstractFileByPath(path) ??
        this.vault.getAbstractFileByPath(`${source.slice(0, source.lastIndexOf("/") + 1)}${path}`);
    }
  };
  loadLocalStorage(key: string) { return this.local.get(key) ?? null; }
  saveLocalStorage(key: string, value: unknown) { this.local.set(key, structuredClone(value)); }
}
export class Component {
  children = new Set<Component>();
  cleanup: (() => void)[] = [];
  addChild<T extends Component>(component: T) { this.children.add(component); return component; }
  removeChild(component: Component) { component.unload(); this.children.delete(component); }
  register(fn: () => void) { this.cleanup.push(fn); }
  unload() { this.children.forEach(child => child.unload()); this.children.clear(); this.cleanup.splice(0).forEach(fn => fn()); }
}
export class ItemView extends Component {
  app: App;
  contentEl = document.createElement("div");
  containerEl = this.contentEl;
  constructor(public leaf: { app: App }) { super(); this.app = leaf.app; document.body.appendChild(this.contentEl); }
}
export class Plugin extends Component {
  constructor(public app: App, public manifest: unknown) { super(); }
}
export class Modal extends Component {
  scope: Scope;
  modalEl = document.createElement("div");
  contentEl = this.modalEl.createDiv();
  titleEl = this.modalEl.createEl("h2");
  constructor(public app: App) { super(); this.scope = new Scope(app.scope); }
  open() { document.body.appendChild(this.modalEl); this.onOpen(); }
  close() { this.onClose(); this.modalEl.remove(); }
  onOpen() {}
  onClose() {}
}
export class PluginSettingTab {}
export function setIcon(element: HTMLElement, icon: string) { element.dataset.icon = icon; }
export class Menu {
  static shown: Menu;
  items: { title: string; icon: string; warning: boolean; click: () => void }[] = [];
  addItem(callback: (item: any) => void) {
    const value = { title: "", icon: "", warning: false, click: () => {} };
    const item = {
      setTitle(title: string) { value.title = title; return item; },
      setIcon(icon: string) { value.icon = icon; return item; },
      setWarning(warning: boolean) { value.warning = warning; return item; },
      onClick(click: () => void) { value.click = click; return item; }
    };
    callback(item);
    this.items.push(value);
    return this;
  }
  addSeparator() { return this; }
  showAtMouseEvent() { Menu.shown = this; }
}
export class Setting {}
export class Notice {
  static messages: string[] = [];
  constructor(message: string) { Notice.messages.push(message); }
}
export class MarkdownRenderer {
  static async render(_app: App, body: string, element: HTMLElement) {
    element.createEl("p", { text: body });
    for (const match of body.matchAll(/(?<!!)\[\[([^|\]]+)(?:\|([^\]]+))?\]\]/g)) {
      element.createEl("a", { cls: "internal-link", text: match[2] ?? match[1], attr: { "data-href": match[1], href: match[1] } });
    }
    for (const match of body.matchAll(/^\s*[-*+] \[([ xX])\]/gm)) {
      const checkbox = element.createEl("input", { type: "checkbox" });
      checkbox.checked = match[1] !== " ";
    }
  }
}
export function closeDOM() { dom.window.close(); }
