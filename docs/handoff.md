# New-chat handoff

Read `AGENTS.md` first, then `docs/development.md`. This file replaces dependence
on the long implementation chat. Check Git status/log and `manifest.json` before
working; do not assume this snapshot is the latest release forever.

## Snapshot: 2026-10-31, release 2.2.4

Repository: https://github.com/da5is/obsidian-karpathy, branch `main`.
2.2.4 adds breathing room after lists/images: a normal bullet or image takes
four Enters; ordinary text still takes three. Nested list continuation/outdent
steps do not advance the gesture. 126 automated tests pass.
2.2.3 counts consecutive plain Enter presses instead of inferring the gesture
from trailing blank lines. It passes 123 tests plus a Windows desktop smoke check.
2.2.2 added portable development instructions/fixtures.
A fresh source export installed lockfile dependencies and passed all 120 tests,
the production build, and sample-vault generation for 2.2.2 on Windows/Node 24.
No physical mobile validation was claimed.

- Version 2 stores one entry per Markdown file, in creation-month folders.
  Standard YAML retains identity/created/rescue metadata. No v1 conversion.
- Stream: reverse chronological; rescue in place; edit/delete; themed Markdown;
  search; file/photo attachment buttons; no swipe. Default prefixes:
  `todo:`, `read:`, `buy:`, `ref:`; learn additional prefixes on first use.
- Save: button, Ctrl/Cmd+Enter, or triple Enter. Preserve focus with a blank next
  draft. Native-style list continuation and wikilink filename/alias completion.
- Clipboard title precedence: selected text, matching supplied HTML link label,
  network fallback if enabled, then bare URL. Standard URI-list data supported.
- IndexedDB is local/rebuildable. Bounded body/search caches and rendered stream;
  batched indexing, prewarmed/shared persistent wikilink records, background
  verification for offline same-stat changes. Draft ownership and settings
  updates are serialized. See `docs/storage.md` for details.

## Remaining work

Original KAR-001 through KAR-015 have code changes delivered across 2.0.1–2.2.0;
`docs/backlog.md` preserves historical findings, not fifteen outstanding bugs.
Remaining validation/profiling: physical iPhone/iPad/Android, minimum Obsidian
1.8.7/current host, macOS/Linux, native pop-outs, OneDrive conflicts/trash recovery,
image-heavy peak memory, real autocomplete filtering/paint cost, and variable
cold filesystem indexing. URL requests still lack host-level abort/body limits.
Read `docs/compatibility.md` before making performance or compatibility claims.

## Continuation rules

Default delivery: test/build, commit, push main, publish BRAT assets, verify hashes.
User requests for review/planning/local-only work override that default. Use the
new machine's authenticated `gh`; no personal paths or credentials are required.
Never modify real notes to clean a test run. Create a new disposable test vault
with the committed helper. Do not assume the original OneDrive reference plugins
are writable. Generated bundles, settings, notes, caches, and `.release-work/`
are not committed. No native UI or historical benchmark tooling from that ignored
folder is required for the automated tests.

Suggested new-chat prompt:

> Continue obsidian-karpathy. Read AGENTS.md, docs/handoff.md, and
> docs/development.md, then inspect Git status and the current version. Use a
> disposable sample vault if native UI testing is needed. My next task is: …
