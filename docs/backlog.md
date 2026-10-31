# Product backlog

## Current outstanding work — 2026-10-31, 2.2.5

The original KAR-001–KAR-015 findings below have implementation changes shipped.
Current work is validation/profiling and documented API limitations:

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
