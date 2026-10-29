import assert from "node:assert/strict";
import { after, test } from "node:test";
import { completionStatus, currentCompletions, startCompletion } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
import { App, closeDOM } from "./obsidian-mock";
import KarpathyPlugin from "../src/main";
import { Store } from "../src/store";
import { KarpathyView } from "../src/view";
import { DEFAULT_SETTINGS } from "../src/settings";
import { dailyPath } from "../src/model";

after(closeDOM);
async function until(condition: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for completion");
}
function type(editor: EditorView, text: string) {
  const from = editor.state.selection.main.from, to = editor.state.selection.main.to;
  editor.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: "input.type" });
}
function key(editor: EditorView, key: string, modifiers = {}) {
  editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, bubbles: true, cancelable: true, ...modifiers }));
}
function fixture() {
  const app = new App();
  const plugin = new KarpathyPlugin(app, { id: "karpathy" });
  plugin.settings = structuredClone(DEFAULT_SETTINGS);
  plugin.store = new Store(app, "Karpathy");
  plugin.changed = () => plugin.store.reindex();
  return { app, plugin, stream: new KarpathyView({ app }, plugin) };
}

test("typing [[ offers files; arrows and Enter select without saving, then triple Enter saves cleanly", async () => {
  const { app, plugin, stream } = fixture();
  await app.vault.create("Office/Project Alpha.md", "");
  await app.vault.create("Personal/Project Alpha.md", "");
  await stream.onOpen();
  try {
    const editor = stream["editor"]!;
    type(editor.view, "See [[");
    await until(() => completionStatus(editor.view.state) === "active");
    type(editor.view, "Project Alpha");
    await until(() => currentCompletions(editor.view.state).length === 2);
    assert.deepEqual(currentCompletions(editor.view.state).map(item => item.detail), ["Office/Project Alpha.md", "Personal/Project Alpha.md"]);
    key(editor.view, "ArrowDown");
    key(editor.view, "Enter");
    assert.equal(editor.body, "See [[Personal/Project Alpha]]");
    assert.equal(plugin.store.files.length, 0);
    assert.equal(app.linkRequests[0].source, dailyPath("Karpathy", new Date()));
    key(editor.view, "Enter"); key(editor.view, "Enter"); key(editor.view, "Enter");
    await until(() => editor.body === "" && plugin.store.files.length === 1);
    assert.equal((await plugin.store.entries(plugin.store.files[0]))[0].body, "See [[Personal/Project Alpha]]");
    assert.equal(editor.view.state.selection.main.head, 0);
    assert.equal(completionStatus(editor.view.state), null);
  } finally { await stream.onClose(); }
});

test("Tab completes an alias and a pointer selection preserves focus and closes existing brackets", async () => {
  const { app, stream } = fixture();
  await app.vault.create("Reference/Release notes.md", "");
  app.fileCaches.set("Reference/Release notes.md", { frontmatter: { aliases: ["Launch"] } });
  await stream.onOpen();
  try {
    const editor = stream["editor"]!;
    type(editor.view, "[[Lau");
    await until(() => completionStatus(editor.view.state) === "active");
    key(editor.view, "Tab");
    assert.equal(editor.body, "[[Release notes|Launch]]");
    editor.setBody("See [[Rel#Changes|Changelog]] next");
    editor.view.dispatch({ selection: { anchor: 9 } });
    startCompletion(editor.view);
    await until(() => !!document.querySelector(".karpathy-link-suggestions li"));
    document.querySelector(".karpathy-link-suggestions li")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    assert.equal(editor.body, "See [[Release notes#Changes|Changelog]] next");
    assert.equal(editor.view.hasFocus, true);
    assert.equal(editor.view.state.selection.main.head, editor.body.indexOf(" next"));
  } finally { await stream.onClose(); }
});

test("Escape dismisses suggestions while save shortcuts and unmatched links still work", async () => {
  const { app, plugin, stream } = fixture();
  await app.vault.create("Reference.md", "");
  await stream.onOpen();
  try {
    const editor = stream["editor"]!;
    type(editor.view, "[[Ref");
    await until(() => completionStatus(editor.view.state) === "active");
    key(editor.view, "Escape");
    assert.equal(completionStatus(editor.view.state), null);
    assert.equal(editor.body, "[[Ref");
    startCompletion(editor.view);
    await until(() => completionStatus(editor.view.state) === "active");
    key(editor.view, "Enter", { ctrlKey: true });
    await until(() => editor.body === "" && plugin.store.files.length === 1);
    assert.equal((await plugin.store.entries(plugin.store.files[0]))[0].body, "[[Ref");
    type(editor.view, "[[Uncreated note]]");
    key(editor.view, "Enter", { metaKey: true });
    await until(() => editor.body === "");
    assert.equal(await plugin.store.countEntries(), 2);
    assert.equal(app.vault.getAbstractFileByPath("Uncreated note.md"), null);
  } finally { await stream.onClose(); }
});

test("Edit dialog offers links using the original daily file and Escape keeps the dialog open", async () => {
  const { app, plugin, stream } = fixture();
  await app.vault.create("Library/Reference.md", "");
  await plugin.store.capture("Original", new Date(2025, 0, 1), "edit-links");
  const path = plugin.store.files[0].path;
  await stream.onOpen();
  try {
    stream.contentEl.querySelector<HTMLButtonElement>('[aria-label="Edit entry"]')!.click();
    const modal = document.querySelector<HTMLElement>(".karpathy-edit-modal")!;
    const editor = EditorView.findFromDOM(modal.querySelector(".cm-editor")!)!;
    editor.dispatch({ selection: { anchor: editor.state.doc.length } });
    type(editor, " [[Ref");
    await until(() => completionStatus(editor.state) === "active");
    key(editor, "Escape");
    assert.ok(modal.isConnected);
    assert.equal(completionStatus(editor.state), null);
    startCompletion(editor);
    await until(() => completionStatus(editor.state) === "active");
    key(editor, "Enter");
    assert.equal(editor.state.doc.toString(), "Original [[Reference]]");
    assert.equal(app.linkRequests.at(-1)!.source, path);
    modal.querySelector<HTMLButtonElement>(".mod-cta")!.click();
    await until(() => !modal.isConnected);
    assert.equal((await plugin.store.entries(plugin.store.files[0]))[0].body, "Original [[Reference]]");
  } finally { await stream.onClose(); }
});

test("suggestion rendering stays bounded and external file events update all-vault matches", async () => {
  const { app, plugin, stream } = fixture();
  for (let i = 0; i < 100; i++) await app.vault.create(`Library/Reference ${i}.md`, "");
  await stream.onOpen();
  try {
    const editor = stream["editor"]!;
    type(editor.view, "[[Ref");
    await until(() => completionStatus(editor.view.state) === "active");
    assert.equal(currentCompletions(editor.view.state).length, 100);
    assert.ok(document.querySelectorAll(".karpathy-link-suggestions li").length <= 20);
    const newFile = await app.vault.create("Library/Brand new.md", "");
    plugin["fileChanged"](newFile);
    editor.setBody("");
    type(editor.view, "[[Brand");
    await until(() => completionStatus(editor.view.state) === "active");
    assert.equal(currentCompletions(editor.view.state)[0].detail, newFile.path);
  } finally { await stream.onClose(); }
});
