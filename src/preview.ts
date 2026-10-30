import { Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { Decoration, EditorView, ViewPlugin, ViewUpdate, WidgetType } from "@codemirror/view";

class ImageWidget extends WidgetType {
  constructor(private src: string, private label: string) { super(); }
  eq(other: ImageWidget): boolean { return other.src === this.src && other.label === this.label; }
  toDOM(): HTMLElement {
    const image = document.createElement("img");
    image.src = this.src;
    image.alt = this.label;
    image.className = "karpathy-live-image";
    image.loading = "lazy";
    return image;
  }
}

class TaskWidget extends WidgetType {
  constructor(private checked: boolean, private from: number) { super(); }
  eq(other: TaskWidget): boolean { return other.checked === this.checked && other.from === this.from; }
  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = this.checked;
    input.setAttribute("aria-label", "Toggle task");
    input.addEventListener("mousedown", event => event.preventDefault());
    input.addEventListener("change", () => {
      if (view.state.readOnly) { input.checked = this.checked; return; }
      view.dispatch({ changes: { from: this.from, to: this.from + 3, insert: input.checked ? "[x]" : "[ ]" } });
      view.focus();
    });
    return input;
  }
  ignoreEvent(): boolean { return true; }
}

// Formatting remains ordinary Markdown. Reveal delimiters only for the construct
// being edited; code blocks and unrelated punctuation are never rewritten.
export function livePreview(resolveImage?: (link: string) => string | null) {
  return ViewPlugin.fromClass(class {
    decorations;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged)
        this.decorations = this.build(update.view);
    }
    build(view: EditorView) {
      const ranges: Range<Decoration>[] = [];
      const excluded: { from: number; to: number }[] = [];
      const selection = view.state.selection;
      const editing = (from: number, to: number) => view.hasFocus && selection.ranges.some(range => range.from <= to && range.to >= from);
      syntaxTree(view.state).iterate({
        enter(node) {
          if (node.name === "FencedCode" || node.name === "CodeBlock" || node.name === "InlineCode") {
            excluded.push({ from: node.from, to: node.to });
            if (node.name !== "InlineCode") return false;
          }
          if (node.name === "Image" && resolveImage && !editing(node.from, node.to)) {
            const raw = view.state.sliceDoc(node.from, node.to);
            const match = /^!\[([^\]]*)\]\(([^\s]+)\)$/.exec(raw);
            const src = match && resolveImage(match[2]);
            if (src) {
              ranges.push(Decoration.replace({ widget: new ImageWidget(src, match![1]) }).range(node.from, node.to));
              excluded.push({ from: node.from, to: node.to });
              return false;
            }
          }
          if (/^(?:ATX|Setext)Heading[1-6]$/.test(node.name)) {
            // Native heading classes inherit the active theme's complete type
            // scale, including fonts, colors, weights and letter spacing.
            const level = node.name.at(-1);
            const firstLine = view.state.doc.lineAt(node.from).number;
            const lastLine = view.state.doc.lineAt(node.to).number - (node.name.startsWith("Setext") ? 1 : 0);
            for (let line = firstLine; line <= lastLine; line++) {
              ranges.push(Decoration.line({ class: `karpathy-heading-${level} HyperMD-header HyperMD-header-${level}` }).range(view.state.doc.line(line).from));
            }
          }
          if (node.name === "TaskMarker" && !editing(node.from, node.to)) {
            ranges.push(Decoration.replace({ widget: new TaskWidget(/x/i.test(view.state.sliceDoc(node.from, node.to)), node.from) }).range(node.from, node.to));
            return false;
          }
          if (["EmphasisMark", "StrikethroughMark", "HeaderMark", "CodeMark"].includes(node.name)) {
            const parent = node.node.parent;
            if (parent && !editing(parent.from, parent.to)) ranges.push(Decoration.replace({}).range(node.from, node.to));
          }
          if (node.name === "Link") {
            const raw = view.state.sliceDoc(node.from, node.to);
            const match = /^\[([^\]]+)\]\(([^\s]+)(?:\s+[^)]*)?\)$/.exec(raw);
            if (match && !editing(node.from, node.to)) {
              ranges.push(Decoration.replace({}).range(node.from, node.from + 1));
              ranges.push(Decoration.mark({ class: "karpathy-live-link" }).range(node.from + 1, node.from + 1 + match[1].length));
              ranges.push(Decoration.replace({}).range(node.from + 1 + match[1].length, node.to));
              return false;
            }
          }
        }
      });
      for (const match of view.state.doc.toString().matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
        const from = match.index!;
        const to = from + match[0].length;
        if (editing(from, to) || excluded.some(range => from < range.to && to > range.from)) continue;
        const [link, alias] = match[2].split("|");
        const src = match[1] && resolveImage?.(link);
        if (src) ranges.push(Decoration.replace({ widget: new ImageWidget(src, alias || link) }).range(from, to));
        else if (!match[1]) {
          const labelStart = alias ? from + 2 + link.length + 1 : from + 2;
          ranges.push(Decoration.replace({}).range(from, labelStart));
          ranges.push(Decoration.mark({ class: "karpathy-live-link" }).range(labelStart, to - 2));
          ranges.push(Decoration.replace({}).range(to - 2, to));
        }
      }
      return Decoration.set(ranges, true);
    }
  }, { decorations: value => value.decorations });
}
