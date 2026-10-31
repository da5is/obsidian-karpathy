# New-chat handoff

Read `AGENTS.md`, then `docs/development.md`. Inspect Git status, recent commits,
and `manifest.json` before changing anything. The repository is sufficient to
continue; earlier chat history and untracked helpers are not required.

## Current snapshot — 2026-10-31, 2.2.5

Repository: https://github.com/da5is/obsidian-karpathy; branch: `main`.
2.2.5 updates documentation and adds `docs/VAULT_LLM_GUIDE.md`; plugin behavior
is unchanged from 2.2.4. The automated suite has 126 tests.

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
- Prefix defaults: `todo:`, `read:`, `buy:`, `ref:`. Learn new prefixes on saving;
  use theme colors. Prefixes are plain Markdown text, not generated metadata.
- Device-local IndexedDB, bounded stream/body/search caches, batched indexing,
  prewarmed/shared wikilink suggestions, and background same-stat verification.
  Draft ownership and settings mutations are serialized. Markdown is authoritative.

## Validation and outstanding work

126 automated tests, TypeScript, and production bundling pass on Windows/Node 24.
A fresh source export with fresh dependencies, build, and generated test vault
was checked for 2.2.2. A native Windows Obsidian 1.14.5 save/focus smoke check
passed for 2.2.3. The 2.2.4 native repeat failed to obtain input geometry from
the computer-use tool; do not call that release physically validated.

Open work: physical iPhone/iPad/Android input, clipboard, lifecycle and memory;
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
  verify hashes. Review/planning/local-only user instructions override this.
- Use the new machine's authenticated GitHub CLI. Never commit credentials,
  vault notes/settings, generated bundles, caches, or `.release-work/` artifacts.
  Historical benchmark harnesses are untracked, not fresh-clone prerequisites.
- Verify the full vault path before deployment; matching display names are
  insufficient. The original-machine OneDrive reference plugins remain read-only.

Suggested new-chat prompt:

> Continue obsidian-karpathy. Read AGENTS.md, docs/handoff.md, and
> docs/development.md, then inspect Git status and the current version. Use a
> disposable sample vault for native UI testing. My next task is: …
