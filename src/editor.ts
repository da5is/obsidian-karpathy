import { Compartment, EditorSelection, EditorState, Prec } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, keymap, placeholder, tooltips, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { acceptCompletion, autocompletion, closeCompletion, CompletionSource, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab, insertNewline } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { insertNewlineContinueMarkupCommand, markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { tags } from "@lezer/highlight";
import { entryPrefix, uniqueId } from "./model";
import { livePreview } from "./preview";
import { nativeClipboardFiles } from "./clipboard";
import { urlPaste } from "./url-paste";
import type { Scope, KeymapEventHandler } from "obsidian";

const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false });

export interface EditorOptions {
  body: string;
  fetchTitles?: () => boolean;
  colors: Record<string, string>;
  tripleEnter: boolean;
  change: (body: string) => void;
  save: () => void;
  upload: (files: File[]) => Promise<string[]>;
  error: (error: unknown) => void;
  busy: (busy: boolean) => void;
  scope?: Scope;
  resolveImage?: (link: string) => string | null;
  completeLink?: CompletionSource;
}

export class CaptureEditor {
  readonly view: EditorView;
  pending = 0;
  private readOnly = new Compartment();
  private uploads = new Set<Promise<void>>();
  private destroyed = false;
  private hotkeys: KeymapEventHandler[] = [];

  constructor(parent: HTMLElement, private options: EditorOptions) {
    const documentMode = new Compartment();
    const mode = (size: number) => size > 100000 ? [] : [EditorView.lineWrapping, markdown({ base: markdownLanguage, addKeymap: false })];
    const prefix = ViewPlugin.fromClass(class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = this.build(view); }
      update(update: ViewUpdate): void {
        this.decorations = this.build(update.view);
      }
      build(view: EditorView): DecorationSet {
        const line = view.state.doc.line(1);
        const match = entryPrefix(view.state.sliceDoc(0, Math.min(line.to, 1000)));
        if (!match) return Decoration.none;
        const color = options.colors[match[1].toLowerCase()];
        if (!color) return Decoration.none;
        return Decoration.set([Decoration.mark({ class: "karpathy-prefix", attributes: { style: `color:${color}` } }).range(0, match[0].length)]);
      }
    }, { decorations: value => value.decorations });

    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: options.body,
        extensions: [
          history(), bracketMatching(),
          documentMode.of(mode(options.body.length)),
          EditorState.transactionExtender.of(transaction => {
            if ((transaction.startState.doc.length > 100000) !== (transaction.newDoc.length > 100000))
              return { effects: documentMode.reconfigure(mode(transaction.newDoc.length)) };
            return null;
          }),
          options.completeLink ? [
            autocompletion({
              override: [options.completeLink], defaultKeymap: false, icons: false,
              activateOnTypingDelay: 50, interactionDelay: 0, maxRenderedOptions: 20,
              tooltipClass: () => "karpathy-link-suggestions",
              compareCompletions: (a, b) => (a.displayLabel ?? a.label).localeCompare(b.displayLabel ?? b.label) || (a.detail ?? "").localeCompare(b.detail ?? "")
            }),
            tooltips({
              parent: parent.ownerDocument.body,
              tooltipSpace: () => {
                const win = parent.ownerDocument.defaultView!;
                const viewport = win.visualViewport;
                const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
                return { left, top, right: left + (viewport?.width ?? win.innerWidth), bottom: top + (viewport?.height ?? win.innerHeight) };
              }
            })
          ] : [],
          syntaxHighlighting(defaultHighlightStyle),
          syntaxHighlighting(HighlightStyle.define([
            { tag: tags.strong, class: "karpathy-strong" },
            { tag: tags.emphasis, class: "karpathy-emphasis" },
            { tag: tags.strikethrough, textDecoration: "line-through" },
            { tag: tags.heading, class: "karpathy-heading-text" },
            { tag: tags.monospace, fontFamily: "var(--font-monospace)", color: "var(--code-normal)" },
            { tag: tags.link, class: "karpathy-live-link" }
          ])),
          prefix, livePreview(options.resolveImage), this.readOnly.of(EditorState.readOnly.of(false)),
          placeholder("Capture a thought..."),
          EditorView.contentAttributes.of({ "aria-label": "Entry Markdown editor", spellcheck: "true", autocapitalize: "sentences" }),
          EditorView.updateListener.of(update => {
            if (update.docChanged) options.change(update.state.doc.toString());
          }),
          // CodeMirror replays iOS Return after native input. Saving in
          // beforeinput races that replay and inserts a newline into the next draft.
          // Use its keymap, with this fallback for keyboards that send only input.
          EditorView.inputHandler.of((view, from, to, text) => {
            if (text !== "\n" || from !== to || view.composing) return false;
            const selection = view.state.selection.main;
            if (selection.from !== from || selection.to !== to) return false;
            return this.handleEnter(view);
          }),
          EditorView.domEventHandlers({
            paste: event => {
              if (this.view.state.readOnly) return true;
              const files = Array.from(event.clipboardData?.files ?? []);
              if (!files.length) {
                try {
                  const native = nativeClipboardFiles();
                  if (!native) return false;
                  event.preventDefault();
                  this.attach(native);
                  return true;
                } catch (error) { options.error(error); return false; }
              }
              event.preventDefault();
              this.attach(files);
              return true;
            },
            drop: (event, view) => {
              const files = Array.from(event.dataTransfer?.files ?? []);
              if (!files.length) return false;
              event.preventDefault();
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (pos !== null) view.dispatch({ selection: { anchor: pos } });
              this.attach(files);
              return true;
            },
            dragover: event => {
              if (!Array.from(event.dataTransfer?.types ?? []).includes("Files")) return false;
              event.preventDefault();
              return true;
            }
          }),
          urlPaste(5000, options.fetchTitles),
          Prec.highest(keymap.of([
            { key: "Ctrl-Enter", run: () => { options.save(); return true; } },
            { key: "Meta-Enter", run: () => { options.save(); return true; } },
            { key: "Shift-Enter", run: insertNewline },
            { key: "Enter", run: view => this.handleEnter(view) },
            ...(options.completeLink ? [{ key: "Tab", run: acceptCompletion }, ...completionKeymap.filter(binding => binding.key !== "Enter")] : []),
            { key: "Mod-b", run: () => this.wrap("**") },
            { key: "Mod-i", run: () => this.wrap("*") },
            { key: "Mod-k", run: () => this.wrap("[", "](url)") }
          ])),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab])
        ]
      })
    });
    for (const modifier of ["Ctrl", "Meta"] as const) {
      const handler = options.scope?.register([modifier], "Enter", event => {
        if (!this.view.hasFocus || event.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        options.save();
        return false;
      });
      if (handler) this.hotkeys.push(handler);
    }
    if (options.completeLink) {
      // Dismiss suggestions before Obsidian's modal-level Escape handler.
      const handler = options.scope?.register([], "Escape", event => {
        if (!this.view.hasFocus || event.isComposing || !closeCompletion(this.view)) return;
        event.preventDefault();
        event.stopPropagation();
        return false;
      });
      if (handler) this.hotkeys.push(handler);
    }
  }

  private handleEnter(view: EditorView): boolean {
    if (view.composing || view.state.readOnly) return false;
    if (this.options.completeLink && acceptCompletion(view)) return true;
    const selection = view.state.selection.main;
    const line = view.state.doc.lineAt(selection.head);
    const emptyItem = selection.empty && view.state.selection.ranges.length === 1 &&
      /^[ \t]*(?:[-+*]|\d+[.)])(?:[ \t]+\[[ xX]\])?[ \t]*$/.test(line.text);
    if (continueMarkup({ state: view.state, dispatch: transaction => {
      const next = transaction.state;
      const cursor = next.selection.main.head;
      const cleared = next.doc.lineAt(cursor);
      if (emptyItem && !cleared.text.trim()) {
        // Leave a blank paragraph after exiting the outermost list. This also
        // keeps continue / exit / save as three Enter presses in the composer.
        view.dispatch([transaction, next.update({
          changes: { from: cleared.from, to: cleared.to, insert: "\n" },
          selection: { anchor: cleared.from + 1 }, userEvent: "input", scrollIntoView: true
        })]);
      } else view.dispatch(transaction);
    } })) return true;
    if (!this.canSubmit(view)) return false;
    this.options.save();
    return true;
  }

  private canSubmit(view: EditorView): boolean {
    if (!this.options.tripleEnter || view.composing || view.state.readOnly) return false;
    const selection = view.state.selection.main;
    if (!selection.empty || selection.head !== view.state.doc.length) return false;
    const text = view.state.doc.toString();
    if (!text.trim() || !/\n[ \t]*\n[ \t]*$/.test(text)) return false;
    return true;
  }

  get body(): string { return this.view.state.doc.toString(); }
  focus(): void { if (!this.destroyed) this.view.focus(); }
  updateColors(colors: Record<string, string>): void {
    this.options.colors = colors;
    if (!this.destroyed) this.view.dispatch({});
  }
  lock(value: boolean): void {
    if (value && !this.destroyed && this.options.completeLink) closeCompletion(this.view);
    if (!this.destroyed) this.view.dispatch({ effects: this.readOnly.reconfigure(EditorState.readOnly.of(value)) });
  }
  setBody(body: string): void {
    if (this.destroyed) return;
    if (this.options.completeLink) closeCompletion(this.view);
    this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: body }, selection: { anchor: 0 } });
  }
  insert(text: string): void {
    if (this.destroyed || this.view.state.readOnly) return;
    this.view.dispatch(this.view.state.replaceSelection(text));
    this.focus();
  }
  wrap(before: string, after = before): boolean {
    if (this.view.state.readOnly) return true;
    const selection = this.view.state.selection.main;
    const selected = this.view.state.sliceDoc(selection.from, selection.to);
    this.view.dispatch({
      changes: { from: selection.from, to: selection.to, insert: before + selected + after },
      selection: EditorSelection.range(selection.from + before.length, selection.from + before.length + selected.length)
    });
    this.focus();
    return true;
  }

  attach(files: File[] | AsyncIterable<File>): void {
    if (this.destroyed || this.view.state.readOnly || (Array.isArray(files) && !files.length)) return;
    const marker = `<!-- uploading:${uniqueId()} -->`;
    const selection = this.view.state.selection.main;
    const before = this.view.state.sliceDoc(0, selection.from);
    const after = this.view.state.sliceDoc(selection.to);
    this.insert(`${before && !before.endsWith("\n") ? "\n" : ""}${marker}${after && !after.startsWith("\n") ? "\n" : ""}`);
    this.pending++;
    this.options.busy(true);
    const work = (async () => {
      const links: string[] = [];
      try {
        for await (const file of files) {
          if (file.size > 50 * 1024 * 1024) throw new Error("Attachments are limited to 50 MiB each. Add larger files to the vault and link them.");
          links.push(...await this.options.upload([file]));
        }
      } catch (error) {
        this.options.error(error);
      } finally {
        this.replaceMarker(marker, links.join("\n"));
        this.pending--;
        this.options.busy(this.pending > 0);
      }
    })();
    this.uploads.add(work);
    void work.finally(() => this.uploads.delete(work));
  }

  private replaceMarker(marker: string, replacement: string): void {
    const position = this.body.indexOf(marker);
    if (position >= 0) this.view.dispatch({ changes: { from: position, to: position + marker.length, insert: replacement } });
    else if (replacement) this.options.error(new Error(`The attachment insertion point was removed. Files were saved; reinsert these links: ${replacement}`));
  }

  async destroy(): Promise<void> {
    for (const handler of this.hotkeys) this.options.scope?.unregister(handler);
    this.hotkeys = [];
    await Promise.all(this.uploads);
    this.destroyed = true;
    this.view.destroy();
  }
}

export function editorToolbar(parent: HTMLElement, editor: CaptureEditor): HTMLInputElement {
  const toolbar = parent.createDiv({ cls: "karpathy-formatting" });
  const button = (label: string, action: () => void) => {
    const element = toolbar.createEl("button", { text: label, attr: { type: "button" } });
    element.addEventListener("click", action);
  };
  button("H", () => editor.insert("## "));
  button("Bold", () => { editor.wrap("**"); });
  button("List", () => editor.insert("\n- "));
  button("Task", () => editor.insert("\n- [ ] "));
  button("Link", () => { editor.wrap("[", "](url)"); });
  const picker = toolbar.createEl("input", { type: "file", attr: { multiple: "", "aria-label": "Attach files" } });
  picker.hidden = true;
  picker.addEventListener("change", () => {
    editor.attach(Array.from(picker.files ?? []));
    picker.value = "";
  });
  button("Attach", () => picker.click());
  return picker;
}
