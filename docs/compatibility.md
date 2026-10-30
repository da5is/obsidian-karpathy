# Compatibility and performance checks

Release: 2.1.0. All timing values below are milliseconds.

## Automated and desktop coverage

107 automated tests pass on Windows/Node, including CodeMirror, simulated iOS
Return behavior, interrupted writes, unavailable IndexedDB, concurrent settings,
exclusive drafts, attachment limits, and storage diagnostics. TypeScript and
production bundling pass. Production uses Obsidian's CodeMirror modules; test
packages are not proof of compatibility with every Obsidian runtime version.

The plugin minimum remains Obsidian 1.8.7. The unnecessary regex-lookbehind
requirement was removed. Native desktop checks use Obsidian 1.14.5 on Windows: plugin reload and the completed storage-health report in the clean development vault.
Minimum-version Obsidian, macOS/Linux, physical iPhone/iPad/Android, OneDrive
conflict resolution, and mobile trash restoration still require a device matrix
run. Do not describe those platforms as newly verified by these tests.

## Storage benchmark

Real local filesystem reads of 1k, 10k, and 50k short Markdown files on this
Windows development machine; fake IndexedDB and mocked Obsidian metadata APIs.
Three cold/warm/search trials per size; 60 sequential page measurements per size.
p95 for three trials is just the maximum observed, not a statistically robust
latency estimate. OS filesystem caches were not forcibly flushed. No network,
mobile rendering, or OneDrive downloads are included.

| Entries | Cold index p50 / p95 | Warm count p50 / p95 | Page p50 / p95 | Sparse search p50 / p95 | First completion |
| --- | --- | --- | --- | --- | --- |
| 1,000 | 652 / 672 | 6 / 7 | 5 / 21 | 6 / 10 | 94 |
| 10,000 | 5,272 / 5,328 | 48 / 52 | 4 / 8 | 73 / 89 | 781 |
| 50,000 | 35,388 / 38,682 | 411 / 422 | 6 / 11 | 764 / 795 | 4,867 |

Completion construction yields in batches of 256, so its elapsed time includes
yields. Warm completions reuse options; ordinary body-only changes no longer
invalidate the option list. Cold index loading shows progress and preserves
correct rescue ordering rather than presenting an incorrectly ordered partial
stream. Warm cached results load before the background content check.

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
