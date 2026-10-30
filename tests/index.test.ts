import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { App, closeDOM } from "./obsidian-mock";
import { LocalIndex } from "../src/index";
import { Store } from "../src/store";
import { entryPath, serializeEntry } from "../src/model";

after(closeDOM);

test("persistent index separates vaults, validates file stats and deletes both metadata and search text", async () => {
  const first = new App(), second = new App();
  const index = new LocalIndex(first as any);
  const record = { path: "entry.md", mtime: 1, size: 20, id: "entry", timestamp: "2026-10-30T12:00:00.000Z" };
  await index.put(record, "searchable text");
  assert.equal(await index.text(record.path, 1, 20), "searchable text");
  assert.equal(await index.text(record.path, 2, 20), undefined);
  assert.equal(await index.text(record.path, 1, 21), undefined);
  await index.close();
  const reopened = new LocalIndex(first as any), other = new LocalIndex(second as any);
  assert.deepEqual(await reopened.records(), [record]);
  assert.deepEqual(await other.records(), []);
  await reopened.remove(record.path);
  assert.deepEqual(await reopened.records(), []);
  assert.equal(await reopened.text(record.path, 1, 20), undefined);
  await reopened.close(); await other.close();
});

test("blocked or unavailable local storage never prevents saving or reading Markdown", async context => {
  context.mock.method(indexedDB, "open", () => { throw new Error("Storage unavailable"); });
  context.mock.method(console, "warn", () => {});
  const app = new App(), store = new Store(app as any, "Karpathy");
  await store.capture("durable without a database", new Date(2026, 9, 30), "entry");
  assert.equal(await store.countEntries(), 1);
  assert.equal((await store.page({ file: 0, offset: 0 }, 1, "durable")).entries[0].body, "durable without a database");
  await store.close();
});

test("an interrupted index build can retry; a concurrent change cannot persist a stale record", async () => {
  const app = new App(), date = new Date(2026, 9, 30);
  const path = entryPath("Karpathy", date, "entry");
  const file = await app.vault.create(path, serializeEntry("entry", date.toISOString(), "first version"));
  const store = new Store(app as any, "Karpathy");
  const originalRead = app.vault.read.bind(app.vault);
  app.vault.read = async () => { throw new Error("Temporary read failure"); };
  await assert.rejects(() => store.countEntries(), /Temporary read failure/);
  let changed = false;
  app.vault.read = async current => {
    const stale = await originalRead(current);
    if (!changed) {
      changed = true;
      app.vault.texts.set(path, serializeEntry("entry", date.toISOString(), "latest version"));
      store.invalidate(path);
    }
    return stale;
  };
  assert.equal(await store.countEntries(), 1);
  assert.equal((await store.entries(file))[0].body, "latest version");
  await store.close();
  const reopened = new Store(app as any, "Karpathy");
  assert.equal((await reopened.page({ file: 0, offset: 0 }, 1, "first version")).entries.length, 0);
  assert.equal((await reopened.page({ file: 0, offset: 0 }, 1, "latest version")).entries.length, 1);
  await reopened.close();
});

test("conflicting entry identities are shown separately and explicitly marked", async () => {
  const app = new App(), date = new Date(2026, 9, 30);
  const path = entryPath("Karpathy", date, "entry");
  await app.vault.create(path, serializeEntry("entry", date.toISOString(), "phone version"));
  await app.vault.create(path.replace(".md", " (conflict).md"), serializeEntry("entry", date.toISOString(), "desktop version"));
  const store = new Store(app as any, "Karpathy");
  const page = await store.page({ file: 0, offset: 0 }, 1, "");
  assert.equal(page.entries.length, 2);
  assert.ok(page.entries.every(entry => entry.conflict));
  await store.remove(page.entries[0]);
  const remaining = (await store.page({ file: 0, offset: 0 }, 1, "")).entries;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].conflict, false);
  await store.close();
});
