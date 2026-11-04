import { App, getAllTags } from "obsidian";
import { Completion, CompletionContext, CompletionSource, pickedCompletion, selectedCompletion } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

// Obsidian tag characters: anything but whitespace and ASCII punctuation other than - _ /.
const TAG_CHARS = "[^\\s!-,.:-@\\[-^`{-~]";
const BEFORE = new RegExp(`(^|\\s)#(${TAG_CHARS}*)$`, "u");
const AFTER = new RegExp(`^${TAG_CHARS}*`, "u");
const VALID = new RegExp(`^#${TAG_CHARS}+$`, "u");
const TAG_TYPE = "karpathy-tag";

// The hashtag being typed at `pos`: from its `#` to the end of the word, which
// may continue past the cursor. Tags must follow whitespace or a line start.
export function tagRange(state: EditorState, pos: number) {
  if (state.readOnly || !state.selection.main.empty || state.selection.ranges.length !== 1) return null;
  const line = state.doc.lineAt(pos);
  const before = state.sliceDoc(line.from, pos);
  const match = BEFORE.exec(before);
  if (!match) return null;
  // Wikilink headings (`[[Note #`) and code are not tags.
  if (before.lastIndexOf("[[") > before.lastIndexOf("]]")) return null;
  for (let node = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent!) {
    if (["FencedCode", "CodeBlock", "InlineCode", "Comment", "HTMLBlock", "URL"].includes(node.name)) return null;
  }
  const from = line.from + match.index + match[1].length;
  const end = pos + AFTER.exec(state.sliceDoc(pos, line.to))![0].length;
  return { from, end, query: match[2] };
}

// Enter should not be spent "accepting" a tag that is already fully typed:
// the three-Enter save gesture would otherwise need a fourth press.
export function acceptingTagChangesNothing(state: EditorState): boolean {
  const completion = selectedCompletion(state);
  if (completion?.type !== TAG_TYPE) return false;
  const range = tagRange(state, state.selection.main.head);
  return !!range && state.sliceDoc(range.from, range.end) === completion.label;
}

// Existing vault hashtags (inline and frontmatter), rebuilt lazily after metadata changes.
export class TagIndex {
  private options: Completion[] = [];
  private dirty = true;

  constructor(private app: App) {}

  changed(): void { this.dirty = true; }

  private build(): void {
    // Lower-cased tag -> spelling -> uses. Obsidian treats tags case-insensitively;
    // offer the most common spelling once.
    const spellings = new Map<string, Map<string, number>>();
    const add = (raw: string, count: number) => {
      const tag = raw.startsWith("#") ? raw : `#${raw}`;
      if (!VALID.test(tag) || /^#\d+$/.test(tag)) return;
      const key = tag.toLocaleLowerCase();
      const counts = spellings.get(key) ?? new Map<string, number>();
      counts.set(tag, (counts.get(tag) ?? 0) + count);
      spellings.set(key, counts);
    };
    // getTags() is Obsidian's own vault-wide tag table; it is not in the public
    // typings, so fall back to per-file metadata when it is unavailable.
    const cache = this.app.metadataCache as unknown as { getTags?: () => Record<string, number> };
    if (typeof cache.getTags === "function") {
      for (const [tag, count] of Object.entries(cache.getTags() ?? {})) add(tag, typeof count === "number" ? count : 1);
    } else {
      for (const file of this.app.vault.getMarkdownFiles()) {
        const metadata = this.app.metadataCache.getFileCache(file);
        if (metadata) for (const tag of new Set(getAllTags(metadata) ?? [])) add(tag, 1);
      }
    }
    this.options = [...spellings.values()].map(counts => {
      const [tag] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
      return { label: tag, type: TAG_TYPE, apply: this.apply(tag) } satisfies Completion;
    });
    this.dirty = false;
  }

  private apply(tag: string): NonNullable<Completion["apply"]> {
    return (view, completion, from) => {
      const current = tagRange(view.state, view.state.selection.main.head);
      if (!current || current.from !== from) return;
      view.dispatch({ changes: { from, to: current.end, insert: tag }, selection: { anchor: from + tag.length },
        annotations: pickedCompletion.of(completion), userEvent: "input.complete", scrollIntoView: true });
      view.focus();
    };
  }

  source(): CompletionSource {
    return (context: CompletionContext) => {
      const range = tagRange(context.state, context.pos);
      // A bare `#` is usually a heading; wait for a character unless asked explicitly.
      if (!range || (!range.query && !context.explicit)) return null;
      if (this.dirty) this.build();
      if (!this.options.length) return null;
      return { from: range.from, options: this.options,
        validFor: (text, from, to, state) => text.length > 1 && tagRange(state, to)?.from === from };
    };
  }
}
