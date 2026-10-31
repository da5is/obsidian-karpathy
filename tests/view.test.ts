import assert from "node:assert/strict";
import { after, test } from "node:test";
import { EditorView } from "@codemirror/view";
import { App, closeDOM, Menu, Platform } from "./obsidian-mock";
import { shell } from "./electron-mock";
import KarpathyPlugin from "../src/main";
import { Store } from "../src/store";
import { KarpathyView } from "../src/view";
import { CaptureEditor, editorToolbar } from "../src/editor";
import { DEFAULT_SETTINGS, parseSettings, themePrefixColor } from "../src/settings";

after(closeDOM);

test("entry footers share yesterday and month-first dates for writing and rescue history", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 9, 29, 16) });
  const { plugin, view } = fixture();
  await plugin.store.capture("Older note", new Date(2026, 9, 27, 10), "date-rescue");
  await plugin.store.rescue((await plugin.store.entries(plugin.store.files[0]))[0], new Date(2026, 9, 28, 11));
  await plugin.store.capture("Yesterday's note", new Date(2026, 9, 28, 10), "date-written");
  await view.onOpen();
  try {
    const labels = [...view.contentEl.querySelectorAll(".karpathy-rescue-meta")].map(element => element.textContent);
    assert.deepEqual(labels, ["↑ rescued yesterday · written Oct 27th · rescued 1 time", "written yesterday"]);
  } finally { await view.onClose(); }
});

test("sidebar hiding persists, restores without an on-screen button, and cleans up on disable", async () => {
  assert.equal(parseSettings({}).hideSidebars, false);
  assert.equal(parseSettings({ hideSidebars: "true" }).hideSidebars, false);
  const { plugin } = fixture();
  let saved: unknown;
  plugin.saveData = async value => { saved = structuredClone(value); };
  await plugin.setSidebarsHidden(true);
  assert.equal(parseSettings(saved).hideSidebars, true);
  assert.ok(document.body.classList.contains("karpathy-hide-sidebars"));
  plugin.applySidebarHiding();
  assert.equal(document.querySelectorAll(".karpathy-show-sidebars").length, 0);
  await plugin.setSidebarsHidden(false);
  await until(() => !document.body.classList.contains("karpathy-hide-sidebars"));
  assert.equal(parseSettings(saved).hideSidebars, false);
  assert.equal(document.querySelector(".karpathy-show-sidebars"), null);
  await plugin.setSidebarsHidden(true);
  plugin["clearSidebarHiding"]();
  assert.equal(document.querySelector(".karpathy-show-sidebars"), null);
  assert.equal(document.body.classList.contains("karpathy-hide-sidebars"), false);
  plugin.saveData = async () => { throw new Error("disk failure"); };
  await assert.rejects(() => plugin.setSidebarsHidden(false), /disk failure/);
  assert.equal(plugin.settings.hideSidebars, true);
});

test("root settings persist and root vault events refresh the stream", async () => {
  assert.equal(parseSettings({}).baseFolder, "Karpathy");
  for (const baseFolder of ["", "/"]) {
    const parsed = parseSettings({ baseFolder, hiddenFolders: ["/", "", "Archive"] });
    assert.equal(parsed.baseFolder, "");
    assert.deepEqual(parseSettings(parsed), parsed);
    assert.deepEqual(parsed.hiddenFolders, ["Archive"]);
  }
  const { plugin, app } = fixture();
  let saved: unknown;
  plugin.saveData = async value => { saved = value; };
  await plugin.changeBase("/");
  assert.equal(parseSettings(saved).baseFolder, "");
  assert.equal(plugin.store.base, "");
  const file = await app.vault.create("2026/2026-10/2026-10-25.md", "external change");
  let refreshed = false;
  plugin.changed = () => { refreshed = true; };
  (plugin as any).fileChanged(file);
  assert.equal(refreshed, true);
});

test("first use remembers new prefixes with theme colors, excludes URLs, and preserves custom colors", async () => {
  const { plugin } = fixture();
  let saved: unknown;
  let writes = 0;
  plugin.saveData = async value => { saved = structuredClone(value); writes++; };
  await Promise.all([plugin.rememberPrefix("work: first"), plugin.rememberPrefix("Work: second"), plugin.rememberPrefix("travel: third")]);
  assert.equal(writes, 2);
  assert.equal(plugin.settings.prefixColors.work, themePrefixColor("work"));
  assert.equal(parseSettings(saved).prefixColors.travel, themePrefixColor("travel"));
  plugin.settings.prefixColors.work = "#123456";
  await plugin.rememberPrefix("work: fourth");
  await plugin.rememberPrefix("https://example.com");
  await plugin.rememberPrefix("mailto:person@example.com");
  assert.equal(writes, 2);
  assert.equal(plugin.settings.prefixColors.work, "#123456");
  assert.equal(plugin.settings.prefixColors.https, undefined);
});

test("prefix defaults migrate to theme variables and preserve intentional overrides", () => {
  const migrated = parseSettings({ prefixColors: { todo: "#b87832", read: "#388579", idea: "#3b829d", watch: "#9870b3", listen: "#ae6682" } });
  assert.deepEqual(Object.keys(migrated.prefixColors), ["todo", "read", "buy", "ref"]);
  for (const prefix of ["todo", "read", "buy", "ref"]) assert.equal(migrated.prefixColors[prefix], themePrefixColor(prefix));
  assert.deepEqual(parseSettings(migrated), migrated);
  const custom = parseSettings({ prefixColors: { read: "#123456", work: "#abcdef" } });
  assert.equal(custom.prefixColors.read, "#123456");
  assert.equal(custom.prefixColors.work, "#abcdef");
});

test("only configured prefixes are highlighted and editor and stream use theme variables", async () => {
  const { plugin, view } = fixture();
  await plugin.store.capture("todo: theme check", new Date(), "theme-entry");
  await view.onOpen();
  assert.equal(view.contentEl.querySelector<HTMLElement>(".karpathy-entry-content .karpathy-prefix")!.style.color, themePrefixColor("todo"));
  const editor = view["editor"]!;
  for (const prefix of ["todo", "read", "buy", "ref"]) {
    editor.setBody(`${prefix}: example`);
    assert.equal(editor.view.contentDOM.querySelector<HTMLElement>(".karpathy-prefix")!.style.color, themePrefixColor(prefix));
  }
  for (const prefix of ["listen", "idea", "watch", "https"]) {
    editor.setBody(`${prefix}: example`);
    assert.equal(editor.view.contentDOM.querySelector(".karpathy-prefix"), null);
  }
  await view.onClose();
});

test("touch gestures leave entries unchanged and do not intercept scrolling", async () => {
  const { plugin, view } = fixture();
  await plugin.store.capture("touch check", new Date(2026, 0, 1), "touch-entry");
  await view.onOpen();
  const row = view.contentEl.querySelector('[data-entry-id="touch-entry"]')!;
  for (const type of ["touchstart", "touchmove", "touchend"]) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { touches: { value: [{ clientX: 120, clientY: 4 }] }, changedTouches: { value: [{ clientX: 120, clientY: 4 }] } });
    row.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
  }
  assert.equal(row.querySelector(".karpathy-rescue-rail"), null);
  assert.equal((await plugin.store.entries(plugin.store.files[0]))[0].rescues, 0);
  await view.onClose();
});

test("button capture returns keyboard focus to the empty composer", async () => {
  const { view } = fixture();
  await view.onOpen();
  const editor = view["editor"]!;
  editor.insert("button capture");
  const button = view.contentEl.querySelector<HTMLButtonElement>(".karpathy-save")!;
  button.focus();
  button.click();
  await until(() => editor.body === "" && !view["saving"]);
  assert.equal(document.activeElement, editor.view.contentDOM);
  await view.onClose();
});

test("live preview hides formatting, preserves Markdown, and toggles a real task", async () => {
  const { view } = fixture();
  await view.onOpen();
  const editor = view["editor"]!;
  const markdown = "# Heading\n\n**bold** and *italic*\n\n- [ ] task\n\n```md\n**literal**\n```\n\ncursor";
  editor.insert(markdown);
  assert.equal(editor.body, markdown);
  assert.ok(!editor.view.contentDOM.textContent!.includes("**bold**"));
  assert.ok(editor.view.contentDOM.textContent!.includes("**literal**"));
  const checkbox = editor.view.contentDOM.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  assert.ok(checkbox);
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  assert.equal(editor.body, markdown.replace("- [ ] task", "- [x] task"));
  editor.view.dispatch({ selection: { anchor: markdown.indexOf("bold") + 1 } });
  assert.ok(editor.view.contentDOM.textContent!.includes("**bold**"));
  await view.onClose();
});

test("rescue button moves the original into the newest stream position", async () => {
  const { plugin, view } = fixture();
  await plugin.store.capture("old idea", new Date(2025, 0, 1), "old-entry");
  await plugin.store.capture("recent idea", new Date(2026, 0, 1), "new-entry");
  await view.onOpen();
  const row = view.contentEl.querySelector<HTMLElement>('[data-entry-id="old-entry"]')!;
  row.querySelector<HTMLButtonElement>('[aria-label="Rescue entry to the top"]')!.click();
  await until(() => view.contentEl.querySelector<HTMLElement>(".karpathy-entry")?.dataset.entryId === "old-entry");
  assert.equal(view.contentEl.querySelectorAll('[data-entry-id="old-entry"]').length, 1);
  assert.ok(view.contentEl.querySelector(".karpathy-rescue-meta"));
  await view.onClose();
});

test("entry menu confirms deletion, supports cancel and refreshes the stream and count", async () => {
  const { plugin, view } = fixture();
  await plugin.store.capture("keep this", new Date(2026, 9, 25), "keep-entry");
  await plugin.store.capture("delete this", new Date(2026, 9, 25, 1), "delete-entry");
  await view.onOpen();
  const more = view.contentEl.querySelector<HTMLButtonElement>('[data-entry-id="delete-entry"] [aria-label="More entry actions"]')!;
  more.click();
  assert.deepEqual(Menu.shown.items.map(item => item.title), ["Open entry Markdown note", "Delete entry"]);
  const action = Menu.shown.items.find(item => item.title === "Delete entry")!;
  assert.equal(action.warning, true);
  action.click();
  let modal = document.querySelector<HTMLElement>(".karpathy-delete-modal")!;
  assert.equal(modal.querySelector(".karpathy-delete-preview")!.textContent, "delete this");
  const cancel = modal.querySelector<HTMLButtonElement>("button:not(.mod-warning)")!;
  assert.equal(document.activeElement, cancel);
  assert.equal(await plugin.store.countEntries(), 2);
  cancel.click();
  assert.equal(document.querySelector(".karpathy-delete-modal"), null);
  assert.equal(await plugin.store.countEntries(), 2);
  more.click();
  Menu.shown.items.find(item => item.title === "Delete entry")!.click();
  modal = document.querySelector<HTMLElement>(".karpathy-delete-modal")!;
  const remove = modal.querySelector<HTMLButtonElement>(".mod-warning")!;
  const errors: unknown[] = [];
  plugin.report = error => { errors.push(error); };
  remove.click();
  remove.click();
  assert.equal(remove.disabled, true);
  await until(() => !view.contentEl.querySelector('[data-entry-id="delete-entry"]') && view.contentEl.textContent!.includes("1 note captured"));
  assert.ok(view.contentEl.querySelector('[data-entry-id="keep-entry"]'));
  assert.equal(document.querySelector(".karpathy-delete-modal"), null);
  assert.deepEqual(errors, []);
  await view.onClose();
});

test("failed menu deletion keeps the entry and allows retry", async () => {
  const { app, plugin, view } = fixture();
  await plugin.store.capture("keep until saved", new Date(2026, 9, 25), "retry-delete");
  const errors: unknown[] = [];
  plugin.report = error => { errors.push(error); };
  await view.onOpen();
  view.contentEl.querySelector<HTMLButtonElement>('[aria-label="More entry actions"]')!.click();
  Menu.shown.items.find(item => item.title === "Delete entry")!.click();
  const modal = document.querySelector<HTMLElement>(".karpathy-delete-modal")!;
  const remove = modal.querySelector<HTMLButtonElement>(".mod-warning")!;
  app.vault.failWrites = true;
  remove.click();
  await until(() => !remove.disabled);
  assert.equal(errors.length, 1);
  assert.match(modal.querySelector('[role="alert"]')!.textContent!, /Could not delete/);
  assert.equal(await plugin.store.countEntries(), 1);
  assert.ok(view.contentEl.querySelector('[data-entry-id="retry-delete"]'));
  app.vault.failWrites = false;
  remove.click();
  await until(() => !view.contentEl.querySelector('[data-entry-id="retry-delete"]') && view.contentEl.textContent!.includes("0 notes captured"));
  assert.equal(document.querySelector(".karpathy-delete-modal"), null);
  await view.onClose();
});

test("image and wikilink previews preserve source and do not interpret code blocks", async () => {
  const { plugin, view } = fixture();
  plugin.imageSource = link => link === "pictures/example.png" ? "data:image/png;base64,iVBORw0KGgo=" : null;
  await view.onOpen();
  const editor = view["editor"]!;
  const source = "![[pictures/example.png]]\n\n[[Note|A label]]\n\n```md\n![[pictures/example.png]]\n```\n\ncursor";
  editor.insert(source);
  assert.equal(editor.body, source);
  assert.equal(editor.view.contentDOM.querySelectorAll(".karpathy-live-image").length, 1);
  assert.ok(editor.view.contentDOM.textContent!.includes("A label"));
  assert.ok(!editor.view.contentDOM.textContent!.includes("[[Note|A label]]"));
  assert.ok(editor.view.contentDOM.textContent!.includes("![[pictures/example.png]]"));
  await view.onClose();
});
async function until(condition: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for the expected UI state");
}
function fixture() {
  const app = new App();
  const plugin = new KarpathyPlugin(app, { id: "karpathy" });
  plugin.settings = structuredClone(DEFAULT_SETTINGS);
  plugin.store = new Store(app, "Karpathy");
  plugin.changed = () => plugin.store.reindex();
  const view = new KarpathyView({ app }, plugin);
  return { app, plugin, view };
}

test("triple Enter captures through the real editor; Shift+Enter remains a newline", async () => {
  const { app, view } = fixture();
  await view.onOpen();
  const editor = view["editor"]!;
  editor.insert("todo: first");
  editor.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true, shiftKey: true }));
  assert.equal(editor.body, "todo: first\n");
  assert.equal(app.vault.getMarkdownFiles().length, 0);
  editor.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
  assert.equal(editor.body, "todo: first\n\n");
  assert.equal(app.vault.getMarkdownFiles().length, 0);
  editor.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
  assert.equal(app.vault.getMarkdownFiles().length, 0);
  editor.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
  await until(() => editor.body === "");
  assert.equal(app.vault.getMarkdownFiles().length, 1);
  await until(() => view.contentEl.querySelectorAll(".karpathy-entry").length === 1);
  assert.equal(view.contentEl.querySelector(".karpathy-prefix")?.textContent, "todo:");
  await view.onClose();
});

test("a Markdown heading and blank line do not submit before the body is written", async () => {
  const { app, view } = fixture();
  await view.onOpen();
  const editor = view["editor"]!;
  editor.insert("## Heading");
  for (let i = 0; i < 2; i++) {
    editor.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  }
  assert.equal(editor.body, "## Heading\n\n");
  assert.equal(app.vault.getMarkdownFiles().length, 0);
  editor.insert("Body text");
  assert.equal(editor.body, "## Heading\n\nBody text");
  assert.equal(app.vault.getMarkdownFiles().length, 0);
  await view.onClose();
});

test("Ctrl+Enter and Cmd+Enter submit before a competing Obsidian app shortcut", async () => {
  for (const modifier of ["ctrlKey", "metaKey"]) {
    const { app, view } = fixture();
    let globalShortcut = 0;
    app.scope.register([modifier === "ctrlKey" ? "Ctrl" : "Meta"], "Enter", () => { globalShortcut++; return false; });
    const route = (event: KeyboardEvent) => {
      if (view.scope!.handle(event) === false) event.stopImmediatePropagation();
    };
    document.addEventListener("keydown", route, { capture: true });
    try {
      await view.onOpen();
      const editor = view["editor"]!;
      editor.insert("send using a modifier");
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, [modifier]: true });
      editor.view.contentDOM.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true);
      assert.equal(globalShortcut, 0);
      await until(() => editor.body === "");
      assert.equal(app.vault.getMarkdownFiles().length, 1);
      await view.onClose();
      assert.equal(view.scope!.handlers.length, 0);
    } finally { document.removeEventListener("keydown", route, { capture: true }); }
  }
});

test("dropping a file still requires three Enter presses to send", async () => {
  const { app, view } = fixture();
  await view.onOpen();
  const editor = view["editor"]!;
  editor.view.posAtCoords = () => editor.view.state.doc.length;
  const drop = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperties(drop, {
    dataTransfer: { value: { files: [new File(["pdf"], "report.pdf", { type: "application/pdf" })] } },
    clientX: { value: 0 }, clientY: { value: 0 }
  });
  editor.view.contentDOM.dispatchEvent(drop);
  assert.equal(drop.defaultPrevented, true);
  await until(() => editor.pending === 0);
  assert.ok(editor.body.includes("report.pdf"));
  assert.ok(!editor.body.endsWith("\n"));
  const enter = () => editor.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  enter();
  assert.equal(app.vault.getMarkdownFiles().length, 0);
  assert.ok(editor.body.endsWith("\n"));
  enter();
  assert.equal(app.vault.getMarkdownFiles().length, 0);
  assert.ok(editor.body.endsWith("\n\n"));
  enter();
  await until(() => editor.body === "");
  assert.equal(app.vault.getMarkdownFiles().length, 1);
  await view.onClose();
});

test("attachment links launch the desktop default app and surface launch failures", async () => {
  const { app, plugin, view } = fixture();
  shell.opened = [];
  shell.error = "";
  const date = new Date(2026, 9, 25);
  const body = await plugin.store.attachment(new File(["pdf"], "my report.pdf", { type: "application/pdf" }), date);
  await plugin.store.capture(body, date, "attachment-entry");
  await view.onOpen();
  const link = view.contentEl.querySelector<HTMLAnchorElement>("a.internal-link")!;
  assert.ok(link);
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  link.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  await until(() => shell.opened.length === 1);
  assert.equal(shell.opened[0], app.vault.adapter.getFullPath(link.dataset.href!));
  assert.equal(app.workspace.opened.length, 0);
  shell.error = "No associated application";
  await assert.rejects(() => plugin.openStreamLink(link.dataset.href!, plugin.store.files[0].path), /No associated application/);
  shell.error = "";
  await view.onClose();
});

test("mobile links and Markdown notes retain Obsidian's native link handling", async () => {
  const { app, plugin } = fixture();
  const source = "Karpathy/2026/2026-10/2026-10-25.md";
  await app.vault.createBinary("Karpathy/2026/2026-10/attachments/report.pdf", new ArrayBuffer(0));
  Platform.isDesktopApp = false;
  try { await plugin.openStreamLink("Karpathy/2026/2026-10/attachments/report.pdf", source); }
  finally { Platform.isDesktopApp = true; }
  assert.equal(app.workspace.opened.length, 1);
  await app.vault.create("Other note.md", "a note");
  await plugin.openStreamLink("Other note.md", source);
  assert.equal(app.workspace.opened[1].linktext, "Other note.md");
});

test("closing and reopening the view preserves the unsaved text draft", async () => {
  const { app, plugin, view } = fixture();
  await view.onOpen();
  view["editor"]!.insert("An unsaved thought");
  await view.onClose();
  const reopened = new KarpathyView({ app }, plugin);
  await reopened.onOpen();
  assert.equal(reopened["editor"]!.body, "An unsaved thought");
  assert.equal(app.vault.getMarkdownFiles().length, 0);
  await reopened.onClose();
});

for (const cancelable of [true, false]) {
  test(`native paragraph input (cancelable=${cancelable}) saves only after the third Return`, async () => {
    const { app, view } = fixture();
    await view.onOpen();
    try {
      const editor = view["editor"]!;
      editor.insert("mobile thought\n");
      const nativeReturn = () => {
        const event = new Event("beforeinput", { bubbles: true, cancelable });
        Object.defineProperties(event, { inputType: { value: "insertParagraph" }, isComposing: { value: false } });
        editor.view.contentDOM.dispatchEvent(event);
        assert.equal(event.defaultPrevented, false);
        // CodeMirror hands normalized native input to its public input handlers.
        const cm = editor.view;
        const from = cm.state.selection.main.from;
        const to = cm.state.selection.main.to;
        const insert = () => cm.state.update({ changes: { from, to, insert: "\n" }, selection: { anchor: from + 1 }, userEvent: "input.type" });
        if (!cm.state.facet(EditorView.inputHandler).some(handler => handler(cm, from, to, "\n", insert))) cm.dispatch(insert());
      };
      nativeReturn();
      await until(() => editor.body === "mobile thought\n\n");
      assert.equal(app.vault.getMarkdownFiles().length, 0);
      nativeReturn();
      assert.equal(app.vault.getMarkdownFiles().length, 0);
      nativeReturn();
      await until(() => editor.body === "");
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(editor.body, "");
      assert.equal(editor.view.state.selection.main.head, 0);
      assert.equal(editor.view.state.doc.lines, 1);
      assert.equal(editor.view.hasFocus, true);
      editor.insert("Next thought");
      assert.equal(editor.body, "Next thought");
      assert.equal(app.vault.getMarkdownFiles().length, 1);
    } finally { await view.onClose(); }
  });
}

test("header and composer share the stream scroller and footer actions retain accessible names", async () => {
  const { plugin, view } = fixture();
  await plugin.store.capture("A note", new Date(), "layout");
  await view.onOpen();
  const scroller = view.contentEl.querySelector(".karpathy-scroller")!;
  assert.equal(view.contentEl.querySelector(".karpathy-header")!.parentElement, scroller);
  assert.equal(view.contentEl.querySelector(".karpathy-capture")!.parentElement, scroller);
  const footer = scroller.querySelector(".karpathy-entry-meta")!;
  assert.ok(footer.querySelector(".karpathy-rescue-meta"));
  assert.ok(footer.querySelector('[aria-label="Rescue entry to the top"] .karpathy-action-icon'));
  assert.ok(footer.querySelector('[aria-label="Edit entry"] .karpathy-action-icon'));
  await view.onClose();
});

test("clipboard files and picker attachments insert at the original cursor and block premature saves", async () => {
  const parent = document.body.createDiv();
  let release!: (links: string[]) => void;
  const errors: unknown[] = [];
  const editor = new CaptureEditor(parent, {
    body: "start", colors: {}, tripleEnter: true, change: () => {}, save: () => {},
    upload: () => new Promise(resolve => { release = resolve; }), error: error => errors.push(error), busy: () => {}
  });
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files: [new File(["image"], "clip.png", { type: "image/png" })] } });
  editor.view.contentDOM.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(editor.pending, 1);
  assert.match(editor.body, /uploading:/);
  editor.insert("typing while uploading");
  await until(() => typeof release === "function");
  release(["![[Karpathy/2026/2026-10/attachments/clip.png]]"]);
  await until(() => editor.pending === 0);
  assert.ok(editor.body.includes("typing while uploading"));
  assert.ok(editor.body.includes("![[Karpathy/"));
  assert.ok(!editor.body.includes("uploading:"));
  const picker = editorToolbar(parent, editor);
  Object.defineProperty(picker, "files", { configurable: true, value: [new File(["pdf"], "doc.pdf")] });
  picker.dispatchEvent(new Event("change"));
  assert.equal(editor.pending, 1);
  await new Promise(resolve => setTimeout(resolve, 0));
  release(["[[Karpathy/2026/2026-10/attachments/doc.pdf]]"]);
  await until(() => editor.pending === 0);
  assert.ok(editor.body.includes("doc.pdf"));
  assert.deepEqual(errors, []);
  await editor.destroy();
  parent.remove();
});

test("bounded stream window can page backward after evicting older rendered rows", async () => {
  const { plugin, view } = fixture();
  for (let i = 0; i < 190; i++) await plugin.store.capture(`entry ${i}`, new Date(2026, 9, 25, 0, i), `entry-${i}`);
  await view.onOpen();
  assert.equal(view.contentEl.querySelectorAll(".karpathy-entry").length, 30);
  for (let i = 0; i < 5; i++) await view["loadPage"](1);
  assert.equal(view.contentEl.querySelectorAll(".karpathy-entry").length, 120);
  assert.equal(view["items"][0].body, "entry 129");
  assert.equal(view["items"].at(-1)!.body, "entry 10");
  await view["loadPage"](-1);
  assert.equal(view["items"][0].body, "entry 159");
  assert.equal(view.contentEl.querySelectorAll(".karpathy-entry").length, 120);
  assert.equal(view["rows"].size, 120);
  await view.onClose();
  assert.equal(view["rows"].size, 0);
});

test("search discovers old history and external edits invalidate rendered content", async () => {
  const { app, plugin, view } = fixture();
  for (let day = 1; day <= 20; day++) await plugin.store.capture(day === 1 ? "read: old book" : "ordinary", new Date(2026, 9, day), `day-${day}`);
  await view.onOpen();
  view["query"] = "read: book";
  await view.refresh(false);
  assert.equal(view["items"].length, 1);
  const entry = view["items"][0];
  await plugin.store.update(entry, "read: revised book");
  await view.refresh(true);
  assert.ok(view.contentEl.querySelector(".karpathy-entry-content")!.textContent!.includes("revised"));
  assert.equal(app.vault.getMarkdownFiles().length, 20);
  await view.onClose();
});

test("failed captures retain drafts and blocked uploads cannot be saved", async () => {
  const { app, plugin, view } = fixture();
  const errors: unknown[] = [];
  plugin.report = error => errors.push(error);
  await view.onOpen();
  const editor = view["editor"]!;
  editor.insert("do not lose this");
  app.vault.failWrites = true;
  await view["save"]();
  assert.equal(editor.body, "do not lose this");
  assert.equal(plugin.readDraft(plugin.draftKey())!.body, "do not lose this");
  assert.equal(errors.length, 1);
  app.vault.failWrites = false;
  editor.pending = 1;
  await view["save"]();
  assert.equal(app.vault.getMarkdownFiles().length, 0);
  editor.pending = 0;
  await view["save"]();
  assert.equal(editor.body, "");
  assert.equal(plugin.readDraft(plugin.draftKey()), null);
  await view.onClose();
});

test("a later upload failure preserves earlier links at the insertion point", async () => {
  const parent = document.body.createDiv();
  let calls = 0;
  const errors: unknown[] = [];
  const editor = new CaptureEditor(parent, {
    body: "original", colors: {}, tripleEnter: true, change: () => {}, save: () => {}, busy: () => {},
    upload: async () => {
      if (++calls === 2) throw new Error("Second file failed");
      return ["![[saved.png]]"];
    },
    error: error => errors.push(error)
  });
  editor.attach([new File(["one"], "one.png"), new File(["two"], "two.png")]);
  editor.insert("additional text");
  await until(() => editor.pending === 0);
  assert.equal(errors.length, 1);
  assert.ok(editor.body.includes("![[saved.png]]"));
  assert.ok(editor.body.includes("additional text"));
  assert.ok(editor.body.includes("original"));
  assert.ok(!editor.body.includes("uploading:"));
  await editor.destroy();
  parent.remove();
});

test("interrupted upload placeholders are removed when a text draft is restored", async () => {
  const { plugin } = fixture();
  const key = plugin.draftKey();
  plugin.writeDraft(key, { body: "keep text\n<!-- uploading:test-id -->\n", timestamp: new Date().toISOString(), id: "draft" });
  assert.equal(plugin.readDraft(key)!.body, "keep text\n\n");
});

test("metadata-only refresh replaces stale actions", async () => {
  const { app, plugin, view } = fixture();
  const errors: unknown[] = [];
  plugin.report = error => errors.push(error);
  await plugin.store.capture("metadata check", new Date(), "metadata-entry");
  await view.onOpen();
  const file = plugin.store.files[0];
  await app.vault.process(file, text => text.replace("karpathy: 2", "custom: preserved\nkarpathy: 2"));
  plugin.store.invalidate(file.path);
  await view.refresh(true);
  view.contentEl.querySelector<HTMLButtonElement>('[aria-label="Rescue entry to the top"]')!.click();
  await until(() => view.contentEl.textContent!.includes("rescued 1 time"));
  assert.deepEqual(errors, []);
  assert.match(await app.vault.read(file), /custom: preserved/);
  await view.onClose(); await plugin.store.close();
});

test("cursor failure releases loading and subsequent refresh succeeds", async () => {
  const { plugin, view } = fixture();
  await plugin.store.capture("anchor", new Date(), "anchor");
  await view.onOpen();
  view["scroller"].scrollTop = 100;
  const cursor = plugin.store.cursorFor.bind(plugin.store);
  plugin.store.cursorFor = async () => { throw new Error("transient failure"); };
  await assert.rejects(view.refresh(true), /transient failure/);
  assert.equal(view["loading"], false);
  plugin.store.cursorFor = cursor;
  await view.refresh(true);
  assert.equal(view["loading"], false);
  assert.ok(view.contentEl.textContent!.includes("anchor"));
  await view.onClose(); await plugin.store.close();
});

test("only one capture pane and one entry editor own each persisted draft", async () => {
  const { app, plugin, view } = fixture();
  app.workspace.revealLeaf = async () => {};
  await view.onOpen();
  view["editor"]!.insert("keep this first draft");
  const second = new KarpathyView({ app }, plugin);
  await second.onOpen();
  assert.equal(second["editor"], undefined);
  assert.equal(plugin.readDraft(plugin.draftKey())!.body, "keep this first draft");
  await view.onClose();
  await second.reconfigure();
  assert.equal(second["editor"]!.body, "keep this first draft");
  await second["save"]();
  await second.refresh(false);
  second.contentEl.querySelector<HTMLButtonElement>('[aria-label="Edit entry"]')!.click();
  second.contentEl.querySelector<HTMLButtonElement>('[aria-label="Edit entry"]')!.click();
  assert.equal(plugin.editing, 1);
  assert.equal(document.querySelectorAll(".karpathy-edit-modal").length, 1);
  for (const draft of plugin["draftOwners"].values()) if ("close" in draft.owner) (draft.owner as any).close();
  await until(() => plugin.editing === 0);
  await second.onClose(); await plugin.store.close();
});

test("settings queue preserves overlapping updates and defers synced folder changes around drafts", async () => {
  const { app, plugin, view } = fixture();
  let finish!: () => void;
  let writes = 0;
  plugin.saveData = async () => { if (++writes === 1) await new Promise<void>(resolve => { finish = resolve; }); };
  const prefix = plugin.rememberPrefix("work: first");
  await until(() => !!finish);
  const sidebar = plugin.setSidebarsHidden(true);
  finish(); await Promise.all([prefix, sidebar]);
  assert.equal(plugin.settings.hideSidebars, true);
  assert.ok(plugin.settings.prefixColors.work);
  await view.onOpen(); view["editor"]!.insert("draft");
  plugin.views = () => [view];
  plugin.loadData = async () => ({ ...plugin.settings, baseFolder: "Synced" });
  await plugin.onExternalSettingsChange();
  assert.equal(plugin.settings.baseFolder, "Karpathy");
  await view["save"]();
  await plugin.applyPendingSettings();
  assert.equal(plugin.settings.baseFolder, "Synced");
  await view.onClose(); await plugin.store.close();
});

test("draft writes coalesce but close flushes the latest text", async () => {
  const { app, plugin, view } = fixture();
  let writes = 0;
  const save = app.saveLocalStorage.bind(app);
  app.saveLocalStorage = (key, value) => { writes++; save(key, value); };
  await view.onOpen();
  const before = writes;
  for (let i = 0; i < 20; i++) view["editor"]!.insert("a");
  assert.equal(writes, before);
  await view.onClose();
  assert.equal(app.loadLocalStorage(plugin.draftKey()).body, "a".repeat(20));
  assert.equal(writes, before + 1);
  await plugin.store.close();
});

test("folder hiding observes explorer containers rather than composer mutations", async () => {
  const { app, plugin } = fixture();
  const root = document.body.createDiv();
  const folder = root.createDiv();
  const title = folder.createDiv({ cls: "nav-folder-title", attr: { "data-path": "Secret" } });
  const original = root.querySelectorAll.bind(root);
  let scans = 0;
  root.querySelectorAll = ((query: string) => { scans++; return original(query); }) as any;
  app.workspace.getLeavesOfType = ((type: string) => type === "file-explorer" ? [{ view: { containerEl: root } }] : []) as any;
  plugin.settings.hiddenFolders = ["Secret"];
  plugin.applyFolderHiding();
  assert.ok(folder.classList.contains("karpathy-hidden-folder"));
  const count = scans;
  const unrelated = document.body.createDiv(); unrelated.createEl("p", { text: "typing" });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(scans, count);
  title.setAttribute("data-path", "Visible");
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(!folder.classList.contains("karpathy-hidden-folder"));
  plugin.settings.hiddenFolders = []; plugin.applyFolderHiding(); root.remove(); unrelated.remove();
  await plugin.store.close();
});

test("closing a saving capture retains ownership until the write finishes", async () => {
  const { app, plugin, view } = fixture();
  app.workspace.revealLeaf = async () => {};
  await view.onOpen(); view["editor"]!.insert("pending write");
  const capture = plugin.store.capture.bind(plugin.store);
  let finish!: () => void;
  plugin.store.capture = async (...args) => { await new Promise<void>(resolve => { finish = resolve; }); return capture(...args); };
  const saving = view["save"]();
  await until(() => !!finish);
  await view.onClose();
  const second = new KarpathyView({ app }, plugin); await second.onOpen();
  assert.equal(second["editor"], undefined);
  finish(); await saving; await new Promise(resolve => setTimeout(resolve, 0));
  await second.reconfigure();
  assert.equal(second["editor"]!.body, "");
  second["editor"]!.insert("new draft survives");
  await second.onClose();
  assert.equal(plugin.readDraft(plugin.draftKey())!.body, "new draft survives");
  await plugin.store.close();
});

test("links from a different DOM realm remain clickable after window migration", async () => {
  const { JSDOM } = await import("jsdom");
  const foreign = new JSDOM("<a class='internal-link' data-href='Target.md'>Target</a>");
  const { plugin, view } = fixture();
  let opened = "";
  plugin.openStreamLink = async link => { opened = link; };
  await plugin.store.capture("ordinary body", new Date(), "realm");
  await view.onOpen();
  const link = foreign.window.document.querySelector("a")!;
  view.contentEl.querySelector(".karpathy-entry-content")!.appendChild(link);
  link.dispatchEvent(new foreign.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.equal(opened, "Target.md");
  await view.onClose(); await plugin.store.close(); foreign.window.close();
});
