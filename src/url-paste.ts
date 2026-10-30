import { requestUrl } from "obsidian";
import { EditorState } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";

function pastedUrl(text: string): string | null {
  const url = text.trim();
  if (!/^https?:\/\/[^\s<>]+$/i.test(url)) return null;
  try {
    const parsed = new URL(url);
    return parsed.hostname && !parsed.username && !parsed.password ? url : null;
  } catch { return null; }
}

function markdownLink(title: string, url: string): string {
  const label = title.replace(/[\\`*_[\]<>!&]/g, "\\$&");
  const destination = url.replace(/[\\()"<>]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `[${label}](${destination})`;
}

function evenBackticks(text: string): boolean {
  let ticks = 0, slashes = 0;
  for (const char of text) {
    if (char.charCodeAt(0) === 92) { slashes++; continue; }
    if (char.charCodeAt(0) === 96 && slashes % 2 === 0) ticks++;
    slashes = 0;
  }
  return ticks % 2 === 0;
}

function canFormat(state: EditorState, from = state.selection.main.from, to = state.selection.main.to): boolean {
  if (state.readOnly || state.selection.ranges.length !== 1) return false;
  if (state.doc.lineAt(from).number !== state.doc.lineAt(to).number) return false;
  const tree = syntaxTree(state);
  let excluded = false;
  tree.iterate({ from, to, enter(node) {
    if (["FencedCode", "CodeBlock", "InlineCode", "Link", "Image", "Autolink", "LinkReference", "Comment", "HTMLBlock", "HTMLTag"].includes(node.name) &&
        (from === to ? node.from < from && (node.to > from || (["FencedCode", "CodeBlock"].includes(node.name) && node.to === from)) : node.from < to && node.to > from)) {
      excluded = true;
      return false;
    }
  } });
  if (excluded) return false;
  // Incomplete Markdown and wikilinks may not have a syntax-tree node yet.
  const before = state.sliceDoc(state.doc.lineAt(from).from, from);
  return !/(?:\[\[[^\]\n]*|!?\[[^\]\n]*\]\([^\)\n]*|<[^>\n]*)$/.test(before) &&
    evenBackticks(before);
}

// requestUrl has no abort API: retain the slot until the actual request settles.
let titleRequests = 0;
async function pageTitle(url: string, doc: Document): Promise<string | null> {
  if (titleRequests >= 4) return null;
  titleRequests++;
  try {
  const response = await requestUrl({ url, headers: { Accept: "text/html,application/xhtml+xml" }, throw: false });
  if (response.text.length > 2 * 1024 * 1024) return null;
  if (response.status < 200 || response.status >= 300) return null;
  const contentType = Object.entries(response.headers).find(([key]) => key.toLowerCase() === "content-type")?.[1];
  if (contentType && !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType)) return null;
  // A template is inert: page scripts, images and embedded frames never run/load.
  const template = doc.createElement("template");
  template.innerHTML = response.text.slice(0, 262144);
  const candidates = [template.content.querySelector("title")?.textContent,
    template.content.querySelector('meta[property="og:title"]')?.getAttribute("content"),
    template.content.querySelector('meta[name="twitter:title"]')?.getAttribute("content")];
  for (const candidate of candidates) {
    const title = candidate?.replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (title) return title.slice(0, 500);
  }
  return null;
  } finally { titleRequests--; }
}

interface Lookup { from: number; to: number; url: string; timer: ReturnType<typeof setTimeout> }

// Insert first and enhance only that untouched range. Saving, undoing, editing
// the URL or closing the editor invalidates the lookup; no saved note is rewritten.
export function urlPaste(timeout = 5000, enabled: () => boolean = () => true) {
  return ViewPlugin.fromClass(class {
    private lookups = new Set<Lookup>();
    constructor(private view: EditorView) {}

    private cancel(lookup: Lookup): void {
      clearTimeout(lookup.timer);
      this.lookups.delete(lookup);
    }

    update(update: ViewUpdate): void {
      for (const lookup of this.lookups) {
        if (update.state.readOnly) { this.cancel(lookup); continue; }
        if (!update.docChanged) continue;
        let touched = false;
        update.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
          if (from < lookup.to && to > lookup.from) touched = true;
          // Typing a path/query directly onto the URL is an edit, not prose.
          if (from === to && from === lookup.to && /^\S/.test(inserted.toString())) touched = true;
        });
        if (touched) { this.cancel(lookup); continue; }
        lookup.from = update.changes.mapPos(lookup.from, 1);
        lookup.to = update.changes.mapPos(lookup.to, -1);
      }
    }

    paste(event: ClipboardEvent): boolean {
      if (event.clipboardData?.files.length || !canFormat(this.view.state)) return false;
      const url = pastedUrl(event.clipboardData?.getData("text/plain") ?? "");
      if (!url) return false;
      const selection = this.view.state.selection.main;
      const selected = this.view.state.sliceDoc(selection.from, selection.to);
      const insert = selected ? markdownLink(selected, url) : url;
      event.preventDefault();
      this.view.dispatch({
        changes: { from: selection.from, to: selection.to, insert },
        selection: { anchor: selection.from + insert.length },
        userEvent: "input.paste", scrollIntoView: true
      });
      if (selected || !enabled() || this.lookups.size >= 8) return true;
      const lookup: Lookup = { from: selection.from, to: selection.from + url.length, url,
        timer: setTimeout(() => this.cancel(lookup), timeout) };
      this.lookups.add(lookup);
      void pageTitle(url, this.view.dom.ownerDocument).then(title => {
        if (!this.lookups.has(lookup)) return;
        this.cancel(lookup);
        if (!title || !canFormat(this.view.state, lookup.from, lookup.to) || this.view.state.sliceDoc(lookup.from, lookup.to) !== url) return;
        this.view.dispatch({
          changes: { from: lookup.from, to: lookup.to, insert: markdownLink(title, url) },
          annotations: isolateHistory.of("full"), userEvent: "input.link-title"
        });
      }).catch(() => this.cancel(lookup));
      return true;
    }

    destroy(): void {
      for (const lookup of this.lookups) this.cancel(lookup);
    }
  }, { eventHandlers: { paste(event) { return this.paste(event); } } });
}
