import { EditorView } from "@codemirror/view";
import { LocalIndex } from "./index";
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

interface LinkRecord { path: string; mtime: number; size: number; candidates: Candidate[] }

export class WikilinkIndex {
  private records = new Map<string, LinkRecord>();
  private indexed = false;
  private reuseDisk = true;
  private revision = 0;
  private generation = 0;
  private building?: Promise<void>;
  private preparing?: Promise<void>;
  private reconciling?: Promise<void>;
  private closed = false;
  private touched = new Set<string>();
  private pending = new Map<string, LinkRecord | undefined>();
  private disk: LocalIndex;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private flushes: Promise<void> = Promise.resolve();
  private optionRevision = -1;
  private names: Completion[] = [];
  private paths: Completion[] = [];
  private sources = new WeakMap<EditorView, () => string>();

  constructor(private app: App) { this.disk = new LocalIndex(app); }

  // Called after layout is ready, before the user needs the first suggestion.
  prepare(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (!this.preparing) this.preparing = (async () => {
      while (!this.closed) {
        await this.ensureIndexed();
        if (!this.indexed) continue;
        await this.buildOptions();
        if (this.optionRevision === this.revision) break;
      }
    })().finally(() => { this.preparing = undefined; });
    return this.preparing;
  }
  private async ensureIndexed(): Promise<void> {
    if (this.indexed || this.closed) return;
    if (!this.building) this.building = (async () => {
      const generation = this.generation;
      const saved = new Map((await this.disk.linkRecords<LinkRecord>()).filter(value =>
        value && typeof value.path === "string" && Array.isArray(value.candidates) &&
        value.candidates.every(candidate => candidate && candidate.path === value.path &&
          typeof candidate.label === "string" && typeof candidate.display === "string" &&
          (candidate.alias === undefined || typeof candidate.alias === "string")))
        .map(value => [value.path, value]));
      const files = this.app.vault.getFiles();
      const present = new Set<string>();
      let yielded = performance.now();
      for (const file of files) {
        if (this.closed || generation !== this.generation) return;
        if (this.app.vault.getAbstractFileByPath(file.path) !== file) continue;
        present.add(file.path);
        const cached = saved.get(file.path);
        if (this.reuseDisk && !this.touched.has(file.path) && cached && cached.mtime === file.stat.mtime && cached.size === file.stat.size &&
            cached.candidates[0]?.display === (file.extension === "md" ? file.basename : file.name)) {
          this.records.set(file.path, cached);
        } else this.add(file);
        if (performance.now() - yielded > 8) { await new Promise(resolve => setTimeout(resolve, 0)); yielded = performance.now(); }
      }
      for (const path of saved.keys()) if (!present.has(path)) this.queue(path, undefined);
      if (generation === this.generation && !this.closed) { this.indexed = true; this.reuseDisk = true; this.touched.clear(); }
    })().finally(() => { this.building = undefined; });
    await this.building;
  }
  clear(): void {
    this.reuseDisk = false;
    this.records.clear(); this.indexed = false; this.generation++; this.revision++;
    this.names = []; this.paths = []; this.optionRevision = -1;
  }
  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.flushTimer);
    await this.preparing; await this.building; await this.reconciling;
    await this.flush(); await this.disk.close();
  }
  private queue(path: string, value: LinkRecord | undefined): void {
    this.pending.set(path, value);
    if (!this.flushTimer && !this.closed) {
      this.flushTimer = setTimeout(() => { this.flushTimer = undefined; void this.flush(); }, 100);
      (this.flushTimer as unknown as { unref?: () => void }).unref?.();
    }
  }
  private flush(): Promise<void> {
    clearTimeout(this.flushTimer); this.flushTimer = undefined;
    const values = [...this.pending].map(([path, value]) => ({ path, value }));
    this.pending.clear();
    this.flushes = this.flushes.then(() => this.disk.updateLinks(values));
    return this.flushes;
  }
  changed(file: TAbstractFile, oldPath?: string): void {
    if (this.closed) return;
    if (!(file instanceof TFile)) { this.clear(); void this.prepare(); return; }
    if (!this.indexed) this.touched.add(file.path);
    if (oldPath) { if (!this.indexed) this.touched.add(oldPath); this.records.delete(oldPath); this.queue(oldPath, undefined); this.revision++; }
    if (this.app.vault.getAbstractFileByPath(file.path) === file) this.add(file);
    else {
      if (this.records.delete(file.path)) this.revision++;
      this.queue(file.path, undefined);
    }
  }
  // MetadataCache's resolved event covers aliases changed offline with unchanged stats.
  reconcile(): Promise<void> {
    if (!this.reconciling) this.reconciling = this.reconcileRecords().finally(() => { this.reconciling = undefined; });
    return this.reconciling;
  }
  private async reconcileRecords(): Promise<void> {
    await this.prepare();
    const generation = this.generation;
    let yielded = performance.now();
    for (const file of this.app.vault.getFiles()) {
      if (this.closed || generation !== this.generation) return;
      if (this.app.vault.getAbstractFileByPath(file.path) === file) this.add(file);
      if (performance.now() - yielded > 8) { await new Promise(resolve => setTimeout(resolve, 0)); yielded = performance.now(); }
    }
    await this.prepare();
  }
  private add(file: TFile): void {
    if (/[\[\]|#^\r\n]/.test(file.path)) return;
    const label = file.extension === "md" ? file.path.slice(0, -3) : file.path;
    const display = file.extension === "md" ? file.basename : file.name;
    const candidates: Candidate[] = [{ path: file.path, label, display }];
    const cache = this.app.metadataCache.getFileCache(file);
    // Do not discard persisted aliases while the host metadata cache is still loading.
    if (!cache && this.records.has(file.path)) {
      candidates.push(...this.records.get(file.path)!.candidates.filter(candidate => candidate.alias));
    } else for (const alias of new Set(parseFrontMatterAliases(cache?.frontmatter) ?? [])) {
      if (alias.trim() && alias !== display && !/[\[\]|#^\r\n]/.test(alias)) candidates.push({ path: file.path, label: alias, display: alias, alias });
    }
    const previous = this.records.get(file.path);
    const changed = JSON.stringify(previous?.candidates) !== JSON.stringify(candidates);
    if (!changed && previous?.mtime === file.stat.mtime && previous.size === file.stat.size) return;
    const record = { path: file.path, mtime: file.stat.mtime, size: file.stat.size, candidates };
    this.records.set(file.path, record); this.queue(file.path, record);
    if (changed) this.revision++;
  }
  private async buildOptions(): Promise<void> {
    if (this.optionRevision === this.revision) return;
    const revision = this.revision;
    const names: Completion[] = [], paths: Completion[] = [];
    let yielded = performance.now();
    for (const record of this.records.values()) for (const candidate of record.candidates) {
      const apply: NonNullable<Completion["apply"]> = (view, completion, from) => {
        const current = wikilinkRange(view.state, view.state.selection.main.head);
        const sourcePath = this.sources.get(view);
        if (!current || current.from !== from || !sourcePath) return;
        const file = this.app.vault.getAbstractFileByPath(candidate.path);
        if (!(file instanceof TFile)) return;
        const link = this.app.metadataCache.fileToLinktext(file, sourcePath(), true);
        const alias = candidate.alias && !current.suffix.includes("|") ? `|${candidate.alias}` : "";
        const insert = `${link}${current.suffix}${alias}]]`;
        view.dispatch({ changes: { from, to: current.end, insert }, selection: { anchor: from + insert.length },
          annotations: pickedCompletion.of(completion), userEvent: "input.complete", scrollIntoView: true });
        view.focus();
      };
      names.push({ label: candidate.display, displayLabel: candidate.display, detail: candidate.path, apply });
      paths.push({ label: candidate.label, displayLabel: candidate.display, detail: candidate.path, apply });
      if (performance.now() - yielded > 8) {
        await new Promise(resolve => setTimeout(resolve, 0)); yielded = performance.now();
        if (this.closed || revision !== this.revision) return;
      }
    }
    if (!this.closed && revision === this.revision) { this.names = names; this.paths = paths; this.optionRevision = revision; }
  }
  source(sourcePath: () => string): CompletionSource {
    return async (context: CompletionContext) => {
      const range = wikilinkRange(context.state, context.pos);
      if (!range || this.closed) return null;
      if (context.view) this.sources.set(context.view, sourcePath);
      await this.prepare();
      if (context.aborted || this.closed) return null;
      const paths = context.state.sliceDoc(range.from, context.pos).includes("/");
      const revision = this.revision;
      return { from: range.from, options: paths ? this.paths : this.names,
        validFor: (text, from, to, state) => revision === this.revision && text.includes("/") === paths && wikilinkRange(state, to)?.from === from };
    };
  }
}
