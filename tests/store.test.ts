import assert from "node:assert/strict";
import { after, test } from "node:test";
import { App, closeDOM, TFile } from "./obsidian-mock";
import { dailyPath, parseEntries, serializeEntry } from "../src/model";
import { Store } from "../src/store";

after(closeDOM);

test("root storage supports attachments, capture, search, rescue and reopening", async () => {
  const app = new App();
  const store = new Store(app, "");
  const date = new Date(2026, 8, 30, 12);
  const link = await store.attachment(new File(["image"], "photo.png", { type: "image/png" }), date);
  assert.equal(link, "![[2026/2026-09/attachments/photo.png]]");
  await store.capture(`read: root capture\n\n${link}`, date, "root-entry");
  await app.vault.create("unrelated.md", "Keep this ordinary note");
  const page = await store.page({ file: 0, offset: 0 }, 1, "root capture");
  assert.equal(page.entries.length, 1);
  const entry = page.entries[0];
  assert.equal(entry.path, "2026/2026-09/2026-09-30.md");
  await store.rescue(entry, new Date(2026, 9, 25, 12));
  const reopened = new Store(app, "");
  assert.equal(await reopened.countEntries(), 1);
  const moved = (await reopened.page({ file: 0, offset: 0 }, 1, "root capture")).entries[0];
  assert.equal(moved.path, "2026/2026-10/2026-10-25.md");
  assert.equal(moved.body, entry.body);
  assert.equal(moved.rescues, 1);
  assert.equal(app.vault.texts.get("unrelated.md"), "Keep this ordinary note");
});

test("header count totals entries, caches counts, and stays unchanged by rescue", async () => {
  const { app, store } = fixture();
  await store.capture("first", new Date(2026, 8, 1), "count-1");
  await store.capture("second", new Date(2026, 8, 1, 1), "count-2");
  await store.capture("third", new Date(2026, 8, 2), "count-3");
  assert.equal(await store.countEntries(), 3);
  const reads = app.vault.reads;
  assert.equal(await store.countEntries(), 3);
  assert.equal(app.vault.reads, reads);
  const entry = (await store.entries(store.files[1]))[0];
  await store.rescue(entry, new Date(2026, 9, 25));
  assert.equal(await store.countEntries(), 3);
  await store.capture("fourth", new Date(2026, 9, 25, 1), "count-4");
  assert.equal(await store.countEntries(), 4);
  assert.equal(await store.countEntries(() => false), null);
});

test("warm full-history searches skip disk reads for nonmatching days and invalidate changed days", async () => {
  const { app, store } = fixture();
  for (let day = 1; day <= 40; day++) await store.capture(`ordinary day ${day}`, new Date(2026, 8, day), `search-${day}`);
  const search = async (query: string) => {
    let cursor = { file: 0, offset: 0 };
    const results = [];
    for (;;) {
      const page = await store.page(cursor, 1, query);
      results.push(...page.entries);
      if (page.exhausted) return results;
      cursor = page.end;
    }
  };
  await search("missing");
  const reads = app.vault.reads;
  assert.equal((await search("another-missing-term")).length, 0);
  assert.equal(app.vault.reads, reads);
  const file = store.files.at(-1)!;
  app.vault.texts.set(file.path, serializeEntry("changed-search", new Date(2026, 8, 1).toISOString(), "another-missing-term"));
  store.invalidate(file.path);
  assert.equal((await search("another-missing-term")).length, 1);
  assert.equal(app.vault.reads, reads + 1);
});

test("rescue moves between months, retains identity and creation time, and preserves attachment links", async () => {
  const { app, store } = fixture();
  const original = new Date(2026, 8, 30, 12);
  await store.capture("idea: keep\n\n![[Karpathy/2026/2026-09/attachments/image.png]]", original, "rescue-me");
  const entry = (await store.entries(store.files[0]))[0];
  const now = new Date(2026, 9, 25, 15);
  await store.rescue(entry, now);
  assert.equal(parseEntries(app.vault.texts.get(entry.path)!, entry.path).length, 0);
  const moved = (await store.page({file: 0, offset: 0}, 1, "")).entries[0];
  assert.equal(moved.id, entry.id);
  assert.equal(moved.body, entry.body);
  assert.equal(moved.created, original.toISOString());
  assert.equal(moved.timestamp, now.toISOString());
  assert.equal(moved.rescues, 1);
  await store.rescue(moved, new Date(2026, 9, 25, 16));
  const again = (await store.entries(store.files[0]))[0];
  assert.equal(again.rescues, 2);
  assert.equal(again.created, original.toISOString());
  assert.equal((await store.entries(store.files[0])).length, 1);
  await store.update(again, "edited after rescue");
  assert.equal((await store.entries(store.files[0]))[0].created, original.toISOString());
});

test("interrupted rescue keeps the source and finishes once on restart", async () => {
  const { app, store } = fixture();
  await store.capture("durable", new Date(2026, 8, 30), "recover-me");
  const entry = (await store.entries(store.files[0]))[0];
  const process = app.vault.process.bind(app.vault);
  app.vault.process = async (file, work) => {
    if (file.path === entry.path) throw new Error("Interrupted source removal");
    return process(file, work);
  };
  await assert.rejects(() => store.rescue(entry, new Date(2026, 9, 25)), /Interrupted/);
  assert.equal(parseEntries(app.vault.texts.get(entry.path)!, entry.path).length, 1);
  app.vault.process = process;
  const reopened = new Store(app, "Karpathy");
  await reopened.recoverRescue();
  await reopened.recoverRescue();
  const entries = (await Promise.all(reopened.files.map(file => reopened.entries(file)))).flat();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].body, "durable");
  assert.equal(app.loadLocalStorage("karpathy:rescue:Karpathy"), null);
});

test("rescue refuses stale edits before writing a new entry", async () => {
  const { app, store } = fixture();
  await store.capture("original", new Date(2026, 8, 30), "stale-rescue");
  const entry = (await store.entries(store.files[0]))[0];
  await store.update(entry, "changed on another device");
  await assert.rejects(() => store.rescue(entry, new Date(2026, 9, 25)), /changed elsewhere/);
  assert.equal(app.vault.getMarkdownFiles().length, 1);
  assert.match(app.vault.texts.get(entry.path)!, /changed on another device/);
});
function fixture() {
  const app = new App();
  return { app, store: new Store(app, "Karpathy") };
}

test("concurrent captures never overwrite one another and retries are idempotent", async () => {
  const { app, store } = fixture();
  const date = new Date(2026, 9, 25, 12);
  await Promise.all(Array.from({ length: 25 }, (_, i) => store.capture(`entry ${i}`, date, `id-${i}`)));
  const path = dailyPath("Karpathy", date);
  assert.equal(parseEntries(app.vault.texts.get(path)!, path).length, 25);
  await store.capture("entry 4", date, "id-4");
  assert.equal(parseEntries(app.vault.texts.get(path)!, path).length, 25);
  await assert.rejects(() => store.capture("different body", date, "id-4"), /different version/);
});

test("atomic editing rejects stale versions while unrelated entries remain intact", async () => {
  const { app, store } = fixture();
  const date = new Date(2026, 9, 25, 12);
  await store.capture("original", date, "entry");
  await store.capture("other", date, "other");
  const entry = (await store.entries(store.files[0])).find(entry => entry.id === "entry")!;
  await store.update(entry, "updated");
  await assert.rejects(() => store.update(entry, "stale"), /changed elsewhere/);
  const text = app.vault.texts.get(entry.path)!;
  assert.deepEqual(new Set(parseEntries(text, entry.path).map(entry => entry.body)), new Set(["updated", "other"]));
});

test("forward and backward pagination cover history without omissions or duplication", async () => {
  const { store } = fixture();
  for (let day = 1; day <= 12; day++) {
    for (let entry = 0; entry < 4; entry++) await store.capture(`day ${day} entry ${entry}`, new Date(2026, 9, day, entry), `d-${day}-${entry}`);
  }
  let cursor = { file: 0, offset: 0 };
  const ids: string[] = [];
  let end = false;
  while (!end) {
    const page = await store.page(cursor, 1, "", 7);
    ids.push(...page.entries.map(entry => entry.id));
    cursor = page.end;
    end = page.exhausted;
  }
  assert.equal(ids.length, 48);
  assert.equal(new Set(ids).size, 48);
  assert.equal(ids[0], "d-12-3");
  assert.equal(ids.at(-1), "d-1-0");
  // Reverse traversal starts at the end of the last file, not beyond the array.
  cursor = { file: store.files.length - 1, offset: (await store.entries(store.files.at(-1)!)).length };
  const backwards: string[] = [];
  end = false;
  while (!end) {
    const page = await store.page(cursor, -1, "", 7);
    backwards.unshift(...page.entries.map(entry => entry.id));
    cursor = page.start;
    end = page.exhausted;
  }
  assert.deepEqual(backwards, ids);
});

test("search scans bounded batches and finds matches beyond the initial history", async () => {
  const { store } = fixture();
  for (let day = 1; day <= 20; day++) await store.capture(day === 1 ? "read: distant book" : "ordinary", new Date(2026, 9, day), `day-${day}`);
  let page = await store.page({ file: 0, offset: 0 }, 1, "read: book");
  assert.equal(page.entries.length, 0);
  assert.equal(page.end.file, 8);
  assert.equal(page.exhausted, false);
  page = await store.page(page.end, 1, "read: book");
  page = await store.page(page.end, 1, "read: book");
  assert.equal(page.entries[0].body, "read: distant book");
  assert.equal(page.exhausted, true);
});

test("cache avoids repeat reads, evicts old days, and invalidates same-stat edits", async () => {
  const { app, store } = fixture();
  for (let day = 1; day <= 20; day++) await store.capture(`day ${day}`, new Date(2026, 9, day), `day-${day}`);
  const file = store.files[0];
  const before = app.vault.reads;
  await store.entries(file); await store.entries(file);
  assert.equal(app.vault.reads - before, 1);
  app.vault.texts.set(file.path, serializeEntry("changed", new Date(2026, 9, 20).toISOString(), "external"));
  store.invalidate(file.path);
  assert.equal((await store.entries(file))[0].body, "external");
  for (const item of store.files) await store.entries(item);
  const after = app.vault.reads;
  await store.entries(file);
  assert.equal(app.vault.reads, after + 1);
});

test("attachments go to the entry month with unique sanitized image embeds and file links", async () => {
  const { app, store } = fixture();
  const date = new Date(2026, 0, 1, 0, 1);
  const image = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
  const [one, two] = await Promise.all([store.attachment(image, date), store.attachment(image, date)]);
  assert.match(one, /^!\[\[Karpathy\/2026\/2026-01\/attachments\//);
  assert.equal(one, "![[Karpathy/2026/2026-01/attachments/image.png]]");
  assert.equal(two, "![[Karpathy/2026/2026-01/attachments/image-2.png]]");
  assert.notEqual(one, two);
  const link = await store.attachment(new File(["abc"], "file#[x]|.pdf", { type: "application/pdf" }), date);
  assert.match(link, /^\[\[/);
  assert.ok(!link.includes("file#["));
  assert.equal(app.vault.binaries.size, 3);
  assert.deepEqual(new Uint8Array([...app.vault.binaries.values()][0]), new Uint8Array([1, 2, 3]));
});

test("attachment names stay readable and collisions do not overwrite data", async () => {
  const { app, store } = fixture();
  const date = new Date(2026, 9, 25);
  const attach = (text: string) => store.attachment(new File([text], "notes.pdf", { type: "application/pdf" }), date);
  const first = await attach("first");
  const second = await attach("second");
  assert.equal(first, "[[Karpathy/2026/2026-10/attachments/notes.pdf|notes.pdf]]");
  assert.equal(second, "[[Karpathy/2026/2026-10/attachments/notes-2.pdf|notes-2.pdf]]");
  assert.equal(new TextDecoder().decode(app.vault.binaries.get("Karpathy/2026/2026-10/attachments/notes.pdf")), "first");
  const caseConflict = await store.attachment(new File(["uppercase"], "NOTES.pdf"), date);
  assert.equal(caseConflict, "[[Karpathy/2026/2026-10/attachments/NOTES-3.pdf|NOTES-3.pdf]]");
  const reserved = await store.attachment(new File(["safe"], "CON.pdf"), date);
  assert.equal(reserved, "[[Karpathy/2026/2026-10/attachments/_CON.pdf|_CON.pdf]]");
});
test("write failures surface and do not poison subsequent save operations", async () => {
  const { app, store } = fixture();
  const date = new Date(2026, 9, 25);
  app.vault.failWrites = true;
  await assert.rejects(() => store.capture("draft", date, "retry"), /Disk full/);
  app.vault.failWrites = false;
  await store.capture("draft", date, "retry");
  assert.equal((await store.entries(store.files[0]))[0].body, "draft");
});

test("file conflicts are explicit rather than redirected or overwritten", async () => {
  const { app, store } = fixture();
  await app.vault.create("Karpathy", "not a folder");
  await assert.rejects(() => store.capture("draft", new Date(2026, 9, 25), "blocked"), /file occupies/);
  const other = fixture();
  const date = new Date(2026, 9, 25);
  const path = dailyPath("Karpathy", date);
  await other.app.vault.createFolder(path);
  await assert.rejects(() => other.store.capture("draft", date, "blocked"), /folder occupies/);
  assert.ok(!(other.app.vault.getAbstractFileByPath(path) instanceof TFile));
});
