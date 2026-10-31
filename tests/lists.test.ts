import assert from "node:assert/strict";
import { after, test } from "node:test";
import { EditorView } from "@codemirror/view";
import { closeDOM } from "./obsidian-mock";
import { CaptureEditor } from "../src/editor";

after(closeDOM);

function fixture(body: string, tripleEnter = true) {
  const host = document.body.createDiv();
  const saved: string[] = [];
  const editor = new CaptureEditor(host, {
    body, colors: {}, tripleEnter, change: () => {},
    save: () => { saved.push(editor.body.trimEnd()); editor.setBody(""); editor.focus(); },
    upload: async () => [], error: error => { throw error; }, busy: () => {}
  });
  editor.view.dispatch({ selection: { anchor: body.length } });
  editor.focus();
  return { editor, saved, close: async () => { await editor.destroy(); host.remove(); } };
}

function enter(editor: CaptureEditor, shiftKey = false) {
  editor.view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true, shiftKey }));
}

test("bullets continue, an empty bullet exits to a paragraph, and the fourth Enter saves", async () => {
  for (const marker of ["-", "*", "+"]) {
    const { editor, saved, close } = fixture(`${marker} first`);
    try {
      enter(editor);
      assert.equal(editor.body, `${marker} first\n${marker} `);
      editor.insert("second");
      enter(editor);
      assert.equal(editor.body, `${marker} first\n${marker} second\n${marker} `);
      enter(editor);
      assert.equal(editor.body, `${marker} first\n${marker} second\n\n`);
      assert.equal(saved.length, 0);
      enter(editor);
      assert.equal(saved.length, 0);
      enter(editor);
      assert.deepEqual(saved, [`${marker} first\n${marker} second`]);
      assert.equal(editor.body, "");
      assert.equal(editor.view.state.selection.main.head, 0);
      assert.equal(editor.view.hasFocus, true);
    } finally { await close(); }
  }
});

test("ordered lists increment their number and checklists continue unchecked", async () => {
  for (const [body, marker] of [["1. first", "2. "], ["8) first", "9) "], ["- [x] done", "- [ ] "], ["- [ ] task", "- [ ] "]]) {
    const { editor, saved, close } = fixture(body);
    try {
      enter(editor);
      assert.equal(editor.body, `${body}\n${marker}`);
      enter(editor);
      assert.equal(editor.body, `${body}\n\n`);
      assert.equal(saved.length, 0);
      editor.insert("A paragraph after the list");
      assert.equal(editor.body, `${body}\n\nA paragraph after the list`);
    } finally { await close(); }
  }
});

test("nested bullets keep indentation and an empty item exits one level at a time", async () => {
  const { editor, saved, close } = fixture("- parent\n  - child");
  try {
    enter(editor);
    assert.equal(editor.body, "- parent\n  - child\n  - ");
    enter(editor);
    assert.equal(editor.body, "- parent\n  - child\n- ");
    enter(editor);
    assert.equal(editor.body, "- parent\n  - child\n\n");
    assert.equal(saved.length, 0);
    editor.insert("Outside the list");
    assert.equal(editor.body, "- parent\n  - child\n\nOutside the list");
  } finally { await close(); }
});

test("Enter splits a list item at the cursor and renumbers following ordered items", async () => {
  const { editor, close } = fixture("1. firstsecond\n2. third");
  try {
    editor.view.dispatch({ selection: { anchor: 8 } });
    enter(editor);
    assert.equal(editor.body, "1. first\n2. second\n3. third");
    assert.equal(editor.view.state.selection.main.head, "1. first\n2. ".length);
  } finally { await close(); }
});

test("Shift+Enter inserts only a newline; code and escaped bullets are not continued", async () => {
  const { editor, close } = fixture("- first");
  try {
    enter(editor, true);
    assert.equal(editor.body, "- first\n");
    for (const body of ["```text\n- code", "    - code", "\\- plain text"]) {
      editor.setBody(body);
      editor.view.dispatch({ selection: { anchor: body.length } });
      enter(editor);
      assert.equal(editor.view.state.doc.line(editor.view.state.doc.lines).text.trim(), "", body);
      assert.ok(editor.body.startsWith(`${body}\n`));
    }
  } finally { await close(); }
});

test("Edit uses the same list behavior without submitting on Enter", async () => {
  const { editor, saved, close } = fixture("- original", false);
  try {
    enter(editor);
    assert.equal(editor.body, "- original\n- ");
    enter(editor);
    assert.equal(editor.body, "- original\n\n");
    enter(editor);
    assert.equal(editor.body, "- original\n\n\n");
    assert.equal(saved.length, 0);
  } finally { await close(); }
});

test("keyboards that deliver only native newline input continue and exit lists without a stray newline", async () => {
  const { editor, saved, close } = fixture("- mobile");
  const nativeEnter = () => {
    const view = editor.view;
    const { from, to } = view.state.selection.main;
    const insert = () => view.state.update({ changes: { from, to, insert: "\n" }, selection: { anchor: from + 1 }, userEvent: "input.type" });
    if (!view.state.facet(EditorView.inputHandler).some(handler => handler(view, from, to, "\n", insert))) view.dispatch(insert());
  };
  try {
    nativeEnter();
    assert.equal(editor.body, "- mobile\n- ");
    nativeEnter();
    assert.equal(editor.body, "- mobile\n\n");
    assert.equal(saved.length, 0);
    nativeEnter();
    assert.equal(saved.length, 0);
    nativeEnter();
    assert.deepEqual(saved, ["- mobile"]);
    assert.equal(editor.body, "");
    assert.equal(editor.view.state.selection.main.head, 0);
  } finally { await close(); }
});

test("existing trailing newlines and restored empty bullets never shorten the three-Enter gesture", async () => {
  for (const body of ["![[photo.png]]\n", "![[photo.png]]\n\n", "- item\n- ", "- item\n\n"]) {
    const { editor, saved, close } = fixture(body);
    try {
      enter(editor);
      assert.equal(saved.length, 0, `first Enter: ${body}`);
      enter(editor);
      assert.equal(saved.length, 0, `second Enter: ${body}`);
      enter(editor);
      assert.equal(saved.length, 1, `third Enter: ${body}`);
      assert.equal(editor.body, "");
      assert.equal(editor.view.state.selection.main.head, 0);
    } finally { await close(); }
  }
});

test("Shift+Enter and moving the cursor interrupt the submission gesture", async () => {
  const { editor, saved, close } = fixture("note");
  try {
    enter(editor, true);
    enter(editor);
    enter(editor);
    assert.equal(saved.length, 0);
    editor.view.dispatch({ selection: { anchor: 0 } });
    editor.view.dispatch({ selection: { anchor: editor.body.length } });
    enter(editor);
    enter(editor);
    assert.equal(saved.length, 0);
    enter(editor);
    assert.equal(saved.length, 1);
  } finally { await close(); }
});

test("finishing an attachment resets prior Enter presses and preserves a fresh three-Enter gesture", async () => {
  const { editor, saved, close } = fixture("- item");
  let finish!: (links: string[]) => void;
  editor["options"].upload = () => new Promise(resolve => { finish = resolve; });
  try {
    enter(editor);
    editor.attach([new File(["image"], "photo.png", { type: "image/png" })]);
    for (let i = 0; i < 20 && !finish; i++) await new Promise(resolve => setTimeout(resolve, 5));
    finish(["![[photo.png]]\n"]);
    for (let i = 0; i < 20 && editor.pending; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(editor.pending, 0);
    enter(editor);
    enter(editor);
    assert.equal(saved.length, 0);
    enter(editor);
    assert.equal(saved.length, 1);
    assert.ok(saved[0].includes("![[photo.png]]"));
    assert.equal(editor.body, "");
  } finally { await close(); }
});

test("image departure takes an extra Enter before the three-Enter save gesture", async () => {
  for (const body of ["![[photo.png]]", "![photo](images/photo.png)", "![[photo.png|250]]", "![photo](https://example.com/a_(b).png)"]) {
    const { editor, saved, close } = fixture(body);
    try {
      for (let i = 0; i < 3; i++) { enter(editor); assert.equal(saved.length, 0, `${body}, press ${i + 1}`); }
      enter(editor);
      assert.deepEqual(saved, [body]);
      assert.equal(editor.body, "");
    } finally { await close(); }
  }
});

test("ordered, task, and nested lists allow a blank paragraph before sending", async () => {
  for (const body of ["1. task", "- [ ] task", "- parent\n  - child"]) {
    const { editor, saved, close } = fixture(body);
    try {
      const presses = body.includes("child") ? 5 : 4;
      for (let i = 1; i < presses; i++) { enter(editor); assert.equal(saved.length, 0); }
      enter(editor);
      assert.deepEqual(saved, [body]);
    } finally { await close(); }
  }
});

test("pasted image without trailing spacing uses four Enters while ordinary text still uses three", async () => {
  const { editor, saved, close } = fixture("");
  editor["options"].upload = async () => ["![[photo.png]]"];
  try {
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: { files: [new File(["image"], "photo.png", { type: "image/png" })] } });
    editor.view.contentDOM.dispatchEvent(paste);
    for (let i = 0; i < 20 && editor.pending; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(editor.body, "![[photo.png]]");
    for (let i = 0; i < 3; i++) { enter(editor); assert.equal(saved.length, 0); }
    enter(editor);
    assert.equal(saved.length, 1);
    editor.insert("plain text");
    enter(editor); enter(editor);
    assert.equal(saved.length, 1);
    enter(editor);
    assert.deepEqual(saved, ["![[photo.png]]", "plain text"]);
  } finally { await close(); }
});
