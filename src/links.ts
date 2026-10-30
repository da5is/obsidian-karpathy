import { App, parseFrontMatterAliases, TAbstractFile, TFile } from "obsidian";
import { Completion, CompletionContext, CompletionSource, pickedCompletion } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

interface Candidate { path: string; label: string; display: string; alias?: string }

// Only the filename portion is completed. Existing headings and display text
// survive selecting a different file, but do not trigger their own suggestions.
export function wikilinkRange(state: EditorState, pos: number) {
  if (state.readOnly || !state.selection.main.empty || state.selection.ranges.length !== 1) return null;
  const line = state.doc.lineAt(pos);
  const before = state.sliceDoc(line.from, pos);
  const opening = before.lastIndexOf("[[");
  if (opening < 0 || before[opening - 1] === "[") return null;
  const escapes = /\\*$/.exec(before.slice(0, opening))![0].length;
  if (escapes % 2 || /[\[\]\n|#^]/.test(before.slice(opening + 2))) return null;
  for (let node = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent!) {
    if (["FencedCode", "CodeBlock", "InlineCode", "Comment", "HTMLBlock"].includes(node.name)) return null;
  }
  const from = line.from + opening + 2;
  const after = state.sliceDoc(pos, line.to);
  const nameEnd = pos + /^[^\[\]\n|#^]*/.exec(after)![0].length;
  const suffix = /^[|#^][^\[\]\n]*/.exec(state.sliceDoc(nameEnd, line.to))?.[0] ?? "";
  const end = nameEnd + suffix.length;
  const closing = /^\]{1,2}/.exec(state.sliceDoc(end, line.to))?.[0].length ?? 0;
  return { from, end: end + closing, suffix };
}

export class WikilinkIndex {
  private records = new Map<string, Candidate[]>();
  private indexed = false;
  private revision = 0;
  private building?: Promise<void>;
  private async ensureIndexed(): Promise<void> {
    if (this.indexed) return;
    if (!this.building) this.building = (async () => {
      const revision = this.revision;
      const files = this.app.vault.getFiles();
      for (let i = 0; i < files.length; i += 256) {
        if (revision !== this.revision) return;
        for (const file of files.slice(i, i + 256)) if (this.app.vault.getAbstractFileByPath(file.path) === file) this.add(file);
        if (i + 256 < files.length) await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (revision === this.revision) this.indexed = true;
    })().finally(() => { this.building = undefined; });
    await this.building;
  }

  constructor(private app: App) {}

  clear(): void {
    this.records.clear();
    this.indexed = false;
    this.revision++;
  }

  changed(file: TAbstractFile, oldPath?: string): void {
    if (!this.indexed) { if (this.building) this.clear(); return; }
    // Folder moves can change many child paths with a single vault event.
    if (!(file instanceof TFile)) { this.clear(); return; }
    const previous = JSON.stringify(this.records.get(file.path));
    if (oldPath) this.records.delete(oldPath);
    this.records.delete(file.path);
    if (this.app.vault.getAbstractFileByPath(file.path) === file) this.add(file);
    if (oldPath || previous !== JSON.stringify(this.records.get(file.path))) this.revision++;
  }

  private add(file: TFile): void {
    if (/[\[\]|#^\r\n]/.test(file.path)) return;
    const label = file.extension === "md" ? file.path.slice(0, -3) : file.path;
    const display = file.extension === "md" ? file.basename : file.name;
    const candidates: Candidate[] = [{ path: file.path, label, display }];
    const aliases = parseFrontMatterAliases(this.app.metadataCache.getFileCache(file)?.frontmatter) ?? [];
    for (const alias of new Set(aliases)) {
      if (alias.trim() && alias !== display && !/[\[\]|#^\r\n]/.test(alias))
        candidates.push({ path: file.path, label: alias, display: alias, alias });
    }
    this.records.set(file.path, candidates);
  }

  source(sourcePath: () => string): CompletionSource {
    let revision = -1;
    let matchPaths = false;
    let options: Completion[] = [];
    return async (context: CompletionContext) => {
      const range = wikilinkRange(context.state, context.pos);
      if (!range) return null;
      await this.ensureIndexed();
      if (!this.indexed || context.aborted) return null;
      const paths = context.state.sliceDoc(range.from, context.pos).includes("/");
      if (revision !== this.revision || paths !== matchPaths) {
        const buildRevision = this.revision;
        const built: Completion[] = [];
        let count = 0;
        for (const candidates of this.records.values()) for (const candidate of candidates) {
          built.push({
          label: paths ? candidate.label : candidate.display,
          displayLabel: candidate.display,
          detail: candidate.path,
          apply: (view, completion, from) => {
            const current = wikilinkRange(view.state, view.state.selection.main.head);
            if (!current || current.from !== from) return;
            const file = this.app.vault.getAbstractFileByPath(candidate.path);
            if (!(file instanceof TFile)) return;
            const link = this.app.metadataCache.fileToLinktext(file, sourcePath(), true);
            const alias = candidate.alias && !current.suffix.includes("|") ? `|${candidate.alias}` : "";
            const insert = `${link}${current.suffix}${alias}]]`;
            view.dispatch({
              changes: { from, to: current.end, insert },
              selection: { anchor: from + insert.length },
              annotations: pickedCompletion.of(completion),
              userEvent: "input.complete", scrollIntoView: true
            });
            view.focus();
          }
          });
          if (++count % 256 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
            if (context.aborted || buildRevision !== this.revision) return null;
          }
        }
        revision = buildRevision; matchPaths = paths; options = built;
      }
      const resultRevision = revision;
      return {
        from: range.from, options,
        validFor: (text, from, to, state) => resultRevision === this.revision && text.includes("/") === paths && wikilinkRange(state, to)?.from === from
      };
    };
  }
}
