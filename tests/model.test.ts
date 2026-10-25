import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentFolder, baseFolder, dailyPath, insertEntry, isDailyPath, LruCache, matchesQuery, parseEntries, replaceEntry, serializeEntry, toggleTask, uniqueId } from "../src/model";

const timestamp = "2026-10-25T12:00:00.000Z";
const path = "Karpathy/2026/2026-10/2026-10-25.md";
const sample = (id = "test-1", body = "todo: first\n\n- [ ] check\n\n---\n\n```md\n## not an entry\n```", time = timestamp) => serializeEntry(id, time, body);

test("new identifiers are readable timestamps and unique for rapid captures", () => {
  const ids = Array.from({ length: 100 }, () => uniqueId());
  assert.equal(new Set(ids).size, 100);
  assert.ok(ids.every(id => /^\d{17}(?:-\d+)?$/.test(id)));
  const old = "37ebddf4-608a-4c30-8c22-58ba844f5c21";
  assert.equal(parseEntries(sample(old), path)[0].id, old);
});
test("local daily and attachment layout handles month and year boundaries", () => {
  const date = new Date(2026, 0, 1, 0, 1);
  assert.equal(dailyPath("Notes/Stream", date), "Notes/Stream/2026/2026-01/2026-01-01.md");
  assert.equal(attachmentFolder("Notes/Stream", date), "Notes/Stream/2026/2026-01/attachments");
  assert.equal(dailyPath("Karpathy", new Date(2025, 11, 31, 23, 59)), "Karpathy/2025/2025-12/2025-12-31.md");
});

test("base path validation prevents hidden and out-of-vault destinations", () => {
  assert.equal(baseFolder(" Notes\\Stream/ "), "Notes/Stream");
  for (const value of ["", "/", "../Notes", "Notes/../Other", ".obsidian", "Notes/.hidden", "C:\\Notes", "a//b", "a?b"]) {
    assert.throws(() => baseFolder(value));
  }
});

test("recognizes only correctly nested daily filenames and real dates", () => {
  assert.equal(isDailyPath("Karpathy", path), true);
  for (const value of [
    "Karpathy/2025/2026-10/2026-10-25.md", "Karpathy/2026/2026-09/2026-10-25.md",
    "Karpathy/2026/2026-02/2026-02-30.md", "Karpathy/2026/2026-10/attachments/test.md",
    "Karpathy2/2026/2026-10/2026-10-25.md"
  ]) assert.equal(isDailyPath("Karpathy", value), false);
});

test("entries round trip rich Markdown without interpreting content headings or rules", () => {
  const text = sample();
  const [entry] = parseEntries(text, path);
  assert.equal(entry.body, "todo: first\n\n- [ ] check\n\n---\n\n```md\n## not an entry\n```");
  assert.equal(text.slice(entry.start, entry.end), text);
  assert.equal(parseEntries(text.replace(/\n/g, "\r\n"), path)[0].body, entry.body);
  assert.equal(parseEntries(sample("indent", "    code block\nnext  "), path)[0].body, "    code block\nnext  ");
});

test("sorts reverse chronologically with deterministic ties", () => {
  const entries = parseEntries(`${sample("a")}\n${sample("b", "new", "2026-10-25T13:00:00.000Z")}\n${sample("c")}`, path);
  assert.deepEqual(entries.map(entry => entry.id), ["b", "c", "a"]);
});

test("prepending preserves YAML, daily heading, and unrelated Markdown", () => {
  const original = "---\ntags: [daily]\n---\n\n# 2026-10-25\n\nExisting content\n";
  const result = insertEntry(original, sample(), "2026-10-25");
  assert.ok(result.startsWith("---\ntags: [daily]\n---\n\n# 2026-10-25\n\n<!-- karpathy:"));
  assert.ok(result.endsWith("Existing content\n"));
  assert.equal(parseEntries(result, path).length, 1);
  assert.ok(insertEntry("", sample(), "2026-10-25").startsWith("# 2026-10-25\n\n"));
});

test("edits touch one entry, preserve surrounding text, and detect stale drafts", () => {
  const original = `Unmanaged preface\n\n${sample()}\n\n${sample("second", "untouched")}\nFooter`;
  const entry = parseEntries(original, path).find(entry => entry.id === "test-1")!;
  const result = replaceEntry(original, entry, "updated");
  assert.equal(parseEntries(result, path).find(entry => entry.id === "test-1")?.body, "updated");
  assert.ok(result.startsWith("Unmanaged preface\n\n"));
  assert.ok(result.endsWith("Footer"));
  assert.ok(result.includes(sample("second", "untouched")));
  assert.throws(() => replaceEntry(result, entry, "stale"), /changed elsewhere/);
  assert.throws(() => replaceEntry(`${original}\n${sample()}`, entry, "duplicate"), /duplicate ID/);
});

test("invalid timestamps, missing endings, and boundary injection do not become entries", () => {
  assert.equal(parseEntries("<!-- karpathy:x broken -->\n## time\n\nbody\n\n<!-- /karpathy:x -->", path).length, 0);
  assert.equal(parseEntries("<!-- karpathy:x 2026-10-25T12:00:00Z -->\n## time\n\nunfinished", path).length, 0);
  assert.throws(() => sample("x", "hello\n<!-- /karpathy:x -->"), /boundary/);
});

test("search matches all terms across content, prefixes, and date paths", () => {
  const entry = parseEntries(sample("s", "read: A Great Book"), path)[0];
  assert.equal(matchesQuery(entry, "READ: book 2026-10"), true);
  assert.equal(matchesQuery(entry, "book missing"), false);
});

test("checkboxes update their exact task and skip fenced code", () => {
  const body = "- [ ] one\n```md\n- [ ] example\n```\n- [x] two\n    - [ ] nested\n1. [ ] ordered";
  assert.equal(toggleTask(body, 1, false), body.replace("- [x] two", "- [ ] two"));
  assert.equal(toggleTask(body, 2, true), body.replace("- [ ] nested", "- [x] nested"));
  assert.equal(toggleTask(body, 3, true), body.replace("1. [ ] ordered", "1. [x] ordered"));
});

test("checkbox mapping includes quoted tasks without altering another task", () => {
  const body = "> - [ ] quoted\n\n- [ ] normal\n\n~~~md\n- [ ] example\n~~~";
  assert.equal(toggleTask(body, 0, true), body.replace("> - [ ] quoted", "> - [x] quoted"));
  assert.equal(toggleTask(body, 1, true), body.replace("- [ ] normal", "- [x] normal"));
  assert.throws(() => toggleTask(body, 2, true), /Checklist syntax changed/);
});

test("LRU bounds memory and promotes cache hits", () => {
  const cache = new LruCache<string, number>(2, 10);
  cache.set("a", 1, 4); cache.set("b", 2, 4); cache.get("a"); cache.set("c", 3, 4);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), 1);
  cache.set("huge", 4, 20);
  assert.equal(cache.get("huge"), undefined);
  assert.equal(cache.size, 2);
  cache.set("a", 5, 8);
  assert.equal(cache.get("c"), undefined);
  cache.clear();
  assert.equal(cache.size, 0);
});
