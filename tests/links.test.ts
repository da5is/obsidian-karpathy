import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { EditorView } from "@codemirror/view";
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

test("prewarmed suggestions are shared by editors and restored from device-local storage", async () => {
  const app = new App();
  const file = await app.vault.create("Reference/Note.md", "body");
  app.fileCaches.set(file.path, { frontmatter: { aliases: ["Alias"] } });
  const first = new WikilinkIndex(app as any);
  await first.prepare();
  const one = (await first.source(() => "one.md")(context("[[")))!;
  const two = (await first.source(() => "two.md")(context("[[")))!;
  assert.equal(one.options, two.options);
  await first.close();
  const reads = app.cacheReads;
  const second = new WikilinkIndex(app as any);
  await second.prepare();
  assert.equal(app.cacheReads, reads);
  assert.ok((await second.source(() => "other.md")(context("[[")))!.options.some(option => option.label === "Alias"));
  app.fileCaches.set(file.path, { frontmatter: { aliases: ["Changed offline"] } });
  await second.reconcile();
  const latest = (await second.source(() => "other.md")(context("[[")))!;
  assert.ok(latest.options.some(option => option.label === "Changed offline"));
  assert.ok(!latest.options.some(option => option.label === "Alias"));
  await second.close();
});

test("persisted link records prune deletions and refresh stat changes without reading note bodies", async () => {
  const app = new App();
  const removed = await app.vault.create("Removed.md", "body");
  const changed = await app.vault.create("Changed.md", "body");
  const first = new WikilinkIndex(app as any); await first.prepare(); await first.close();
  app.vault.files.delete(removed.path);
  changed.stat.mtime++;
  app.fileCaches.set(changed.path, { frontmatter: { aliases: ["Updated"] } });
  const second = new WikilinkIndex(app as any); await second.prepare();
  const options = (await second.source(() => "draft.md")(context("[[")))!.options;
  assert.ok(!options.some(option => option.label === "Removed"));
  assert.ok(options.some(option => option.label === "Updated"));
  assert.equal(app.vault.reads, 0);
  await second.close();
});

test("shared options apply relative to the invoking editor's current source path", async () => {
  const app = new App();
  await app.vault.create("Reference/Note.md", "body");
  const index = new WikilinkIndex(app as any);
  const first = new EditorView({ state: context("[[No").state, parent: document.body });
  const second = new EditorView({ state: context("[[No").state, parent: document.body });
  let path = "First.md";
  try {
    const one = (await index.source(() => path)(new CompletionContext(first.state, 4, true, first)))!;
    const two = (await index.source(() => "Second.md")(new CompletionContext(second.state, 4, true, second)))!;
    assert.equal(one.options, two.options);
    path = "Renamed.md";
    const choice = one.options[0];
    assert.equal(typeof choice.apply, "function");
    (choice.apply as Function)(second, choice, 2, 4);
    (choice.apply as Function)(first, choice, 2, 4);
    assert.deepEqual(app.linkRequests.map(request => request.source), ["Second.md", "Renamed.md"]);
    assert.equal(first.state.doc.toString(), "[[Note]]");
  } finally { first.destroy(); second.destroy(); await index.close(); }
});

test("metadata-only reconciliation is shared and body edits retain prepared options", async () => {
  const app = new App();
  const file = await app.vault.create("Note.md", "body");
  const index = new WikilinkIndex(app as any);
  const source = index.source(() => "draft.md");
  const before = (await source(context("[[")))!.options;
  file.stat.mtime++;
  index.changed(file);
  assert.equal((await source(context("[[")))!.options, before);
  const listings = app.vault.listings;
  await Promise.all([index.reconcile(), index.reconcile(), index.reconcile()]);
  assert.equal(app.vault.listings, listings + 1);
  await index.close();
});
