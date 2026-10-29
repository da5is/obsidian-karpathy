import assert from "node:assert/strict";
import { after, test } from "node:test";
import { App, closeDOM } from "./obsidian-mock";

// Set the browser identity before loading CodeMirror so its deferred iOS key
// handling runs, rather than the synchronous desktop keyboard path.
Object.defineProperty(globalThis, "navigator", { configurable: true, value: window.navigator });
Object.defineProperties(navigator, {
  userAgent: { configurable: true, value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" },
  vendor: { configurable: true, value: "Apple Computer, Inc." },
  platform: { configurable: true, value: "iPhone" }
});

after(closeDOM);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("iOS deferred Return cannot insert a newline into the next draft", async () => {
  const { default: KarpathyPlugin } = await import("../src/main");
  const { DEFAULT_SETTINGS } = await import("../src/settings");
  const { Store } = await import("../src/store");
  const { KarpathyView } = await import("../src/view");
  const app = new App();
  const plugin = new KarpathyPlugin(app, { id: "karpathy" });
  plugin.settings = structuredClone(DEFAULT_SETTINGS);
  plugin.store = new Store(app, "Karpathy");
  plugin.changed = () => plugin.store.reindex();
  const view = new KarpathyView({ app }, plugin);
  await view.onOpen();
  try {
    const editor = view["editor"]!;
    editor.insert("A mobile note\n\n");
    editor.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
    const event = new Event("beforeinput", { bubbles: true, cancelable: true });
    Object.defineProperties(event, { inputType: { value: "insertParagraph" }, isComposing: { value: false } });
    editor.view.contentDOM.dispatchEvent(event);
    // Wait beyond CodeMirror's 50ms iOS replay, not just until saving clears text.
    await wait(150);
    assert.equal(app.vault.getMarkdownFiles().length, 1);
    assert.equal(editor.body, "");
    assert.equal(editor.view.state.selection.main.head, 0);
    assert.equal(editor.view.state.doc.lines, 1);
    editor.insert("Next note");
    assert.equal(editor.body, "Next note");
  } finally { await view.onClose(); }
});

test("iOS deferred Return selects a wikilink without a stray newline or saving the entry", async () => {
  const { CaptureEditor } = await import("../src/editor");
  const { WikilinkIndex } = await import("../src/links");
  const { completionStatus } = await import("@codemirror/autocomplete");
  const app = new App();
  await app.vault.create("Reference.md", "");
  const host = document.body.createDiv();
  let saves = 0;
  const editor = new CaptureEditor(host, {
    body: "", colors: {}, tripleEnter: true, change: () => {}, save: () => { saves++; },
    upload: async () => [], error: error => { throw error; }, busy: () => {},
    completeLink: new WikilinkIndex(app).source(() => "day.md")
  });
  try {
    editor.focus();
    editor.view.dispatch({ changes: { from: 0, insert: "[[Ref" }, selection: { anchor: 5 }, userEvent: "input.type" });
    for (let i = 0; i < 100 && completionStatus(editor.view.state) !== "active"; i++) await wait(10);
    assert.equal(completionStatus(editor.view.state), "active");
    editor.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true }));
    const event = new Event("beforeinput", { bubbles: true, cancelable: true });
    Object.defineProperties(event, { inputType: { value: "insertParagraph" }, isComposing: { value: false } });
    editor.view.contentDOM.dispatchEvent(event);
    await wait(150);
    assert.equal(editor.body, "[[Reference]]");
    assert.equal(saves, 0);
    assert.equal(editor.view.state.selection.main.head, editor.body.length);
    editor.insert(" then keep typing");
    assert.equal(editor.body, "[[Reference]] then keep typing");
  } finally { await editor.destroy(); host.remove(); }
});
