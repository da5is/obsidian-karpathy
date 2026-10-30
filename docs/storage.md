# Entry storage

Version 2 stores one entry per Markdown file. It does not convert version 1 daily
files. Update all devices and start with a clean capture folder before use.
Existing daily files remain untouched, but do not appear in the version 2 stream.

## Files and metadata

```text
Karpathy/2026/2026-10/2026-10-30-091530123-a1b2c3d4e5f6.md
Karpathy/2026/2026-10/attachments/photo-20261030141530123-a1b2c3d4e5f6.jpg
```

The base folder may be the vault root. Entry filenames contain local creation
date/time and a cryptographically random suffix. The file stays in its creation
month when rescued. Keep the date prefix and monthly folder layout when renaming;
conflict suffixes are accepted. Attachment links are vault-relative, and their
filenames also have independent random suffixes.

```yaml
---
karpathy: 2
id: 20261030141530123-a1b2c3d4e5f6
created: "2026-10-30T14:15:30.123Z"
rescued: null
rescues: 0
---
```

Ordinary Markdown follows the properties. There are no entry-boundary comments
or generated timestamp headings. Custom YAML properties survive edits and
rescue, although YAML formatting/comments may be normalized. Rescue updates
`rescued` and `rescues` atomically in the same file; creation time and links stay
unchanged. Stream order uses rescue/creation metadata, not filesystem timestamps.
Delete sends that entry file to trash and retains its attachments.

## Local index and performance

Each vault has a device-local IndexedDB cache, outside its synced files. Small
metadata records support ordering and counts; normalized search text is stored
separately on disk. Startup reuses records whose file size and modification time
still match. File events invalidate individual records, including same-stat
changes. An explicit **Refresh stream and cache** rebuilds from Markdown.

There is no shared index file to synchronize. Missing or unavailable IndexedDB
falls back to reading Markdown. A first build must read the entry files to find
rescued entries in older folders. Rebuilds yield between batches; file reads use
at most eight concurrent operations. Search reads the local index in batches of
64 and scans at most 256 entries per page call. The stream retains at most 120
rendered entries. Parsed-body and search-text memory caches each have an 8 MiB
budget and separate item limits. The small ordering index grows with file count.

A development benchmark with 50,000 short entries in headless Edge and real
IndexedDB measured approximately 10.9 seconds for a first index build, 0.63
seconds to reopen/count, 10 ms to load 30 entries, and 1.8 seconds for a full
history search. Reopening/counting read no Markdown; loading the page read 30
files; search read just its one matching file. Source-file reads were simulated
in memory. These are architectural checks, not physical mobile, filesystem, or
OneDrive throughput guarantees.

## Sync and recovery

Independent captures use different files. Edits and rescues verify the current
document before updating it. Conflicting copies retaining the same entry ID are
shown separately with a warning; review their source notes and preserve the
desired content before removing an extra copy. Invalid entry metadata is not
interpreted as an entry and is never automatically repaired or overwritten.

File-level synchronization still controls concurrent edits, rescues, or deletion
of the same entry. Karpathy does not implement a distributed merge or transaction
across devices. A last-write-wins sync policy can still discard a competing edit
or rescue increment. Notes and attachments may arrive separately. Sync completion
and backups remain the sync tool's responsibility.

Drafts are device-local. Cached search text is also stored locally and is removed
when the corresponding deletion is processed, or when the index is rebuilt.

## Verification and unavailable files (2.0.1)

Warm cached results remain available immediately. A background content check starts
after one minute and repeats fifteen minutes after each full check completes.
It rereads eight files at a time with pauses between batches, detecting changes
that preserved size and modification time while the plugin was closed. Results
may be stale until verification finishes; Refresh stream and cache forces a rebuild.
Unreadable files are excluded from results and reported beside the count. They
are retried on the next one-minute maintenance tick or a relevant file event.
Maintenance stops when the plugin closes; no entry files are changed by verification.
