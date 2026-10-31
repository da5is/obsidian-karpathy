# Development on another machine

## Fresh checkout

Install Git and Node.js 24 (the Windows checks used Node 24.22.1). GitHub CLI is
needed only for publishing, not for building or testing. From any source folder:

```sh
git clone https://github.com/da5is/obsidian-karpathy.git
cd obsidian-karpathy
npm ci
npm test
npm run build
```

A clean source export was verified with a fresh dependency install, all 120 tests,
the build, and fixture generation on Windows/Node 24 for 2.2.2. macOS/Linux
portability has been reviewed but not executed on those operating systems.

No Obsidian installation, personal vault, credentials, or previous chat is needed
for the automated suite. It uses Node's test runner, jsdom, fake IndexedDB, and
mocked Obsidian/Electron APIs. The production bundle uses Obsidian's own
CodeMirror modules. Passing the mocks does not validate those host modules.

No scripts require the original author's Windows paths. Windows-looking paths
in tests are fixture strings, not directories to create. Keep the checkout
outside a real vault where possible, so dependencies do not get indexed/synced.

## Disposable native test vault

Install the Obsidian desktop application when testing native UI integration.
After building, run from the checkout:

```sh
node scripts/create-test-vault.mjs "../karpathy-test-vault"
```

The parent directory must exist; the destination must **not** exist. The helper
copies only the three plugin assets and creates three valid version-2 entries,
reference notes/aliases, and an HTML clipboard example. It never erases a vault,
changes another installation, copies personal settings, or enables plugins.

Open the generated folder using Obsidian's **Open folder as vault**, allow
community plugins, enable Karpathy, then run **Karpathy: Open stream**. Verify
the full vault path rather than its display name. Expect three entries; the
reference notes are autocomplete targets and do not count as stream entries.

For subsequent builds, close/disable the plugin, copy `main.js`, `manifest.json`,
and `styles.css` to that vault's `.obsidian/plugins/karpathy/`, then reopen/enable.
Preserve `data.json`. Generate another new vault for a clean test; never clean a
user's notes merely to make testing easier. Keep fixtures outside Git and sync.

## Coverage and native smoke checks

`npm test` provides the same reproducible automated suite on a fresh checkout.
Use the thick client for visible UI changes, clipboard/host integration, themes,
window behavior, and release smoke checks. A browser harness cannot substitute
for the native host. Record app/OS versions and actual observations separately
from mocked tests. If the host is unavailable, state that gap explicitly.

1. Open stream; check count, theme headings, separators, actions, and scrolling.
2. Capture with Save, Ctrl/Cmd+Enter, and triple Enter. Verify focus and an empty
   first line afterward. Continue bullets, then exit an empty bullet.
3. Complete `[[Project` and `[[Launch` in capture and Edit; verify the saved target.
4. Rescue, edit, toggle a checkbox, and delete one sample; inspect the Markdown.
5. Search for `sample`; refresh, reload, and verify restored entries and drafts.
6. Open `clipboard-sample.html` in a browser. Copy just the linked text; with
   **Fetch pasted URL titles** disabled, paste and expect
   `[Local clipboard title](https://example.com/article)` if HTML was supplied.
   Also try a bare URL, selected editor text, and code-block paste. Record the
   source app: not all copy operations expose a title.
7. Paste/attach a local image and file. Verify links, preview, and monthly folder.
8. Check sidebar-toggle command, storage health, and a native pop-out window.

A narrow desktop window does not validate iPhone/iPad/Android. On physical
mobile test soft keyboards/IME, photo/file selection, background/resume, cache
eviction, scrolling/memory, and trash restore. Use a separate disposable synced
vault for OneDrive conflict tests. See [compatibility](compatibility.md).

## Benchmarks and publishing

Historical timings and their limits are in `compatibility.md`. The original
`.release-work/` benchmark harnesses and 50k-file fixtures are intentionally
untracked and are **not** prerequisites or reproducible from a fresh clone.
Recreate a benchmark explicitly before claiming comparable new measurements.

Follow `AGENTS.md`'s standing commit/push/release instruction. Authenticate `gh`
on the new machine; do not copy credentials. Increment `package.json`, both root
version fields in `package-lock.json`, `manifest.json`, and `versions.json`.
Run tests/build, commit, push main, then publish against that exact commit:

```sh
gh release create VERSION main.js manifest.json styles.css --target COMMIT --title "Karpathy VERSION" --notes-file RELEASE_NOTES.md
```

Use a temporary/untracked notes file. Download release assets to a fresh temporary
directory and compare SHA-256 hashes with the build. Never publish notes,
settings, test-vault files, or cached indexes. Verify a clean Git working tree.
