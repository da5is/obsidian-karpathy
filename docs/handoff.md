# New-chat handoff

Read `AGENTS.md`, then `docs/development.md`. Inspect Git status, recent commits,
and `manifest.json` before changing anything. The repository is sufficient to
continue; earlier chat history and untracked helpers are not required.

## Current snapshot — 2026-11-02, 2.3.1

Repository: https://github.com/da5is/obsidian-karpathy; branch: `main`.
The tag `known-good-2.2.13` marks the last release before the 2.3.0
performance/usability pass; revert to it if 2.3.0 misbehaves natively.

2.3.1 is documentation-only relative to 2.3.0 (backlog, AGENTS.md, handoff and
development instructions).

2.3.0 works through KAR-016–KAR-029 (see `docs/backlog.md`): `main.js` drops
from 269 KB to 132 KB by not bundling embedded HTML/CSS/JS parsers; vault events
register after layout readiness so startup keeps warm index records; background
verification rotates slices and skips unchanged writes and cache churn; rows
recolor in place; typing avoids full-document copies; prefix/tag clicks filter
the stream; todo rows have Done; Rescue and Delete offer Undo; search covers note
text only and highlights matches; file paste recognizes macOS/Linux clipboard
formats. 147 automated tests pass on Linux/Node 26. Native Obsidian, macOS/Linux
paste, and mobile verification of these changes remain pending.

2.2.8 removes hashtag pills and assigns stable automatic colors from the prefix
theme palette. Tag colors ignore custom prefix overrides and encounter order.
Images stay centered and tags remain below the written/rescue line. The automated suite has 134 tests.

2.2.9 adds a capture-toolbar todo button: prepend `todo:`, then change it to
`done:` and append a local `Completed: YYYY-MM-DD` date. Done drafts disable the
button. Changes support Undo and ordinary draft/save handling. Native Obsidian
verification of the new button remains pending.

2.2.10 replaces the Edit formatting toolbar with the same file/photo attachment,
todo/done, and Save row as capture. Draft retention and discard remain available.
The modal action integration is covered by tests; native visual verification is pending.

2.2.11 learns leading prefixes from loaded stream entries, including synced notes,
in batched settings writes before rendering. Existing colors and note bodies are
preserved. Settings write failure reports the error but allows notes to display.

2.2.12 makes footer hashtags bold using the same theme weight as leading colon
prefixes, including hover. Colors and the muted tags label remain unchanged.

2.2.13 explicitly enables native autocorrection in capture and Edit, overriding
CodeMirror's default off value. DOM attributes are tested in both surfaces;
physical keyboard autocorrection remains to be verified on mobile.

## Product behavior to preserve

- One Markdown file per entry, with version-2 YAML and stable creation-month
  paths. Base folder defaults to `Karpathy` and may be the vault root. No daily
  file conversion. Rescue changes metadata in place; edits preserve identity.
- Reverse chronological stream, search, visible rescue/edit/menu actions, delete
  via menu, theme-based fonts/colors, file/photo attachment buttons, no swipe.
  Sidebar hiding is a setting and command-palette action, not a stream button.
- Plain text saves after three consecutive plain Enters at the end. Existing
  newlines do not count. Typing, paste, cursor movement, Shift+Enter, focus loss,
  and draft reset interrupt the gesture. Save and Ctrl/Cmd+Enter remain available.
- A normal bullet sequence takes **four** Enters: continue, remove the empty
  bullet, add spacing, send. Nested continuation/outdent steps do not count;
  outermost list exit starts the save count. Enter at the end of an image/embed
  line moves below it without counting; three further Enters send. The next
  capture stays empty and focused on its first line. Edit does not submit on
  repeated plain Enter.
- Wikilink completion offers filenames/aliases across the vault. Clipboard link
  labels prefer selected editor text, then matching HTML clipboard labels, then
  optional network title lookup, otherwise the bare URL. Preserve ordinary rich
  selections and code/link-destination pastes. Physical iOS format coverage is
  not established by mocked clipboard tests.
- Prefix defaults: `todo:`, `read:`, `buy:`, `ref:`. Learn new prefixes on saving and loading stream entries;
  use theme colors. Prefixes are plain Markdown text, not generated metadata.
- Device-local IndexedDB, bounded stream/body/search caches, batched indexing,
  prewarmed/shared wikilink suggestions, and background same-stat verification.
  Draft ownership and settings mutations are serialized. Markdown is authoritative.
- Vault create/modify/delete/rename handlers register in `onLayoutReady`, so the
  load-time create burst does not invalidate warm index records. Verification
  reads a rotating slice each minute, skips unchanged writes, and does not push
  uncached files through the LRU caches.
- Search matches note body text only and highlights matches. A plain click on a
  colored prefix or tag filters the stream; Ctrl/Cmd-click on a tag passes
  through to Obsidian. `todo:` rows show Done. Rescue and Delete show Undo;
  undoing a delete recreates the exact source and never overwrites a file.

## Validation and outstanding work

147 automated tests, TypeScript, and production bundling pass on Linux/Node 26
for 2.3.0 (earlier releases: Windows/Node 24).
A fresh source export with fresh dependencies, build, and generated test vault
was checked for 2.2.2. A native Windows Obsidian 1.14.5 save/focus smoke check
passed for 2.2.3. The 2.2.4 native repeat failed to obtain input geometry from
the computer-use tool; do not call that release physically validated.

Open work: native checks for 2.3.0 (warm startup, filters/Done/Undo/highlight
visuals, Finder/Linux file paste); physical iPhone/iPad/Android input, clipboard, lifecycle and memory;
minimum/current Obsidian and macOS/Linux; native pop-outs; OneDrive conflicts
and trash recovery; image-heavy memory; autocomplete filtering/painting; variable
cold indexing. URL fetching still lacks host-level abort/download bounds.
`docs/backlog.md` separates current work from archived KAR-001–KAR-015 findings.
Use `docs/compatibility.md` for measured results and limits.

## Workflow and documents

- `docs/development.md`: fresh setup, disposable test-vault helper, native smoke
  checklist, release procedure. Do not clean a user's notes for test convenience.
- `docs/storage.md`: implementation storage/index contract.
- `docs/VAULT_LLM_GUIDE.md`: standalone instructions for an LLM reading/editing
  an actual vault. Copy as `KARPATHY_VAULT_GUIDE.md` and explicitly ask it to read
  the guide; this does not replace the repository's contributor `AGENTS.md`.
- Default delivery: test/build, commit, push main, publish three BRAT assets,
  verify hashes. Before a broad or risky pass, push an annotated
  `known-good-VERSION` tag on the last good release commit. Review/planning/local-only user instructions override this.
- Use the new machine's authenticated GitHub CLI. Never commit credentials,
  vault notes/settings, generated bundles, caches, or `.release-work/` artifacts.
  Historical benchmark harnesses are untracked, not fresh-clone prerequisites.
- Verify the full vault path before deployment; matching display names are
  insufficient. The original-machine OneDrive reference plugins remain read-only.

Suggested new-chat prompt:

> Continue obsidian-karpathy. Read AGENTS.md, docs/handoff.md, and
> docs/development.md, then inspect Git status and the current version. Use a
> disposable sample vault for native UI testing. My next task is: …
