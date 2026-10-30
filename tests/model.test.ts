import assert from "node:assert/strict";
import { test } from "node:test";
import { attachmentFolder, baseFolder, entryPath, isEntryPath, LruCache, matchesQuery, parseEntries, replaceEntry, serializeEntry, toggleTask, uniqueId } from "../src/model";

const timestamp = "2026-10-25T12:00:00.000Z";
const path = "Karpathy/2026/2026-10/2026-10-25-test-1.md";
const sample = (id = "test-1", body = "todo: first\n\n- [ ] check\n\n---\n\n\x60\x60\x60md\n## not an entry\n\x60\x60\x60", time = timestamp) => serializeEntry(id, time, body);

test("identifiers include readable timestamps and independent random suffixes", context => {
  context.mock.timers.enable({ apis: ["Date"], now: Date.parse(timestamp) });
  const ids = Array.from({ length: 1000 }, () => uniqueId());
  assert.equal(new Set(ids).size, 1000);
  assert.ok(ids.every(id => /^20261025120000000-[a-f0-9]{12}$/.test(id)));
});
test("entry and attachment paths retain month folders and support vault root", () => {
  const date = new Date(2026, 0, 1, 0, 1);
  assert.equal(entryPath("Notes/Stream", date, "example"), "Notes/Stream/2026/2026-01/2026-01-01-example.md");
  assert.equal(attachmentFolder("Notes/Stream", date), "Notes/Stream/2026/2026-01/attachments");
  for (const base of ["", "  ", "/", " / "]) {
    assert.equal(baseFolder(base), "");
    const path = entryPath(base, date, "entry");
    assert.equal(path, "2026/2026-01/2026-01-01-entry.md");
    assert.equal(isEntryPath(base, path), true);
  }
  assert.throws(() => entryPath("", date, "../escape"));
});
test("base paths and entry recognition exclude unrelated and old daily notes", () => {
  assert.equal(baseFolder(" Notes\\Stream/ "), "Notes/Stream");
  for (const value of ["//", "/Notes", "../Notes", "Notes/../Other", ".obsidian", "Notes/.hidden", "C:\\Notes", "a//b", "a?b"]) assert.throws(() => baseFolder(value));
  assert.equal(isEntryPath("Karpathy", path), true);
  assert.equal(isEntryPath("Karpathy", path.replace(".md", " (conflict).md")), true);
  for (const value of ["Karpathy/2026/2026-10/2026-10-25.md", "Karpathy/2025/2026-10/2026-10-25-a.md", "Karpathy/2026/2026-09/2026-10-25-a.md", "Karpathy/2026/2026-02/2026-02-30-a.md", "Karpathy/2026/2026-10/attachments/test.md", "Karpathy2/2026/2026-10/2026-10-25-a.md", "README.md"]) assert.equal(isEntryPath("Karpathy", value), false, value);
});
test("standard frontmatter round trips rich Markdown without injected headings or boundaries", () => {
  const text = sample();
  const entry = parseEntries(text, path)[0];
  assert.ok(text.startsWith("---\nkarpathy: 2\n"));
  assert.ok(!text.includes("<!-- karpathy:"));
  assert.equal(entry.body, "todo: first\n\n- [ ] check\n\n---\n\n\x60\x60\x60md\n## not an entry\n\x60\x60\x60");
  assert.equal(entry.created, timestamp);
  assert.equal(entry.rescues, 0);
  assert.equal(parseEntries(text.replace(/\n/g, "\r\n"), path)[0].body, entry.body);
  assert.equal(parseEntries(sample("indent", "    code block\nnext  "), path)[0].body, "    code block\nnext  ");
  assert.equal(parseEntries(sample("comment", "<!-- karpathy:anything -->"), path)[0].body, "<!-- karpathy:anything -->");
});
test("edits preserve custom properties and refuse stale body or metadata", () => {
  const text = serializeEntry("test-1", timestamp, "original", timestamp, 0, { tags: ["work"], aliases: ["Example"], custom: { nested: true } });
  const entry = parseEntries(text, path)[0];
  const edited = replaceEntry(text, entry, "updated");
  assert.equal(parseEntries(edited, path)[0].body, "updated");
  assert.match(edited, /nested: true/);
  assert.match(edited, /aliases:/);
  assert.throws(() => replaceEntry(edited, entry, "stale"), /changed elsewhere/);
  assert.throws(() => replaceEntry(text.replace("work", "home"), entry, "stale"), /changed elsewhere/);
  const rescued = parseEntries(replaceEntry(text, entry, entry.body, "2026-11-01T12:00:00.000Z"), path)[0];
  assert.equal(rescued.created, timestamp); assert.equal(rescued.rescues, 1);
  assert.equal(rescued.timestamp, "2026-11-01T12:00:00.000Z");
});
test("malformed metadata and legacy documents are excluded without guessing", () => {
  for (const text of ["plain note", "<!-- karpathy:x timestamp -->", sample().replace("karpathy: 2", "karpathy: 1"), sample().replace("rescues: 0", "rescues: -1"), sample().replace(/created: .*/, "created: invalid"), "---\nkarpathy: [broken\n---\nbody"]) assert.deepEqual(parseEntries(text, path), []);
});
test("search matches body and dates", () => {
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
