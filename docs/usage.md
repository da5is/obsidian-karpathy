# Using Karpathy

Detailed behavior reference. For a quick overview, see the [README](../README.md).

## Capture, edit, and review

- Open **Karpathy: Open stream** from the command palette.
- Write Markdown. Save with **Ctrl/Cmd+Enter**, three consecutive plain Enter presses at the end, or **Save**, both when capturing and in **Edit**. Existing blank lines do not count. Typing, cursor movement, paste, Shift+Enter, or leaving the editor resets the gesture. Two Enter presses keep a paragraph break.
- Headings, text fonts, colors, and reading width follow your selected Obsidian theme. Compact panes keep the entry actions visible as icons with generous tap targets.
- Enter continues bullets, numbered lists, and checklists. For a normal list: first Enter continues the bullet, second removes the empty bullet, third adds spacing, fourth saves. Nested lists exit one level at a time; those intermediate steps do not advance the save gesture. **Shift+Enter** inserts a plain newline.
- Paste images and files (including files copied in Windows Explorer, macOS Finder, or Linux file managers), or use the file and photo buttons beside Save. Enter at the end of an image/embed line moves below it without counting toward save; three more consecutive Enters save.
- Paste a single HTTP/HTTPS URL to turn it into `[page title](url)` in capture or Edit. Paste over selected text to use that text as the label. A single rich clipboard link supplies its label immediately without a request, even with network fetching disabled. When no usable clipboard label is available, title lookup contacts the linked page directly; it does not send note content. Typing stays available during lookup. If the page is unavailable, has no title, takes more than five seconds, or you save first, the original URL is kept. Code and existing link destinations keep normal paste behavior. Undo reverses a title conversion.
- Capture and Edit share file, photo, todo/done, and Save controls. Use the todo button beside the attachment buttons to prepend `todo:`. On a draft beginning with `todo:`, it changes the prefix to `done:` and appends `Completed: YYYY-MM-DD` using the device local date. Completed drafts disable the button; Undo restores the previous text. Save commits the change.
- Type `[[` in capture or Edit to suggest existing files and aliases from anywhere in the vault. Filter by typing, select with arrows and Enter/Tab or tap a result, and press Escape to dismiss. Folder paths distinguish duplicate names. Heading and block suggestions are not included yet.
- Type `#` and at least one letter in capture or Edit to suggest hashtags already used in the vault (inline and frontmatter `tags`, nested tags such as `#project/alpha` included). Case variants appear once, using the most common spelling. Enter or Tab completes the whole word; if the tag is already fully typed, Enter is not used up and still counts toward the three-Enter save. Suggestions are not offered mid-word, in code, or inside `[[links]]`; Ctrl+Space opens the full list after a bare `#`.
- Saved images are centered in the stream. Tags appear below the written/rescue line with a muted “tags:” label and commas between bold clickable tags. Hashtags use the same theme bold weight as colon prefixes, have no pill background and receive stable, case-insensitive colors from the prefix theme palette, without customization; the source Markdown stays unchanged.
- Search from the header. Search matches note text (not file paths or dates), and matching words are highlighted. Click a colored prefix such as `todo:` or a tag in the stream to show only entries containing it; Ctrl/Cmd-click a tag for Obsidian's own tag search.
- Use **Rescue** to move an entry to the top; **Edit** changes it in place. Entries starting with `todo:` also show **Done**, which makes the same `done:` / `Completed: YYYY-MM-DD` change as the capture button.
- Choose **Delete entry** from an entry's **…** menu and confirm to remove it. Other entries and attachments are kept.
- Rescue and Delete show a short notice with **Undo**. Undoing a rescue restores the earlier position if the entry has not changed since; undoing a delete recreates the identical note at its original path (the trashed copy stays in the trash).
- Start with `todo:`, `read:`, `buy:`, or `ref:` for theme-colored prefixes. New prefixes join the settings list when first saved.
- Enable **Hide sidebars** in settings to hide both sidebars and the left ribbon. Restore them with **Karpathy: Toggle hidden sidebars** in the command palette or turn off the setting. This applies throughout the vault and is removed when the plugin is disabled.

Each entry is a separate Markdown file in its creation month:

```text
Karpathy/2026/2026-10/2026-10-25-091530123-a1b2c3d4e5f6.md
Karpathy/2026/2026-10/attachments/
```

The base folder is configurable. Leave **Base notes folder** blank (or enter `/`) and click **Apply** to use the vault root: `2026/2026-10/2026-10-25-091530123-a1b2c3d4e5f6.md`, with attachments in `2026/2026-10/attachments/`. Changing the folder does not move existing files or import arbitrary Markdown notes into the stream.

Entries use standard YAML properties (`karpathy`, `id`, `created`, `rescued`, `rescues`) followed by ordinary Markdown. Rescue updates the same file without moving it, preserving links and its creation date. Delete moves only that entry file to trash; attachments are retained. Attachment filenames include a random suffix to avoid cross-device collisions.

A rebuildable IndexedDB index stays on each device, outside the synced vault. It stores ordering and search data; entry files remain authoritative. Paging and memory caches stay bounded. Use **Refresh stream and cache** to rebuild the index. Conflicting copies with the same entry ID are shown separately and marked for review. Editing the same entry on two devices still depends on your sync tool's conflict policy.


## Other behavior

Prefixes at the start of loaded stream entries are automatically registered with theme colors, including notes created on other devices. Discovery runs as entries are displayed (including paging and search), preserves custom colors, and does not modify note files.

Capture and Edit enable native keyboard autocorrection alongside spellcheck and sentence capitalization. Actual corrections depend on the device keyboard settings and host support.

## Reliability and diagnostics

Use **Karpathy: Review storage health** to find skipped or renamed entries, duplicate identities, and potentially unused attachments. Restoring an entry path requires confirmation and never overwrites an existing file.

One pane owns each capture/edit draft. Large drafts use source editing; attachments are limited to 50 MiB each. **Fetch pasted URL titles** can be disabled in settings. See [compatibility, performance checks, and limits](compatibility.md).
