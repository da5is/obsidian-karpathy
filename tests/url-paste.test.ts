import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { history, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { App, closeDOM, Platform, urlRequests } from "./obsidian-mock";
import { CaptureEditor } from "../src/editor";
import { urlPaste } from "../src/url-paste";
import KarpathyPlugin from "../src/main";
import { KarpathyView } from "../src/view";
import { Store } from "../src/store";
import { DEFAULT_SETTINGS } from "../src/settings";

after(closeDOM);
const url = "https://example.com/article";
const response = (text: string, status = 200, type = "text/html; charset=utf-8") => ({ status, headers: { "Content-Type": type }, text });
beforeEach(() => {
  urlRequests.calls = [];
  urlRequests.respond = async () => response("<title>A useful article</title>");
});
async function settled() { await new Promise(resolve => setTimeout(resolve, 15)); }
async function until(condition: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail("Timed out waiting for URL paste");
}
function fixture(body = "") {
  const parent = document.body.createDiv();
  const editor = new CaptureEditor(parent, {
    body, colors: {}, tripleEnter: true, change: () => {}, save: () => {},
    upload: async () => ["![[photo.png]]"], error: error => { throw error; }, busy: () => {}
  });
  editor.view.dispatch({ selection: { anchor: body.length } });
  return { editor, close: async () => { await editor.destroy(); parent.remove(); } };
}
function paste(view: EditorView, text: string, files: File[] = []) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files, getData: (type: string) => type === "text/plain" ? text : "" } });
  view.contentDOM.dispatchEvent(event);
  return event;
}
function deferred() {
  let finish!: (html: string) => void;
  urlRequests.respond = () => new Promise(resolve => { finish = html => resolve(response(html)); });
  return (html = "<title>A useful article</title>") => finish(html);
}

test("pasting a single URL fetches its title, decodes entities and emits ordinary valid Markdown", async () => {
  const { editor, close } = fixture("read: ");
  const destination = "https://example.com/a_(b)?x=1&y=2#part";
  urlRequests.respond = async () => response("<title>  A [guide] &amp; **examples**\n today </title><script>throw 1</script>");
  try {
    assert.equal(paste(editor.view, destination).defaultPrevented, true);
    assert.equal(editor.body, `read: ${destination}`);
    await until(() => editor.body.includes("[A"));
    assert.equal(editor.body, "read: [A \\[guide\\] \\& \\*\\*examples\\*\\* today](https://example.com/a_%28b%29?x=1&y=2#part)");
    const nodes: string[] = [];
    markdownLanguage.parser.parse(editor.body).iterate({ enter: node => { nodes.push(node.name); } });
    assert.equal(nodes.filter(name => name === "Link").length, 1);
    assert.equal(editor.view.state.selection.main.head, editor.body.length);
    assert.deepEqual(urlRequests.calls.map(call => call.url), [destination]);
  } finally { await close(); }
});

test("pasting over selected text uses that label immediately without a network request", async () => {
  const { editor, close } = fixture("Read this article later");
  try {
    editor.view.dispatch({ selection: { anchor: 5, head: 17 } });
    paste(editor.view, url);
    assert.equal(editor.body, `Read [this article](${url}) later`);
    assert.equal(urlRequests.calls.length, 0);
  } finally { await close(); }
});

test("metadata titles are a fallback; errors, non-HTML responses and missing titles retain the URL", async () => {
  const { editor, close } = fixture();
  try {
    urlRequests.respond = async () => response('<meta property="og:title" content="Alternate &amp; title">');
    paste(editor.view, url);
    await until(() => editor.body.startsWith("["));
    assert.equal(editor.body, `[Alternate \\& title](${url})`);
    for (const result of [response("<title>Error</title>", 403), response("<title>PDF</title>", 200, "application/pdf"), response("<p>No title</p>")]) {
      editor.setBody("");
      urlRequests.respond = async () => result;
      paste(editor.view, url);
      await settled();
      assert.equal(editor.body, url);
    }
    editor.setBody("");
    urlRequests.respond = async () => { throw new Error("Offline"); };
    paste(editor.view, url);
    await settled();
    assert.equal(editor.body, url);
  } finally { await close(); }
});

test("unrelated edits and cursor movement survive a late lookup; title conversion has its own undo", async () => {
  const { editor, close } = fixture();
  const finish = deferred();
  try {
    paste(editor.view, url);
    editor.insert(" and more");
    editor.view.dispatch({ changes: { from: 0, insert: "Before " }, selection: { anchor: 2 } });
    finish();
    await until(() => editor.body.includes("[A useful"));
    assert.equal(editor.body, `Before [A useful article](${url}) and more`);
    assert.equal(editor.view.state.selection.main.head, 2);
    undo(editor.view);
    assert.equal(editor.body, `Before ${url} and more`);
    await settled();
    assert.equal(editor.body, `Before ${url} and more`);
  } finally { await close(); }
});

test("edited or undone URLs, saving/resetting and destroyed editors cannot be rewritten by late responses", async () => {
  for (const action of ["edit", "append", "undo", "reset", "save", "close"]) {
    const { editor, close } = fixture();
    const finish = deferred();
    paste(editor.view, url);
    if (action === "edit") editor.view.dispatch({ changes: { from: 10, to: 11, insert: "X" } });
    if (action === "append") editor.insert("/new-path");
    if (action === "undo") undo(editor.view);
    if (action === "reset") editor.setBody("New draft");
    if (action === "save") { editor.lock(true); editor.setBody("Next draft"); editor.lock(false); }
    if (action === "close") await close();
    const expected = editor.body;
    finish();
    await settled();
    assert.equal(editor.body, expected, action);
    if (action !== "close") await close();
  }
});

test("code, existing link destinations, multi-line text and non-web URLs keep normal paste behavior", async () => {
  for (const [body, position] of [
    ["```text\n\n```", 8], ["```\n", 4], ["    code", 8], ["`code`", 3], ["`unfinished", 11],
    ["[label](target)", 10], ["[label](", 8], ["[[Note]]", 4], ["<https://example.com>", 10]
  ] as const) {
    const { editor, close } = fixture(body);
    try {
      editor.view.dispatch({ selection: { anchor: position } });
      paste(editor.view, url);
      await settled();
      assert.equal(urlRequests.calls.length, 0, body);
      assert.ok(editor.body.includes(url), body);
    } finally { await close(); }
  }
  for (const text of [`${url}\n${url}`, `Read ${url}`, `[Existing](${url})`, "file:///tmp/test", "javascript:alert(1)", "https://user:password@example.com"]) {
    const { editor, close } = fixture();
    try {
      paste(editor.view, text);
      await settled();
      assert.equal(editor.body, text);
      assert.equal(urlRequests.calls.length, 0);
    } finally { await close(); }
  }
});

test("pasting after a completed link still resolves titles; clipboard files retain priority", async () => {
  const { editor, close } = fixture("[Earlier](https://example.org) ");
  try {
    paste(editor.view, url);
    await until(() => editor.body.includes("[A useful"));
    assert.equal(editor.body, `[Earlier](https://example.org) [A useful article](${url})`);
    editor.setBody("");
    urlRequests.calls = [];
    paste(editor.view, url, [new File(["photo"], "photo.png", { type: "image/png" })]);
    await until(() => !editor.pending);
    assert.equal(editor.body, "![[photo.png]]");
    assert.equal(urlRequests.calls.length, 0);
  } finally { await close(); }
});

test("lookups time out without blocking editing or applying a late title", async () => {
  const finish = deferred();
  const parent = document.body.createDiv();
  const view = new EditorView({ parent, state: EditorState.create({ extensions: [history(), markdown(), urlPaste(10)] }) });
  try {
    paste(view, url);
    await new Promise(resolve => setTimeout(resolve, 30));
    finish();
    await settled();
    assert.equal(view.state.doc.toString(), url);
  } finally { view.destroy(); parent.remove(); }
});

test("simultaneous identical URLs are tracked by range and can finish in either order", async () => {
  const finishes: ((html: string) => void)[] = [];
  urlRequests.respond = () => new Promise(resolve => finishes.push(html => resolve(response(html))));
  const { editor, close } = fixture();
  try {
    paste(editor.view, url);
    editor.insert("\n");
    paste(editor.view, url);
    finishes[1]("<title>Second</title>");
    await until(() => editor.body.includes("[Second]"));
    finishes[0]("<title>First</title>");
    await until(() => editor.body.startsWith("[First]"));
    assert.equal(editor.body, `[First](${url})\n[Second](${url})`);
  } finally { await close(); }
});

test("mobile paste works in capture and Edit, saving normal Markdown with an empty next draft", async () => {
  Platform.isDesktopApp = false;
  const app = new App();
  const plugin = new KarpathyPlugin(app, { id: "karpathy" });
  plugin.settings = structuredClone(DEFAULT_SETTINGS);
  plugin.store = new Store(app, "Karpathy");
  plugin.changed = () => plugin.store.reindex();
  const stream = new KarpathyView({ app }, plugin);
  await stream.onOpen();
  try {
    const editor = stream["editor"]!;
    paste(editor.view, url);
    await until(() => editor.body.startsWith("["));
    for (let i = 0; i < 3; i++) editor.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await until(() => editor.body === "" && plugin.store.files.length === 1);
    assert.equal((await plugin.store.entries(plugin.store.files[0]))[0].body, `[A useful article](${url})`);
    assert.equal(editor.view.state.selection.main.head, 0);
    stream.contentEl.querySelector<HTMLButtonElement>('[aria-label="Edit entry"]')!.click();
    const modal = document.querySelector<HTMLElement>(".karpathy-edit-modal")!;
    const edit = EditorView.findFromDOM(modal.querySelector(".cm-editor")!)!;
    edit.dispatch({ changes: { from: 0, to: edit.state.doc.length, insert: "" } });
    paste(edit, "https://example.com/edited");
    await until(() => edit.state.doc.toString().startsWith("["));
    modal.querySelector<HTMLButtonElement>(".mod-cta")!.click();
    await until(() => !modal.isConnected);
    assert.equal((await plugin.store.entries(plugin.store.files[0]))[0].body, "[A useful article](https://example.com/edited)");
  } finally { await stream.onClose(); Platform.isDesktopApp = true; }
});
