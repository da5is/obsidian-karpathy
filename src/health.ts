import { App, Modal, TFile } from "obsidian";
import { baseFolder, entryPath, isEntryPath, parseEntries } from "./model";

export interface StorageIssue { path: string; reason: string; recoverable?: boolean }
export async function inspectStorage(app: App, base: string, active: () => boolean = () => true,
  progress: (done: number, total: number) => void = () => {}): Promise<StorageIssue[]> {
  const prefix = baseFolder(base);
  const inside = (path: string) => !prefix || path.startsWith(prefix + "/");
  const issues: StorageIssue[] = [];
  const identities = new Map<string, string[]>();
  const referenced = new Set<string>();
  const files = app.vault.getMarkdownFiles();
  let readFailed = false;
  for (let i = 0; i < files.length && active(); i++) {
    const file = files[i];
    try {
      const text = await app.vault.read(file);
      // Include references from the entire vault, not only stream entries.
      for (const match of text.matchAll(/(?:!?\[\[([^\]\n]+)\]\]|!?\[[^\]\n]*\]\(([^\s]+)\))/g)) {
        let link = (match[1] ?? match[2]).split("|")[0].split("#")[0];
        try { link = decodeURIComponent(link); } catch { /* Literal path. */ }
        const target = app.metadataCache.getFirstLinkpathDest(link, file.path);
        if (target) referenced.add(target.path);
      }
      if (inside(file.path)) {
        const entry = parseEntries(text, file.path)[0];
        if (entry) {
          const paths = identities.get(entry.id) ?? []; paths.push(file.path); identities.set(entry.id, paths);
          if (!isEntryPath(base, file.path)) issues.push({ path: file.path, reason: "Valid entry outside the stream filename/folder convention", recoverable: true });
        } else if (/^<!-- karpathy:/m.test(text)) {
          issues.push({ path: file.path, reason: "Legacy daily note; version 2 does not convert or display these entries" });
        } else if (isEntryPath(base, file.path) || /^karpathy\s*:/m.test(text)) {
          issues.push({ path: file.path, reason: "Entry metadata is missing or invalid; open the source to repair it" });
        }
      }
    } catch { readFailed = true; if (inside(file.path)) issues.push({ path: file.path, reason: "Cannot read this file" }); }
    if (i % 32 === 0) { progress(i + 1, files.length); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  if (!active()) return [];
  for (const paths of identities.values()) if (paths.length > 1) for (const path of paths)
    issues.push({ path, reason: "Duplicate entry identity; review both copies before removing either" });
  // These are candidates, never proof that a file is unused (e.g. HTML/CSS references).
  if (!readFailed) for (const file of app.vault.getFiles()) {
    if (inside(file.path) && /(?:^|\/)\d{4}\/\d{4}-\d{2}\/attachments\//.test(file.path) && !referenced.has(file.path))
      issues.push({ path: file.path, reason: "Possibly unreferenced attachment; review references before deleting" });
  }
  progress(files.length, files.length);
  return issues;
}

export async function restoreEntryPath(app: App, base: string, path: string): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) throw new Error("The source file no longer exists.");
  const text = await app.vault.read(file);
  const entry = parseEntries(text, path)[0];
  if (!entry) throw new Error("Repair the entry metadata before restoring its path.");
  const target = entryPath(base, new Date(entry.created!), entry.id);
  if (path === target) return;
  if (app.vault.getAbstractFileByPath(target)) throw new Error("The destination already exists. Review both copies instead of overwriting it.");
  const parts = target.split("/"); parts.pop();
  for (let i = 1; i <= parts.length; i++) {
    const folder = parts.slice(0, i).join("/");
    if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
  }
  if (await app.vault.read(file) !== text) throw new Error("The source changed. Run the report again before restoring it.");
  await app.fileManager.renameFile(file, target);
}

export class StorageHealth extends Modal {
  private stopped = false;
  constructor(app: App, private base: string) { super(app); }
  onOpen(): void {
    this.titleEl.setText("Storage health");
    this.contentEl.createEl("p", { text: "Review only: this scan changes no files. Attachment candidates may still be referenced by HTML, CSS, or other plugins. Deleted notes may be recoverable from your vault or system trash." });
    const status = this.contentEl.createEl("p", { text: "Scanning…", attr: { role: "status" } });
    void inspectStorage(this.app, this.base, () => !this.stopped, (done, total) => status.setText(`Scanned ${done} of ${total} notes`))
      .then(issues => {
        if (this.stopped) return;
        status.setText(`${issues.length} items to review`);
        const report = this.contentEl.createEl("textarea", { attr: { readonly: "", rows: "12", "aria-label": "Storage health report" } });
        report.style.width = "100%";
        report.value = issues.map(issue => `${issue.path}\n  ${issue.reason}`).join("\n\n") || "No issues found.";
        let offset = 0;
        const list = this.contentEl.createDiv();
        const more = this.contentEl.createEl("button", { text: "Show more" });
        const show = () => {
          list.empty();
          for (const issue of issues.slice(offset, offset + 30)) {
            const row = list.createDiv();
            row.createEl("p", { text: issue.reason });
            row.createEl("button", { text: issue.path }).addEventListener("click", () => {
              void this.app.workspace.openLinkText(issue.path, issue.path, "tab");
            });
            if (issue.recoverable) row.createEl("button", { text: "Restore filename/folder…" }).addEventListener("click", () => {
              new RestoreConfirmation(this.app, this.base, issue.path, () => { this.close(); new StorageHealth(this.app, this.base).open(); }).open();
            });
          }
          offset += 30; more.hidden = offset >= issues.length; more.style.display = more.hidden ? "none" : "";
        };
        more.addEventListener("click", show); show();
      }).catch(error => { if (!this.stopped) status.setText(String(error)); });
  }
  onClose(): void { this.stopped = true; }
}
class RestoreConfirmation extends Modal {
  constructor(app: App, private base: string, private path: string, private done: () => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText("Restore entry to the stream?");
    this.contentEl.createEl("p", { text: "Rename/move " + this.path + " to its creation-month entry path. Existing destination files will never be overwritten. Obsidian will handle link updates according to your vault settings." });
    const status = this.contentEl.createEl("p", { attr: { role: "status" } });
    const button = this.contentEl.createEl("button", { text: "Restore" });
    button.addEventListener("click", () => {
      button.disabled = true;
      void restoreEntryPath(this.app, this.base, this.path).then(() => { this.close(); this.done(); })
        .catch(error => { status.setText(String(error)); button.disabled = false; });
    });
    this.contentEl.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());
  }
}
