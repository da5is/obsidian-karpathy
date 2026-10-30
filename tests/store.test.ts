import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { App, closeDOM, TFile } from "./obsidian-mock";
import { entryPath, parseEntries, serializeEntry, uniqueId } from "../src/model";
import { Store } from "../src/store";

after(closeDOM);
function fixture(base = "Karpathy") { const app = new App(); return { app, store: new Store(app as any, base) }; }
const date = new Date(2026, 9, 25, 12);
async function find(store: Store, id: string) {
  await store.countEntries();
  for (const file of store.files) { const entry = (await store.entries(file))[0]; if (entry?.id === id) return entry; }
  throw new Error("Missing " + id);
}

test("each capture creates an independent file, including the vault root; retries are idempotent", async () => {
  const { app, store } = fixture("");
  await Promise.all(Array.from({ length: 25 }, (_, i) => store.capture("entry " + i, date, "id-" + i)));
  assert.equal(await store.countEntries(), 25);
  assert.equal(app.vault.getMarkdownFiles().length, 25);
  const path = entryPath("", date, "id-4");
  assert.equal(parseEntries(app.vault.texts.get(path)!, path)[0].body, "entry 4");
  await store.capture("entry 4", date, "id-4");
  assert.equal(await store.countEntries(), 25);
  await assert.rejects(() => store.capture("different", date, "id-4"), /different version/);
  await store.close();
});
test("rescue updates one permanent file atomically and preserves relative links, creation and properties", async () => {
  const { app, store } = fixture();
  const original = new Date(2025, 11, 31, 23);
  await store.capture("[[../reference]]\n![[attachments/photo.png]]", original, "rescue");
  const entry = await find(store, "rescue");
  await store.rescue(entry, date);
  const rescued = await find(store, "rescue");
  assert.equal(rescued.path, entry.path);
  assert.equal(rescued.created, original.toISOString());
  assert.equal(rescued.timestamp, date.toISOString());
  assert.equal(rescued.body, entry.body); assert.equal(rescued.rescues, 1);
  await store.rescue(rescued, new Date(2027, 0, 1));
  assert.equal((await find(store, "rescue")).rescues, 2);
  assert.equal(app.vault.getMarkdownFiles().length, 1);
  assert.equal(app.local.has("karpathy:rescue:Karpathy"), false);
  await store.close();
});
test("failed rescue leaves the original intact; retry does not create or move a file", async () => {
  const { app, store } = fixture();
  await store.capture("durable", date, "rescue");
  const entry = await find(store, "rescue"); const before = app.vault.texts.get(entry.path);
  app.vault.failWrites = true;
  await assert.rejects(() => store.rescue(entry), /Disk full/);
  assert.equal(app.vault.texts.get(entry.path), before);
  app.vault.failWrites = false;
  await store.rescue(entry);
  assert.equal((await find(store, "rescue")).rescues, 1);
  assert.equal(app.vault.getMarkdownFiles().length, 1);
  await store.close();
});
test("stale edits, rescue and deletion preserve externally changed content", async () => {
  const { app, store } = fixture();
  await store.capture("original", date, "entry"); await store.capture("neighbor", date, "other");
  const entry = await find(store, "entry"); const neighbor = await find(store, "other");
  const untouched = app.vault.texts.get(neighbor.path);
  await store.update(entry, "changed elsewhere");
  await assert.rejects(() => store.update(entry, "stale"), /changed elsewhere/);
  await assert.rejects(() => store.rescue(entry), /changed elsewhere/);
  await assert.rejects(() => store.remove(entry), /changed elsewhere/);
  assert.equal(app.vault.texts.get(neighbor.path), untouched);
  assert.equal((await find(store, "entry")).body, "changed elsewhere");
  await store.close();
});
test("delete trashes just the entry file, retains attachments, and cannot be restored by the index", async () => {
  const { app, store } = fixture();
  const image = await store.attachment(new File(["photo"], "image.png", { type: "image/png" }), date);
  await store.capture(image, date, "remove"); await store.capture("keep", date, "keep");
  const entry = await find(store, "remove");
  app.vault.failWrites = true;
  await assert.rejects(() => store.remove(entry), /Disk full/);
  assert.equal(await store.countEntries(), 2);
  app.vault.failWrites = false;
  await store.remove(entry);
  assert.equal(app.vault.getAbstractFileByPath(entry.path), null);
  assert.equal(app.vault.binaries.size, 1);
  assert.equal(await store.countEntries(), 1);
  await store.close();
  const reopened = new Store(app as any, "Karpathy");
  assert.equal(await reopened.countEntries(), 1);
  assert.equal((await reopened.page({ file: 0, offset: 0 }, 1, "image")).entries.length, 0);
  await reopened.close();
});
test("forward and backward pages cover history in rescue order without gaps", async () => {
  const { store } = fixture();
  for (let i = 0; i < 80; i++) await store.capture("entry " + i, new Date(2026, 9, 1, 0, i), "id-" + i);
  await store.rescue(await find(store, "id-0"), date);
  let cursor = { file: 0, offset: 0 }, exhausted = false;
  const ids: string[] = [];
  while (!exhausted) { const page = await store.page(cursor, 1, "", 13); ids.push(...page.entries.map(entry => entry.id)); cursor = page.end; exhausted = page.exhausted; }
  assert.equal(ids.length, 80); assert.equal(new Set(ids).size, 80); assert.equal(ids[0], "id-0");
  const backwards: string[] = []; exhausted = false;
  while (!exhausted) { const page = await store.page(cursor, -1, "", 13); backwards.unshift(...page.entries.map(entry => entry.id)); cursor = page.start; exhausted = page.exhausted; }
  assert.deepEqual(backwards, ids);
  await store.close();
});
test("local index survives reopening, counts without reading bodies and skips nonmatching files", async () => {
  const { app, store } = fixture();
  for (let i = 0; i < 90; i++) await store.capture(i === 1 ? "read: distant book" : "ordinary", new Date(2026, 9, 1, 0, i), "id-" + i);
  await store.close();
  const before = app.vault.reads;
  const reopened = new Store(app as any, "Karpathy");
  assert.equal(await reopened.countEntries(), 90); assert.equal(app.vault.reads, before);
  const page = await reopened.page({ file: 0, offset: 0 }, 1, "read: book");
  assert.equal(page.entries[0].id, "id-1"); assert.equal(app.vault.reads - before, 1);
  assert.equal(page.exhausted, true);
  await reopened.close();
});
test("batched search pages stop at the exact match and can traverse backward without losing buffered matches", async () => {
  const { store } = fixture();
  for (let i = 0; i < 100; i++) await store.capture(i % 2 ? "matching" : "unrelated", new Date(2026, 9, 1, 0, i), "entry-" + i);
  const expected = Array.from({ length: 50 }, (_, i) => "entry-" + (99 - i * 2));
  let cursor = { file: 0, offset: 0 }, exhausted = false;
  const found: string[] = [];
  while (!exhausted) {
    const page = await store.page(cursor, 1, "matching", 7);
    assert.ok(page.entries.length <= 7);
    found.push(...page.entries.map(entry => entry.id)); cursor = page.end; exhausted = page.exhausted;
  }
  assert.deepEqual(found, expected);
  const backwards: string[] = []; exhausted = false;
  while (!exhausted) {
    const page = await store.page(cursor, -1, "matching", 7);
    backwards.unshift(...page.entries.map(entry => entry.id)); cursor = page.start; exhausted = page.exhausted;
  }
  assert.deepEqual(backwards, expected);
  assert.deepEqual((await store.page({ file: 0, offset: 0 }, 1, "matching", 7, () => false)).entries, []);
  await store.close();
});
test("external create, same-stat modify, rename and delete invalidate local indexes", async () => {
  const { app, store } = fixture();
  await store.capture("original", date, "entry"); const entry = await find(store, "entry");
  app.vault.texts.set(entry.path, serializeEntry(entry.id, entry.timestamp, "external"));
  store.invalidate(entry.path);
  assert.equal((await store.page({ file: 0, offset: 0 }, 1, "external")).entries[0].body, "external");
  const copied = entry.path.replace(".md", " (conflict).md");
  await app.vault.create(copied, serializeEntry(entry.id, entry.timestamp, "other version")); store.invalidate(copied);
  assert.equal(await store.countEntries(), 2);
  assert.equal((await store.page({ file: 0, offset: 0 }, 1, "other version")).entries[0].path, copied);
  const newPath = entryPath("Karpathy", date, "renamed");
  await app.vault.create(newPath, app.vault.texts.get(entry.path)!);
  await app.vault.trash(app.vault.getAbstractFileByPath(entry.path) as TFile, true);
  store.invalidate(entry.path); store.invalidate(newPath);
  assert.equal(await store.countEntries(), 2);
  assert.ok(!store.files.some(file => file.path === entry.path));
  await store.close();
});
test("cache loss rebuilds from Markdown and malformed files never overwrite notes", async () => {
  const { app, store } = fixture();
  await store.capture("valid", date, "entry");
  const invalid = entryPath("Karpathy", date, "invalid");
  await app.vault.create(invalid, "---\nkarpathy: 2\n---\ninvalid"); store.invalidate(invalid);
  await app.vault.create("Karpathy/2026/2026-10/2026-10-25.md", "legacy daily file"); store.reindex();
  store.clear();
  assert.equal(await store.countEntries(), 1);
  assert.equal((await store.page({ file: 0, offset: 0 }, 1, "valid")).entries[0].body, "valid");
  assert.equal(app.vault.texts.get(invalid), "---\nkarpathy: 2\n---\ninvalid");
  await store.close();
});
test("changing the base never mixes or moves entry files", async () => {
  const { app, store } = fixture();
  await store.capture("first", date, "entry"); const original = store.files[0].path;
  store.base = ""; store.clear(); store.reindex();
  assert.equal(await store.countEntries(), 0);
  await store.capture("root", date, "root"); assert.equal(await store.countEntries(), 1);
  assert.ok(app.vault.texts.has(original));
  await store.close();
});
test("attachment names are readable and unique across independent offline devices", async () => {
  const one = fixture(), two = fixture();
  const file = new File(["photo"], "image.png", { type: "image/png" });
  const a = await one.store.attachment(file, date), b = await two.store.attachment(file, date);
  assert.notEqual(a, b); assert.match(a, /^!\[\[Karpathy\/2026\/2026-10\/attachments\/image-\d{17}-[a-f0-9]{12}\.png\]\]$/);
  const link = await one.store.attachment(new File(["pdf"], "CON.pdf"), date);
  assert.match(link, /\/_CON-/); assert.match(link, /\|_CON.pdf\]\]$/);
  const unsafe = await one.store.attachment(new File(["pdf"], "file#[x]|.pdf"), date);
  assert.ok(!unsafe.includes("file#[")); assert.equal(one.app.vault.binaries.size, 3);
  await one.store.close(); await two.store.close();
});
test("independent offline captures combine without sharing a daily write target", async () => {
  const one = fixture(), two = fixture();
  const idA = uniqueId(), idB = uniqueId();
  await one.store.capture("phone capture", date, idA); await two.store.capture("desktop capture", date, idB);
  for (const [path, text] of two.app.vault.texts) { await one.app.vault.create(path, text); one.store.invalidate(path); }
  assert.equal(await one.store.countEntries(), 2);
  assert.deepEqual(new Set((await one.store.page({ file: 0, offset: 0 }, 1, "")).entries.map(entry => entry.body)), new Set(["phone capture", "desktop capture"]));
  await one.store.close(); await two.store.close();
});
test("failed writes and occupied paths preserve data and permit retry", async () => {
  const { app, store } = fixture();
  app.vault.failWrites = true;
  await assert.rejects(() => store.capture("draft", date, "retry"), /Disk full/);
  app.vault.failWrites = false; await store.capture("draft", date, "retry");
  assert.equal((await find(store, "retry")).body, "draft");
  const path = entryPath("Karpathy", date, "blocked"); await app.vault.createFolder(path);
  await assert.rejects(() => store.capture("draft", date, "blocked"), /folder occupies/);
  await store.close();
});

test("oversized attachments reject before allocating their contents", async () => {
  const app = new App(), store = new Store(app as any, "Karpathy");
  let allocated = false;
  const large = { name: "large.bin", size: 51 * 1024 * 1024, type: "application/octet-stream", arrayBuffer: async () => { allocated = true; return new ArrayBuffer(0); } } as File;
  await assert.rejects(store.attachment(large, new Date()), /50 MiB/);
  assert.equal(allocated, false);
  assert.equal(app.vault.getFiles().length, 0);
  await store.close();
});
