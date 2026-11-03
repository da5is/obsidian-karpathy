# Compatibility and performance checks

Release: 2.3.3. All timing values below are milliseconds.

2.3.3 enables the three-Enter save gesture in Edit (KAR-032). 151 automated tests
and the build pass on Linux/Node 26.13; the new Edit test fails without the
change. Native confirmation pending.

2.3.2 fixes an empty stream after Obsidian starts (KAR-030): a stream tab
restored before the vault finished loading was not refreshed when entries were
indexed. 148 automated tests and the build pass on Linux/Node 26.13; a new test
reproduces the empty view and fails without the fix. Native confirmation pending.

2.3.0 (KAR-016–KAR-029) was tested on Linux/Node 26: 147 automated tests,
TypeScript, and the production build pass. Measured: minified `main.js` is 132 KB,
down from 269 KB in 2.2.13, by omitting lang-markdown's embedded HTML/CSS/JS
parsers (inline HTML inside the editor is no longer sub-highlighted). New
coverage: layout-ready event registration, late-reported warm records and pruning,
verification without unchanged writes or cache eviction, rotating verification
slices, retained records until re-read, close-time removal of unread changes,
body-only search, rescue/delete undo, in-place recoloring, prefix/tag filters,
Done, highlights, and Windows/macOS/Linux clipboard file formats. Not verified:
native Obsidian behavior of these changes (including whether create events fire
during vault load in current Obsidian), real Finder/Linux file-manager clipboard
contents, and mobile devices.

2.2.6 adds regression coverage for moving clickable tags while preserving source
Markdown, images, code, and embedded-note tags. Native visual verification of
this release remains pending; the open Obsidian window was a different vault.

2.2.7 extends the tag-row assertion to cover its label and comma separators.
Native visual verification remains pending.

2.2.8 verifies stable, case-insensitive hashtag colors, canonical Unicode
equivalence, the prefix palette, and independence from prefix customization.
Native visual verification of the plain hashtag styling remains pending.

2.2.9 verifies capture todo/done transitions, local completion dates, duplicate
prevention, Undo, draft persistence, saved Markdown, prefix matching, and locking.
Native Obsidian visual verification of the new toolbar button remains pending.

2.2.10 verifies the Edit action row, file/photo picker filters, upload save blocking,
dated completion, draft persistence, and saving with stable entry identity. Native
visual verification remains pending.

2.2.11 verifies batched discovery of synced prefixes, case normalization, preserved
custom colors and note bodies, no redundant writes, later arrivals, and retry after
settings failure. Physical cross-device sync verification remains pending.

2.2.12 applies the prefix bold-weight token to footer hashtags in normal and hover
states. The existing 133 tests and production build pass; native visual verification
of the font-weight change remains pending.

2.2.13 verifies autocorrect=on, spellcheck=true, and sentence capitalization on
the capture and Edit contenteditable elements. This establishes configuration,
not physical iOS/Android keyboard behavior; device validation remains pending.

## Automated and desktop coverage

134 automated tests pass on Windows/Node, including CodeMirror, simulated iOS
Return behavior, interrupted writes, unavailable IndexedDB, concurrent settings,
exclusive drafts, attachment limits, and storage diagnostics. TypeScript and
production bundling pass. Production uses Obsidian's CodeMirror modules; test
packages are not proof of compatibility with every Obsidian runtime version.

The plugin minimum remains Obsidian 1.8.7. The unnecessary regex-lookbehind
requirement was removed. Previous 2.1.0 native desktop checks used Obsidian 1.14.5 on Windows: plugin reload and the completed storage-health report in the clean development vault. Later cache/completion changes have automated coverage. Native checks for later releases are recorded separately below.
Minimum-version Obsidian, macOS/Linux, physical iPhone/iPad/Android, OneDrive
conflict resolution, and mobile trash restoration still require a device matrix
run. Do not describe those platforms as newly verified by these tests.

Clipboard-link tests cover matching HTML titles, URI-list representations, selection precedence, disabled networking, ambiguous/mismatched content, inert HTML parsing, and undo. Mobile clipboard formats are simulated; actual iOS/Android source-app behavior still needs device validation. Performance measurements below are from 2.2.0.

The 2.2.3 Enter regression tests cover restored blank lines/empty bullets,
attachment completion, Shift+Enter/cursor resets, and deferred iOS input.
A Windows Obsidian 1.14.5 smoke check confirmed saving the test draft and an
empty, focused next input. Physical iOS behavior remains unverified.

The 2.2.4 regression suite additionally checks four-Enter image/list submission,
pasted image data, task/numbered/nested lists, and unchanged three-Enter text.
The 2.2.4 native desktop repeat was unavailable: the computer-use tool reported
that input geometry was unavailable for the development window.

## Storage benchmark

Real local filesystem reads of 1k, 10k, and 50k short Markdown files on this
Windows development machine; fake IndexedDB and mocked Obsidian metadata APIs.
Three cold/warm/search trials per size; 60 sequential page measurements per size.
p95 for three trials is just the maximum observed, not a statistically robust
latency estimate. OS filesystem caches were not forcibly flushed. No network,
mobile rendering, or OneDrive downloads are included.

| Entries | Cold index p50 / p95 | Warm count p50 / p95 | Page p50 / p95 | Sparse search p50 / p95 |
| --- | --- | --- | --- | --- |
| 1,000 | 505 / 1,636 | 6 / 7 | 6 / 11 | 7 / 8 |
| 10,000 | 5,504 / 15,221 | 46 / 47 | 5 / 8 | 75 / 77 |
| 50,000 | 28,388 / 66,225 | 201 / 223 | 4 / 12 | 411 / 443 |

At 50k, the previous 2.1.0 median cold index was 35,388 ms and sparse search
764 ms. Cold filesystem results are noisy: the new worst run is slower than the
previous 38,682 ms. Do not infer a guaranteed disk or OneDrive speedup.
Cold indexing still reads authoritative files to preserve rescue ordering.
Warm cached results load before the background content check.

## Wikilink preparation

Single preparation/query measurements using the same mocked host and fake
IndexedDB. These measure the completion source, not CodeMirror filtering,
layout, or paint time. There are no Markdown-body reads for suggestions.

| Vault files | Cold preparation | Cache restore + preparation | Prepared query | New editor after restore |
| --- | --- | --- | --- | --- |
| 1,000 | 2.6 | 4.4 | 0.5 | 0.2 |
| 10,000 | 28.1 | 47.7 | 0.2 | 0.2 |
| 50,000 | 310.9 | 421.9 | 0.2 | 0.3 |

The previous 50k first-source request took 4,867 ms. Preparation now starts after
layout readiness and yields based on elapsed work, instead of paying a timer
pause for every 256 files. Names/path options are shared across editors.
Saved file/alias records survive restart; completion functions are recreated.
Startup still enumerates file stats and checks host metadata for offline alias
changes. Opening completion before preparation finishes waits for that work.
Body-only modifications do not rebuild the options. Missing IndexedDB falls
back to host metadata; the cache is never required to create a link.

## Real IndexedDB check

Headless Edge, 50k short entries, real IndexedDB and simulated in-memory file
reads: cold build 3,870 ms, warm count 351 ms, 30-entry page 14 ms, full-history
sparse search 1,087 ms. The earlier same harness measured 10,913 / 628 / 10 /
1,795 ms respectively. This is a single-run architectural comparison, not a
physical-device latency guarantee. Warm count read no Markdown; page read 30
files; search read only its one matching file. Index writes now use one
transaction per batch of up to 32 records; search fetches up to 256 texts per
transaction while retaining the 256-entry scan/cancellation bound.

## Editor benchmark

Thirty edits per size in jsdom using actual CodeMirror, a single long line,
no storage/network writes, and a no-op draft callback. These measure transaction
work, not painted-frame latency or end-to-end capture latency on a device.

| Characters before editing | Dispatch p50 | Dispatch p95 |
| --- | --- | --- |
| 1,000 | 0.5 | 5.9 |
| 100,000 (crosses source-mode threshold) | 0.2 | 0.5 |
| 1,000,000 | 0.4 | 1.1 |

Drafts above 100,000 characters use source mode without line wrapping or live
preview. Returning below the threshold restores formatting. Small-note live
preview scans the viewport rather than the entire document.

## Operational bounds and tradeoffs

- Draft persistence coalesces at 250 ms and flushes on save/clear, view close,
  page hide, document hide, and plugin unload. A hard process kill can lose the
  last unflushed interval; local-storage failure is reported and retained in
  memory for another flush. Only one pane/editor owns each draft at a time.
- Attachments are limited to 50 MiB per file before contents are read. Add larger
  files directly to the vault and link them. Native file paste reads and uploads
  one file at a time. Earlier successful links survive a later upload failure.
  Native file paste reads Windows `FileNameW`, macOS `NSFilenamesPboardType` or
  `public.file-url`, and Linux `text/uri-list` (file URLs only).
- Rendered entry text has an approximate 8 MiB budget plus a 120-row maximum;
  one oversized entry is allowed. Entries over 100,000 characters show a plain
  excerpt and an Open full note button. Decoded images, DOM, and Obsidian caches
  remain outside that accounting: this is not a total process-memory guarantee.
- URL title requests have four actual in-flight slots shared across editors.
  Expired UI lookups retain their slots until the request settles. When full,
  further pastes keep their URL and do not queue more requests. Fetching titles
  can be disabled in settings. Obsidian requestUrl has no abort/stream limit in
  the API used here; responses over 2 MiB are ignored after receipt, which does
  not bound bytes downloaded. A stalled request occupies its slot until it
  settles or the plugin reloads.
- Storage health is read-only until the user confirms restoring a valid entry's
  filename/folder. It refuses occupied destinations, uses Obsidian's rename API,
  and never automatically removes attachments or merges conflicting notes.

## Device acceptance checklist still to run

On minimum/current supported Obsidian, record cold/warm latency and peak memory
on iPhone, iPad, and Android. Exercise IME composition, Return/soft keyboards,
photo selection, multi-file paste, 50 MiB rejection, background/resume, offline
same-entry conflicts, trash restore, and IndexedDB eviction. Target ordinary
capture input below 50 ms p95 and warm 30-entry page loading below 100 ms p95;
these are acceptance targets, not claims of achieved mobile performance.
