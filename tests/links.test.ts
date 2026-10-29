import assert from "node:assert/strict";
import { after, test } from "node:test";
import { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { App, closeDOM, TFolder } from "./obsidian-mock";
import { WikilinkIndex, wikilinkRange } from "../src/links";

after(closeDOM);

function context(doc: string, pos = doc.length) {
  return new CompletionContext(EditorState.create({ doc, selection: { anchor: pos }, extensions: [markdown()] }), pos, false);
}

test("wikilinks offer vault-wide files and aliases without reading note contents", async () => {
  const app = new App();
  await app.vault.create("Reference/Project Alpha.md", "private note content");
  await app.vault.create("Other/Project Alpha.md", "second file");
  await app.vault.createBinary("Images/photo.png", new ArrayBuffer(1));
  app.fileCaches.set("Reference/Project Alpha.md", { frontmatter: { aliases: ["Alpha", "Alpha", "A | bad alias"] } });
  const source = new WikilinkIndex(app).source(() => "Karpathy/2026/2026-10/2026-10-29.md");
  const result = await source(context("[["));
  assert.ok(result);
  assert.equal(result.options.length, 4);
  assert.equal(result.options.filter(option => option.displayLabel === "Project Alpha").length, 2);
  assert.ok(result.options.some(option => option.label === "Alpha" && option.detail === "Reference/Project Alpha.md"));
  assert.ok(result.options.some(option => option.label === "photo.png"));
  const reads = app.cacheReads, listings = app.vault.listings;
  for (const word of ["P", "Pr", "Proj", "Alpha"]) {
    const next = await source(context(`[[${word}`));
    assert.equal(next!.options, result.options);
  }
  assert.equal(app.vault.reads, 0);
  assert.equal(app.cacheReads, reads);
  assert.equal(app.vault.listings, listings);
  const paths = await source(context("[[Reference/"));
  assert.ok(paths!.options.some(option => option.label === "Reference/Project Alpha"));
});

test("file and metadata changes invalidate suggestions, including folder moves", async () => {
  const app = new App();
  const file = await app.vault.create("Outside/First.md", "");
  const index = new WikilinkIndex(app);
  const source = index.source(() => "day.md");
  const first = (await source(context("[[")))!;
  app.fileCaches.set(file.path, { frontmatter: { aliases: "New alias" } });
  index.changed(file);
  assert.equal((first.validFor as Function)("", 2, 2, context("[[").state), false);
  assert.ok((await source(context("[[")))!.options.some(option => option.label === "New alias"));
  const oldPath = file.path;
  app.vault.files.delete(oldPath);
  file.path = "Outside/Renamed.md"; file.name = "Renamed.md"; file.basename = "Renamed";
  app.vault.files.set(file.path, file);
  index.changed(file, oldPath);
  assert.deepEqual((await source(context("[[")))!.options.map(option => option.label), ["Renamed"]);
  const added = await app.vault.create("New.md", "");
  index.changed(added);
  assert.equal((await source(context("[[")))!.options.length, 2);
  app.vault.files.delete(added.path);
  index.changed(added);
  assert.equal((await source(context("[[")))!.options.length, 1);
  app.vault.files.delete(file.path);
  file.path = "Moved/Renamed.md";
  app.vault.files.set(file.path, file);
  index.changed(Object.assign(new TFolder(), { path: "Moved" }), "Outside");
  assert.equal((await source(context("[[")))!.options[0].detail, "Moved/Renamed.md");
});

test("completion skips code, escaped links, headings, aliases and closed links", () => {
  for (const doc of ["plain text", "\\[[Note", "[[Note]]", "[[Note#Heading", "[[Note^block", "[[Note|alias", "[[[Note", "`[[Note`", "```md\n[[Note\n```", "    [[Note", "<!-- [[Note -->"]) {
    const pos = doc === "`[[Note`" ? doc.length - 1 : doc.startsWith("```") ? doc.indexOf("Note") + 4 : doc.startsWith("<!--") ? doc.indexOf("Note") + 4 : doc.length;
    assert.equal(wikilinkRange(context(doc, pos).state, pos), null, doc);
  }
  for (const doc of ["[[", "[[Note", "a [[Note", "![[photo", "\\\\[[Note", "[[done]] then [[Next"]) {
    assert.ok(wikilinkRange(context(doc).state, doc.length), doc);
  }
});

test("completion replaces an existing filename and preserves heading and display text", () => {
  const doc = "See [[Old#Section|My label]] today";
  const pos = doc.indexOf("Old") + 2;
  const range = wikilinkRange(context(doc, pos).state, pos)!;
  assert.equal(range.from, doc.indexOf("Old"));
  assert.equal(range.end, doc.indexOf(" today"));
  assert.equal(range.suffix, "#Section|My label");
});

test("a warm index reuses suggestions for a large vault", async () => {
  const app = new App();
  for (let i = 0; i < 10000; i++) await app.vault.create(`Reference/Note ${i}.md`, "");
  const source = new WikilinkIndex(app).source(() => "day.md");
  const first = await source(context("[[Note")) as CompletionResult;
  assert.equal(first.options.length, 10000);
  const reads = app.cacheReads;
  const started = performance.now();
  for (let i = 0; i < 100; i++) assert.equal((await source(context(`[[Note ${i}`)))!.options, first.options);
  console.log(`100 warm completion queries over 10,000 files: ${(performance.now() - started).toFixed(1)}ms`);
  assert.equal(app.cacheReads, reads);
  assert.equal(app.vault.listings, 1);
  assert.equal(app.vault.reads, 0);
});
