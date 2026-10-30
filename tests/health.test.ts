import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { App, closeDOM } from "./obsidian-mock";
import { inspectStorage, restoreEntryPath } from "../src/health";
import { entryPath, serializeEntry } from "../src/model";
after(closeDOM);
test("health scan identifies skipped notes, conflicts and attachment candidates without writing", async () => {
  const app = new App(), date = new Date(2026, 9, 30);
  const text = serializeEntry("one", date.toISOString(), "entry");
  await app.vault.create("Karpathy/renamed.md", text);
  await app.vault.create(entryPath("Karpathy", date, "one"), text);
  await app.vault.create(entryPath("Karpathy", date, "broken"), "---\nkarpathy: 2\n---\nBroken");
  await app.vault.createBinary("Karpathy/2026/2026-10/attachments/used.png", new ArrayBuffer(1));
  await app.vault.createBinary("Karpathy/2026/2026-10/attachments/unused.png", new ArrayBuffer(1));
  await app.vault.create("Outside.md", "![[Karpathy/2026/2026-10/attachments/used.png]]");
  const before = [...app.vault.texts];
  const issues = await inspectStorage(app as any, "Karpathy");
  assert.equal(issues.filter(issue => issue.reason.startsWith("Duplicate")).length, 2);
  assert.ok(issues.some(issue => issue.path === "Karpathy/renamed.md" && issue.recoverable));
  assert.ok(issues.some(issue => issue.path.endsWith("unused.png")));
  assert.ok(!issues.some(issue => issue.path.endsWith("/used.png")));
  assert.deepEqual([...app.vault.texts], before);
  await assert.rejects(restoreEntryPath(app as any, "Karpathy", "Karpathy/renamed.md"), /destination already exists/);
  assert.deepEqual([...app.vault.texts], before);
});


test("restoration moves valid notes through the host rename API without rewriting their content", async () => {
  const app = new App(), date = new Date(2026, 9, 30);
  const text = serializeEntry("restore", date.toISOString(), "keep body and properties");
  const source = await app.vault.create("Karpathy/renamed.md", text);
  let renamed = "";
  (app as any).fileManager = { renameFile: async (file: any, path: string) => { assert.equal(file, source); renamed = path; } };
  await restoreEntryPath(app as any, "Karpathy", source.path);
  assert.equal(renamed, entryPath("Karpathy", date, "restore"));
  assert.equal(await app.vault.read(source), text);
});
