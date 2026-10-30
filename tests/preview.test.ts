import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDOM } from "./obsidian-mock";
import { CaptureEditor } from "../src/editor";

after(closeDOM);

function fixture(body: string) {
  const host = document.body.createDiv({ cls: "karpathy-editor" });
  const editor = new CaptureEditor(host, {
    body, colors: {}, tripleEnter: true, change: () => {}, save: () => {},
    upload: async () => [], error: error => { throw error; }, busy: () => {}
  });
  return { editor, host, close: async () => { await editor.destroy(); host.remove(); } };
}

test("live headings follow native theme levels without styling code or changing Markdown", async () => {
  const body = [1, 2, 3, 4, 5, 6].map(level => `${"#".repeat(level)} Heading ${level}`).join("\n\n")
    + "\n\n```md\n# Code, not a heading\n```\n\n    ## Indented code\n\n\\# Escaped heading";
  const { editor, host, close } = fixture(body);
  try {
    const headings = [...host.querySelectorAll(".HyperMD-header")];
    assert.equal(headings.length, 6);
    headings.forEach((heading, index) => assert.ok(heading.classList.contains(`HyperMD-header-${index + 1}`)));
    assert.equal(editor.body, body);
    editor.view.dispatch({ changes: { from: 0, to: 1, insert: "##" } });
    assert.ok(host.querySelector(".cm-line")!.classList.contains("HyperMD-header-2"));
    assert.equal(editor.body, "#" + body);
  } finally { await close(); }
});

test("Setext headings use their native theme level and keep their source intact", async () => {
  const body = "First heading\non two lines\n===\n\nSecond heading\n---\n\nPlain paragraph";
  const { editor, host, close } = fixture(body);
  try {
    assert.equal(host.querySelectorAll(".HyperMD-header-1").length, 2);
    assert.equal(host.querySelectorAll(".HyperMD-header-2").length, 1);
    assert.equal(editor.body, body);
  } finally { await close(); }
});

test("large drafts use source mode and retain exact text through threshold crossings", async () => {
  const body = "x".repeat(100001);
  const { editor, host, close } = fixture(body);
  try {
    assert.equal(editor.body, body);
    assert.ok(!host.querySelector(".cm-lineWrapping"));
    editor.setBody("# Small again");
    assert.ok(host.querySelector(".cm-lineWrapping"));
    assert.ok(host.querySelector(".HyperMD-header-1"));
    assert.equal(editor.body, "# Small again");
  } finally { await close(); }
});
