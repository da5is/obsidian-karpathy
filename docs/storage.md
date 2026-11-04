# Entry storage

For a self-contained guide an LLM can follow while reading/editing vault content,
see [vault instructions](VAULT_LLM_GUIDE.md). This document describes the plugin
storage and cache implementation.

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
metadata records support ordering and counts; normalized search text (the note
body only, without paths or timestamps) is stored separately on disk. Each record
also carries a 32-bit fingerprint of its search text. Startup reuses records whose
file size and modification time still match. Vault file events are registered
after the workspace layout is ready, because Obsidian emits a create event for
every existing file while a vault loads; records for files reported after startup
are adopted when their stats match, and records for files that never appear are
pruned in one transaction. File events invalidate individual records, including
same-stat changes; the persisted record stays until the re-read replaces it, and
records still awaiting a re-read are removed when the plugin closes. An explicit
**Refresh stream and cache** rebuilds from Markdown.

There is no shared index file to synchronize. Missing or unavailable IndexedDB
falls back to reading Markdown. A first build must read the entry files to find
rescued entries in older folders. Rebuilds yield based on elapsed work and persist up to 32 records per transaction; file reads use
at most eight concurrent operations. Search reads the local index in batches of
256 and scans at most 256 entries per page call. The stream retains at most 120
rendered entries. Parsed-body and search-text memory caches each have an 8 MiB
budget and separate item limits. The small ordering index grows with file count.

Wikilink filenames and aliases have a separate device-local cache, validated
against live file stats on startup. Completion options are prepared after layout
readiness and shared across editors. Host metadata is reconciled at startup;
subsequent file/alias events update individual records. Completion still waits
if requested before preparation finishes. An explicit refresh also rebuilds
suggestions. No Markdown bodies are scanned for wikilink completion.

Hashtag suggestions are not cached on the device. They come from Obsidian's
metadata cache (its vault-wide tag table where available, otherwise each
Markdown file's cached tags) and are rebuilt on the next suggestion after any
metadata change, deletion, resolve, or explicit refresh. No Markdown bodies are
read for them either.

See [performance checks](compatibility.md) for filesystem and real-IndexedDB
measurements and their limits. The indexes grow with file count; these are not
mobile-memory or OneDrive throughput guarantees.

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

## Verification and unavailable files (2.0.1, revised 2.3.0)

Warm cached results remain available immediately. Every minute, a background
check rereads a rotating slice of about one fifteenth of the entries (at least
eight), so each file is verified roughly every fifteen minutes without a
full-vault burst. It reads eight files at a time with pauses between batches,
detecting changes that preserved size and modification time while the plugin
was closed. Unchanged files are not rewritten to the index, and files not already
in the memory caches are not added to them. Results may be stale until
verification reaches a file; Refresh stream and cache forces a rebuild.

Search text from releases before 2.3.0 included paths and timestamps. Those
records are replaced as entries change or are verified, normally within fifteen
minutes; Refresh stream and cache replaces them immediately.
Unreadable files are excluded from results and reported beside the count. They
are retried on the next one-minute maintenance tick or a relevant file event.
Maintenance stops when the plugin closes; no entry files are changed by verification.
