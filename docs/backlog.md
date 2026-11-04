# Product backlog

## Performance and usability review — 2026-11-02, 2.2.13

Baseline tagged `known-good-2.2.13` for easy revert. Findings come from source
inspection plus one bundle measurement; native verification is noted per item.

**Status — shipped in 2.3.0 (commit `dde3270`, release assets hash-verified):**
all items below have implementation changes and automated regression coverage
(147 tests). Native Obsidian checks are still needed for KAR-017 (confirm
load-time create events and warm startup), KAR-024–KAR-026 (visual/notice
behavior), and KAR-028 (actual Finder/Linux clipboard formats; Chromium may
already supply some copied files directly). These checks are also listed under
outstanding validation work below.

Intentional behavior changes in 2.3.0 that users may notice:

- Search matches note text only, not file paths or ISO dates. Pre-2.3.0 cached
  search text is replaced by rotating verification within about fifteen minutes,
  or immediately with **Refresh stream and cache**.
- A plain click on a stream tag filters the stream; Ctrl/Cmd-click still opens
  Obsidian's tag search.
- Raw HTML typed in capture/Edit is no longer sub-highlighted (KAR-016).

- **KAR-016 (P1, measured): Drop unused embedded-language parsers.** `markdown()`
  pulls lang-html/css/javascript into `main.js` (measured minified `main.js`: 269 KB in 2.2.13 → 132 KB in 2.3.0).
  Use `LanguageSupport(markdownLanguage)`; inline-HTML sub-highlighting is lost.
- **KAR-017 (P1, inspection; native check pending): Avoid startup cache
  invalidation.** Vault `create` events registered in `onload` fire for every
  existing file during vault load; each invalidated entry bypasses the warm
  IndexedDB record and issues a separate delete. Register vault events after
  layout readiness and reindex there.
- **KAR-018 (P2): Make background verification cheap.** Full reconciliation
  rewrote every unchanged record/search text and pushed cold files through the
  LRU caches, evicting visible rows. Skip unchanged writes, bypass caches for
  uncached files, and verify a rotating slice each minute.
- **KAR-019 (P2): Re-render only rows whose own prefix color changed.** Row
  signatures included the serialized full color map and a second copy of source.
- **KAR-020 (P2): Reduce per-keystroke work.** Avoid repeated full-document
  string copies and redundant `setIcon` calls when typing.
- **KAR-021 (P3): Skip checklist parsing for rows without checkboxes.**
- **KAR-022 (P3): Don't let an event's IndexedDB delete race a fresh write**
  after capture/edit. Invalidation keeps the IndexedDB record while the file
  still exists (it is replaced on re-read) and drops only still-unread records
  when the plugin closes. A same-stat shortcut was tried and rejected because it
  swallowed genuine same-stat external edits.
- **KAR-023 (P3): Scope folder-hiding reapplication** to explorer changes rather
  than tearing down observers on every layout change.
- **KAR-024 (usability): Filter by prefix or tag** by clicking it in the stream.
- **KAR-025 (usability): Mark a `todo:` entry done from its row.**
- **KAR-026 (usability): Undo Rescue and Delete** from a short notice.
- **KAR-027 (usability): Keep the last count while refreshing** instead of
  flashing "Counting notes…".
- **KAR-028 (usability): Paste copied files on macOS/Linux,** not only Windows
  `FileNameW`. Physical macOS/Linux verification pending.
- **KAR-029 (usability): Search feedback.** Highlight matched terms; stop ISO
  timestamps and paths from matching nearly every entry for year-like terms.

- **KAR-030 (P1, user-reported regression in 2.3.0; fixed in 2.3.2): Empty
  stream after launch.** A stream tab restored with the workspace rendered before
  the vault finished loading, when no entry files were known. KAR-017 removed the
  load-time create events that used to refresh it, so the stream stayed empty
  until the next capture. The layout-ready reindex now refreshes open views.
  Regression test opens a view before layout readiness. Native check pending.

**Regression audit after KAR-030 (2026-11-02, 2.3.2):** reviewed every 2.3.0
change for state that previously depended on load-time vault events or full
re-renders. No further defects found:

- Wikilink suggestions: the layout-ready `prepare()` + `reconcile()` enumerates
  all vault files, so an index built before the vault loaded is completed.
- Offline edits: late-reported files whose stat changed are re-read rather than
  adopting warm records (new regression test in `index.test.ts`). Events missed
  between plugin load and layout readiness are covered by the layout-ready
  reindex (creates, deletes and renames change the file set; edits change stat).
- Row reuse: signatures still include path, timestamp, created, rescues and
  conflict plus full source, so actions never act on stale entry content.
- Lazy drafts read the editor at flush; CodeMirror state stays readable after
  destroy, and save/discard still write `null` immediately.
- Editor prefix coloring decorates only the first line, so skipping
  viewport-only rebuilds is safe; settings updates always pass a new colors
  object through `updateColors`.
- Native clipboard paths are read only when the paste event has no files, so
  Chromium-supplied files are not attached twice.

- **KAR-031 (unconfirmed, 2026-11-03, 2.3.2): Hashtag added through Edit not
  shown.** Desktop, Edit button then Save: the saved note contained the tag
  (visible on reopening Edit) but the stream showed no tag; it later worked
  without a code change. Not reproduced with mocks, including vault modify
  events and the real refresh path; `view.test.ts` now covers the flow. If it
  recurs, note whether **Refresh stream and cache** makes the tag appear
  (stale row/cache) or not (rendering/tag extraction).

- **KAR-032 (usability, user request, 2.3.3): Three-Enter save in Edit.** Edit
  previously ignored the gesture by design; it now saves and closes the edit
  window like capture's gesture, with the same reset rules (typing, cursor
  movement, paste, Shift+Enter, focus loss) and list/image handling. Trailing
  newlines are trimmed on save. Native check pending.

- **KAR-033 (usability, user request, 2026-11-04, 2.3.4): Hashtag
  autocomplete.** Typing `#` plus a character in capture or Edit suggests
  existing vault tags from Obsidian's metadata cache, deduplicated
  case-insensitively. Enter/Tab completes the whole word; a fully typed tag lets
  Enter fall through so the three-Enter save is unchanged. Skipped mid-word, in
  code and inside wikilinks. Uses the undocumented `metadataCache.getTags()`
  when present, otherwise per-file `getAllTags`. Native check pending,
  including that `getTags()` exists and suggestions refresh after a new tag is saved.

## Performance and stability review — 2026-11-04, 2.3.4

Source review of all modules (no native profiling). Items KAR-034–KAR-037 were
fixed in 2.3.5 with regression tests that fail against 2.3.4. Not fixed, kept
for later: search highlighting walks into SVG/math text nodes and could break
diagrams while searching; the rebuild loop has no no-progress guard; one
IndexedDB error disables the local index for the session; captures, rescues and
deletes refresh the stream twice; minor per-keystroke/per-minute DOM work
(Edit todo icon, clock labels).

- **KAR-034 (performance, fixed in 2.3.5): Folder events rebuilt the link
  cache.** Any folder create, rename or delete anywhere in the vault cleared
  the wikilink cache, re-read metadata for every file and rewrote every record
  to IndexedDB — including a new month's first capture or attachment. Folder
  events now update only files under that folder (before the first index
  completes, the build still restarts). A new empty folder also no longer
  re-enumerates stream entries or refreshes views. Native check pending:
  folder rename/delete in Obsidian.
- **KAR-035 (performance, fixed in 2.3.5): Background verification grew with
  the stream.** It re-read and YAML-parsed about 1/15 of entries every minute,
  even with no stream open. Now a whole-text fingerprint skips parsing unchanged
  files, slices are capped at 256 files a minute, and verification runs only
  while a stream view is open and Obsidian is visible. Native check pending:
  pausing when hidden or minimized.
- **KAR-036 (stability, fixed in 2.3.5): Unreadable files refreshed the stream
  every minute.** Verification reported a change for any file that was
  failing, or failed to read while still cached, every time. It now reports
  only new failures and recoveries.
- **KAR-037 (stability, fixed in 2.3.5): Draft storage.** A refused draft
  write showed a notice on every flush (about every 250 ms while typing); now
  one notice per draft until a write succeeds. Stored Edit drafts no longer
  duplicate the entry's whole file text; conflicts are still detected by body,
  time and rescue count. Edit drafts for notes that no longer exist are
  removed at startup (only drafts written by 2.3.5 or later are tracked).
  Native check pending: a real localStorage quota error.

## Outstanding validation work — updated 2026-11-04, 2.3.5

The original KAR-001–KAR-015 findings below have implementation changes shipped.
Current work is validation/profiling and documented API limitations:

- 2.3.0 native checks: warm startup on a large vault without re-reading every
  entry (KAR-017); prefix/tag filter, Done, Undo notices, and search highlight
  appearance in light/dark themes (KAR-024–KAR-026, KAR-029); real Finder and
  Linux file-manager file paste (KAR-028). Revert to `known-good-2.2.13` if a
  2.3.x release misbehaves natively.
- 2.3.2/2.3.3 native checks: a stream tab left open at quit shows entries right
  after relaunch (KAR-030); three Enters at the end save and close Edit
  (KAR-032). 2.3.4: hashtag suggestions in capture and Edit, refreshed after
  saving a new tag (KAR-033). 2.3.5: folder rename/delete keeps link
  suggestions correct (KAR-034); verification pauses while hidden (KAR-035).
  Watch for a recurrence of the unconfirmed Edit hashtag report
  (KAR-031).
- Physical iPhone/iPad/Android keyboards, clipboard, background/resume, cache
  eviction, attachment behavior, scrolling latency, and peak memory.
- Minimum/current Obsidian, macOS/Linux, and native pop-out integration.
- OneDrive concurrent edit/rescue/delete conflicts and mobile trash recovery.
- Image-heavy stream memory, autocomplete filtering/paint time, and variable
  cold filesystem indexing at large vault sizes.
- Host-compatible URL-request cancellation/download limits; current concurrency
  limits do not abort a stalled response.

The latest list/image gesture behavior has automated coverage; the 2.2.4 native
repeat was unavailable. See [validation evidence](compatibility.md).
2.2.5 is documentation-only relative to 2.2.4.

## Historical review and shipped work

Review date: 2026-10-30. Baseline: **2.0.0**, commit `7b771c7`.
Scope: performance, stability, and desktop/mobile compatibility. No runtime
changes are included in this review.

**Priority:** P1 = address next because of draft safety or loss of access;
P2 = next hardening work; P3 = later improvement. See the delivery status below for implemented changes and remaining validation.
**Evidence:** Reproduced = exercised against current source with the existing
Obsidian mocks; inspection = established code path, not a measured device
failure; validation gap = needs host/device testing.

At the 2.0.0 review baseline, 92 tests, TypeScript checks, and the production build passed. Seven additional isolated
probes reproduce KAR-001 through KAR-007. These probes use in-memory vaults and
fake IndexedDB; no user notes were changed. Passing existing tests does not cover
the failure cases below.

## Performance follow-up — 2.2.0

Persistent wikilink records, startup preparation, and shared completion options
address the measured first-suggestion/editor-recreation cost in KAR-009.
Time-budgeted yielding and batched index writes/search reads reduce index and
search overhead. Regression tests cover schema upgrades, warm restoration,
alias/deletion freshness, multi-editor link targets, and bounded index batches.
See [updated measurements](compatibility.md). Large-vault physical-device peak
memory/latency, cold disk variability, CodeMirror filtering/paint cost, and the
existing device/sync matrix remain validation work, not claimed fixed.

## Delivery status — 2.1.0

KAR-001, KAR-007, KAR-013 and KAR-015 have code fixes and regression coverage.
KAR-008 through KAR-012 and KAR-014 have implementation changes; physical-device
performance, minimum-version/runtime compatibility, peak-memory, native pop-out,
and sync/trash matrix checks remain open. See [validation and operational
limits](compatibility.md). The original findings below are retained as the review
baseline, not descriptions of all current behavior. KAR-002 through KAR-006
shipped in 2.0.1. No distributed merge or conversion was introduced.

## Archived findings: protect drafts and keep the stream available

### KAR-001 — P1: Prevent multiple panes from overwriting drafts

**Reproduced.** [Draft keys](../src/main.ts#L158) are shared by all capture panes
for a base folder, while each [composer](../src/view.ts#L164) owns a separate
in-memory draft. Open two stream views, type in the first, then type and save in
the second: the first still displays its text, but its persisted draft is now
null. Reloading can lose that unsaved text. Concurrent editors of one entry have
the same ownership problem.

**Recommendation:** Either enforce one composer/editor per draft or implement
shared draft ownership with revision checks. A pane must not clear another
pane's draft. **Done when:** two-pane typing, saving, closing, and reloading
preserve every unsaved draft, including simultaneous entry editors.

### KAR-002 — P1: Isolate unreadable files during indexing

**Reproduced.** [Store.ready](../src/store.ts#L105) awaits every dirty candidate
through `Promise.all`. One persistent read error rejects both paging and counts,
even when other entries are readable. Reproduction: make one candidate's read
reject, then search for a different healthy entry. A partially downloaded or
temporarily inaccessible file could trigger this condition.

**Recommendation:** Track per-file failures, keep healthy entries available,
retry with backoff, and display an incomplete-index notice with retry details.
Avoid immediately re-adding the same failure in a tight loop. **Done when:** a
failing file never blocks healthy results, and recovery adds it automatically.

## Stability and sync hardening

### KAR-003 — P2: Release the loading state after cursor lookup failures

**Reproduced.** [refresh](../src/view.ts#L256) sets `loading = true` before
awaiting `cursorFor`, outside the cleanup in `read`. If that lookup rejects
while preserving a scrolled view, paging remains blocked by `loading` even
after the transient problem ends.

**Recommendation:** Wrap the complete refresh lifecycle in generation-aware
cleanup and restore retry controls. **Done when:** an injected cursor failure
leaves a usable retry action and subsequent paging succeeds without reopening.

### KAR-004 — P2: Refresh action snapshots after metadata-only changes

**Reproduced.** The [row signature](../src/view.ts#L370) excludes full source
metadata, but rescue/edit/delete/checkbox handlers capture the original entry,
including `source`. Add a custom YAML property externally and refresh: the row
is reused, then Rescue rejects with “changed elsewhere” despite showing the
latest stream. Reopening Edit from that row also starts with stale source.

**Recommendation:** Keep each row's action model current independently of visual
rendering, or include a source revision in invalidation. Retain stale-write
protection for genuinely outdated open editors. **Done when:** custom-property
and formatting-only changes refresh closed-row actions without losing metadata.

### KAR-005 — P2: Avoid full-history sorting on ordinary page reads

**Reproduced.** [remember](../src/store.ts#L128) marks ordering dirty on every
uncached body read, even when identity/order metadata is unchanged. After warm
startup and initial ordering, four sequential pages over 1,000 entries triggered
three additional full 1,000-entry sorts. This cost is omitted by a first-page-only
benchmark and grows with the vault.

**Recommendation:** Invalidate ordering/conflict detection only when membership,
identity, or sort keys change. **Done when:** scrolling unchanged cold-body pages
does not re-sort the full index; capture, rescue, deletion, and conflict copies
still update order correctly. Benchmark sustained paging at 50,000 entries.

### KAR-006 — P2: Reconcile same-stat changes made while the plugin is closed

**Reproduced under a specific condition.** [Warm restore](../src/store.ts#L30)
trusts matching file size and modification time. Close the store, replace
`oldtoken` with equal-length `newtoken` without changing those stats, then reopen:
search for `newtoken` returns no result until a body read or rebuild repairs the
cache. Active file events handle this case; changes while closed have no such
event. This is not evidence that every OneDrive update preserves these stats.

**Recommendation:** Add a deliberate reconciliation policy, such as bounded
background content verification, and report its freshness. Document the
performance/correctness tradeoff; stored hashes alone cannot detect a change
without rereading. **Done when:** same-stat replacements eventually update
search/order without requiring users to know they need a manual rebuild.

### KAR-007 — P2: Serialize settings updates and reconcile external changes

**Reproduced locally.** [rememberPrefix](../src/main.ts#L144) serializes only
prefix saves; [setSidebarsHidden](../src/main.ts#L189) and settings-tab updates
use separate snapshots. Delay a new-prefix save, enable sidebar hiding, then
finish the prefix save: the in-memory setting reverts to false. Synced
`data.json` changes also have no `onExternalSettingsChange` handler.

**Recommendation:** Use one settings mutation queue and explicit external-change
reconciliation, protecting active drafts when the base folder changes. This
does not eliminate distributed same-file sync conflicts. **Done when:**
overlapping local settings changes preserve both values and external updates
have documented, tested behavior.

## Performance budgets

### KAR-008 — P2: Bound work while typing and moving the cursor

**Inspection.** [Live preview](../src/preview.ts#L39) traverses the document's
syntax tree and scans all text for wikilinks on selection/viewport changes.
[Every edit](../src/editor.ts#L93) also materializes the entire body and
[writes the draft](../src/main.ts#L174) to local storage. Large pasted notes can
make typing/cursor movement expensive, independent of the stream's row limit.

**Recommendation:** Restrict decorations to visible/changed ranges and coalesce
draft persistence with lifecycle flushes. Preserve a clear crash-recovery
guarantee rather than silently weakening durability. **Done when:** publish
input-latency measurements for small, 100 KB, and 1 MB notes on desktop and a
physical phone, including background/resume draft recovery.

### KAR-009 — P2: Make cold indexing and completion responsive at scale

**Inspection and existing benchmark, not a new device measurement.** Paging
waits for the entire initial [dirty index](../src/store.ts#L105). Search scans
history, and [wikilink completion](../src/links.ts#L73) initially enumerates all
files, then rebuilds the full completion array after index revisions. The
documented 50,000-entry benchmark used simulated source reads; it does not
establish real storage or mobile latency.

**Recommendation:** Show indexing progress and partial-result status; benchmark
first usable view, cancellation, sparse/no-match searches, and first `[[` input.
Consider incremental completion construction and a searchable term index only
where profiling justifies them. **Done when:** record cold/warm p50/p95 results
at 1k/10k/50k entries with real filesystem reads and a mobile acceptance budget.

### KAR-010 — P2: Bound actual URL-title requests, not only UI lookups

**Inspection.** [pageTitle](../src/url-paste.ts#L41) receives a whole response
before slicing HTML to 256 KiB. The five-second lookup timeout removes tracking
but does not abort `requestUrl`; expired requests no longer count toward the
eight-lookup cap. Repeated slow or large URLs can therefore exceed the intended
network/memory budget, especially on mobile.

**Recommendation:** Track in-flight requests until settlement, add a bounded
queue and a title-fetch preference, and assess a host-compatible abort/body-size
strategy. Keep pasted URLs intact on failure. **Done when:** slow responses,
large downloads, repeated paste, and editor destruction cannot bypass the
chosen concurrency budget; document any API-level cancellation limitation.

### KAR-011 — P2: Establish attachment and rich-entry memory limits

**Inspection.** [Native clipboard reads](../src/clipboard.ts#L17) retain every
selected file in memory; [attachment saving](../src/store.ts#L278) then obtains
an entire `ArrayBuffer`. Stream rows retain entry bodies/source and rendered
media outside the 8 MiB LRU budgets. Limiting row count alone does not bound
memory for large files, images, or embeds.

**Recommendation:** Read native files sequentially through the upload pipeline,
provide file-size/progress guidance, and profile large-entry/media rendering
before choosing preview limits. **Done when:** multi-file and image-heavy tests
record peak memory on a phone and handle failures without losing earlier links
or drafts. Do not claim a fixed total memory ceiling from LRU sizes alone.

## Compatibility and recovery

### KAR-012 — P2: Define and verify the actual mobile/runtime support floor

**Validation gap plus a concrete syntax dependency.** The manifest advertises
mobile support and Obsidian 1.8.7+, but the URL-paste module contains a
[lookbehind regex](../src/url-paste.ts#L38). That syntax requires iOS 16.4+;
older engines fail while parsing the module, before a runtime fallback could
run. Whether an older OS can run the targeted Obsidian release must be part of
the compatibility matrix, not assumed from `minAppVersion`.

**Recommendation:** Remove this avoidable syntax requirement or document and
enforce an appropriate floor. Test minimum/current Obsidian with its supplied
CodeMirror modules, iPhone/iPad/Android keyboards, file/photo paste, IndexedDB
unavailability, and background/resume. **Done when:** publish a tested matrix
and distinguish simulated iOS input tests from physical-device results. See
[Obsidian mobile guidance](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development).

### KAR-013 — P2: Make pop-out window handling realm-safe

**Inspection; native pop-out validation pending.** The stream's
[link-click handler](../src/view.ts#L437) uses `event.target instanceof Element`
from the main window. It can reject elements from another window. Several
elements/observers also use global `document`/`window`; folder hiding injects its
stylesheet only into the main document, despite iterating other documents.

**Recommendation:** Use owning documents/windows and Obsidian's cross-window
helpers, and initialize/clean up per-window hiding resources. **Done when:**
moving a stream/explorer to a pop-out preserves links, attachment pickers,
completion placement, folder hiding, and cleanup. See
[Obsidian pop-out guidance](https://docs.obsidian.md/plugins/guides/pop-out-windows).

### KAR-014 — P3: Add storage diagnostics and recovery tools

**Known limitation/product improvement.** [Path filtering](../src/model.ts#L67)
excludes entries renamed outside the date/month convention; invalid YAML
metadata is silently [excluded](../src/model.ts#L104). Conflict copies are shown
only if their paths and metadata remain recognizable. Deletion deliberately
retains attachments; failed/discarded captures can leave unused uploads too.

**Recommendation:** Add a read-only storage-health report for skipped files,
duplicate identities, and potentially unreferenced attachments, with source
links and explicit repair/recovery actions. Audit trash restoration on mobile
and same-entry edit/rescue/delete races across devices. **Done when:** users can
explain missing entries and recover them without automatic destructive cleanup;
attachment removal always requires review. Same-entry distributed merging
remains a separate product decision, not a promise of file-per-entry storage.

### KAR-015 — P3: Limit folder-hiding observation to relevant UI

**Inspection.** [Folder hiding](../src/main.ts#L215) observes child-list changes
across entire document bodies and rescans all explorer folder titles on the
next frame. Composer edits, Markdown rendering, and unrelated plugins can all
schedule that scan. New pop-out explorers are not automatically added to the
observer set.

**Recommendation:** Observe explorer containers, update affected subtrees, and
track explorer/window lifecycle. **Done when:** typing in a large vault does not
cause full explorer scans and newly opened explorers apply hiding immediately.

## Original delivery order (historical)

1. KAR-001 and KAR-002: draft ownership and fault isolation.
2. KAR-003 through KAR-007: refresh/action correctness, sort cost, cache freshness,
   and settings concurrency.
3. KAR-012/KAR-013 plus measured budgets for KAR-008 through KAR-011.
4. Recovery diagnostics and observer scoping.

Retain the current strengths: independent capture files, rescue in place,
`Vault.process` plus source validation for edits, rebuildable device-local
indexes, and bounded page rendering. Obsidian's
[Vault documentation](https://docs.obsidian.md/Plugins/Vault) supports the
atomic local update approach; it does not provide distributed sync merging.
