# Karpathy for Obsidian

One stream for quick notes, tasks, links, and the thoughts between tasks. Capture at the top, scroll back to review, and rescue anything worth bringing back to your attention.

Inspired by Andrej Karpathy's [append-and-review note](https://karpathy.bearblog.dev/the-append-and-review-note/). This is an independent community plugin, not affiliated with Andrej Karpathy.

![A sample stream with quick notes and rescue history](docs/images/stream.png)

<img src="docs/images/narrow.png" alt="The same stream at a narrow screen width" width="390">

*Demo previews rendered from the plugin UI with sample notes. The narrow preview is not a physical-device screenshot.*

## Use

- Open **Karpathy: Open stream** from the command palette.
- Write Markdown. Save with **Ctrl/Cmd+Enter**, three Enter presses, or **Save**. Two Enter presses keep a paragraph break.
- Paste images and files, or use the file and photo buttons beside Save.
- Search from the header. Use **Rescue** or swipe right to move an entry to the top; **Edit** changes it in place.
- Start with `todo:`, `read:`, `buy:`, or `ref:` for theme-colored prefixes. New prefixes join the settings list when first saved.

Notes stay in your vault as daily Markdown files:

```text
Karpathy/2026/2026-10/2026-10-25.md
Karpathy/2026/2026-10/attachments/
```

The base folder is configurable. Entries use HTML comments for boundaries and metadata. Rescue moves the original into today's file while retaining its creation time and existing attachment links. Incremental loading and bounded caches keep the stream from rendering your entire history at once.

## Install with BRAT

1. Install and enable [BRAT](https://github.com/TfTHacker/obsidian42-brat) in Obsidian.
2. Run **BRAT: Add a beta plugin for testing** and enter `da5is/obsidian-karpathy` (or this repository's URL).
3. Select the latest release, then enable **Karpathy** in Community plugins.

For manual installation, download `main.js`, `manifest.json`, and `styles.css` from [Releases](https://github.com/da5is/obsidian-karpathy/releases/latest) into your vault's `.obsidian/plugins/karpathy/` folder.

Designed for desktop, iPhone/iPad, and Android. Desktop capture and rescue have been checked in Obsidian; physical mobile testing is still needed. Clipboard support depends on the OS. Live formatting covers common Markdown; advanced tables and callouts render after saving.

## Development

```sh
npm ci
npm test
npm run build
```

The production bundle is `main.js`. Settings, drafts, vault notes, and dependencies are not part of this repository.

MIT licensed.
