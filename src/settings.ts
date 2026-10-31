import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type KarpathyPlugin from "./main";
import { baseFolder } from "./model";

export interface Settings {
  baseFolder: string;
  fetchUrlTitles: boolean;
  openOnStartup: boolean;
  hideSidebars: boolean;
  hiddenFolders: string[];
  prefixColors: Record<string, string>;
  prefixDefaultsVersion: number;
}

export function themePrefixColor(prefix: string): string {
  const variable = ({ todo: "orange", read: "green", buy: "purple", ref: "blue" } as Record<string, string>)[prefix];
  return variable ? `var(--color-${variable}, var(--text-accent))` : "var(--text-accent)";
}

function resolvedHex(parent: HTMLElement, color: string): string {
  const probe = parent.createSpan();
  probe.style.color = color;
  const resolved = parent.ownerDocument.defaultView!.getComputedStyle(probe).color;
  probe.remove();
  const canvas = parent.ownerDocument.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) return "#808080";
  context.fillStyle = resolved;
  context.fillRect(0, 0, 1, 1);
  return "#" + Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3).map(value => value.toString(16).padStart(2, "0")).join("");
}

export const DEFAULT_SETTINGS: Settings = {
  baseFolder: "Karpathy",
  fetchUrlTitles: true,
  openOnStartup: true,
  hideSidebars: false,
  hiddenFolders: [],
  prefixColors: Object.fromEntries(["todo", "read", "buy", "ref"].map(prefix => [prefix, themePrefixColor(prefix)])),
  prefixDefaultsVersion: 2
};

export function parseSettings(input: unknown): Settings {
  const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const colors: Record<string, string> = { ...DEFAULT_SETTINGS.prefixColors };
  if (value.prefixColors && typeof value.prefixColors === "object") {
    for (const [key, color] of Object.entries(value.prefixColors)) {
      if (value.prefixDefaultsVersion !== 2 && ["listen", "idea", "watch"].includes(key)) continue;
      if (value.prefixDefaultsVersion !== 2 && ((key === "todo" && color === "#b87832") || (key === "read" && color === "#388579"))) continue;
      if (/^[a-z][\w-]*$/.test(key) && typeof color === "string" && (/^#[a-f0-9]{6}$/i.test(color) || color === themePrefixColor(key))) colors[key] = color;
    }
  }
  let folder = DEFAULT_SETTINGS.baseFolder;
  if (typeof value.baseFolder === "string") folder = baseFolder(value.baseFolder);
  return {
    baseFolder: folder,
    fetchUrlTitles: value.fetchUrlTitles !== false,
    openOnStartup: typeof value.openOnStartup === "boolean" ? value.openOnStartup : true,
    hideSidebars: value.hideSidebars === true,
    hiddenFolders: Array.isArray(value.hiddenFolders) ? value.hiddenFolders.filter((p): p is string => typeof p === "string").map(baseFolder).filter(Boolean) : [],
    prefixColors: colors,
    prefixDefaultsVersion: 2
  };
}

export class KarpathySettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: KarpathyPlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Karpathy" });
    containerEl.createEl("p", { text: "One Markdown file per entry, one continuous stream. All settings are vault-local." });
    new Setting(containerEl).setName("Base notes folder")
      .setDesc("Leave blank or enter / for the vault root. Entry files live in yyyy/yyyy-mm/ with unique date-based names. Changing this does not move existing notes or attachments.")
      .addText(text => text.setPlaceholder("Vault root").setValue(this.plugin.settings.baseFolder).onChange(value => { text.inputEl.dataset.pending = value; }))
      .addButton(button => button.setButtonText("Apply").onClick(() => {
        const input = containerEl.querySelector<HTMLInputElement>("input[type=text]");
        if (!input) return;
        void this.plugin.changeBase(input.value).catch(error => this.plugin.report(error));
      }));
    new Setting(containerEl).setName("Fetch pasted URL titles")
      .setDesc("Fetch a page title only when the clipboard supplies no label. Clipboard titles and selected text work without requests even when this is disabled.")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.fetchUrlTitles).onChange(value => {
        void this.plugin.updateSettings(next => { next.fetchUrlTitles = value; }).catch(error => this.plugin.report(error));
      }));
    new Setting(containerEl).setName("Open stream on startup")
      .setDesc("Reuse a stream tab without closing other notes.")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.openOnStartup).onChange(async value => {
        await this.plugin.updateSettings(next => { next.openOnStartup = value; });
      }));
    new Setting(containerEl).setName("Hide sidebars")
      .setDesc("Hide both sidebars and the left ribbon throughout this vault. Use Karpathy: Toggle hidden sidebars in the command palette to restore them.")
      .addToggle(toggle => toggle.setValue(this.plugin.settings.hideSidebars).onChange(value => {
        void this.plugin.setSidebarsHidden(value).catch(error => this.plugin.report(error));
      }));
    new Setting(containerEl).setName("Hidden folders")
      .setDesc("One vault-relative folder per line. Hide only in the file explorer; files and links remain accessible. Blank hides nothing.")
      .addTextArea(text => {
        text.setValue(this.plugin.settings.hiddenFolders.join("\n"));
        text.inputEl.rows = 4;
        text.inputEl.addEventListener("blur", () => {
          void (async () => {
            try {
              const folders = text.getValue().split(/\r?\n/).filter(p => p.trim()).map(baseFolder).filter(Boolean);
              await this.plugin.updateSettings(next => { next.hiddenFolders = folders; });
              this.plugin.applyFolderHiding();
            } catch (error) { this.plugin.report(error); }
          })();
        });
      });
    containerEl.createEl("h3", { text: "Prefix colors" });
    containerEl.createEl("p", { text: "Only configured prefixes are bold and colored. Defaults follow the active theme; choosing a custom color overrides it. Use theme restores automatic colors." });
    for (const [prefix, color] of Object.entries(this.plugin.settings.prefixColors)) {
      const setting = new Setting(containerEl).setName(`${prefix}:`).setDesc(color.startsWith("var(") ? "Using the current theme" : "Custom color override");
      setting.addColorPicker(picker => picker.setValue(color.startsWith("#") ? color : resolvedHex(containerEl, color)).onChange(async value => {
        await this.plugin.updateSettings(next => { next.prefixColors[prefix] = value; });
        setting.setDesc("Custom color override");
      })).addButton(button => button.setButtonText("Use theme").onClick(async () => {
        await this.plugin.updateSettings(next => { next.prefixColors[prefix] = themePrefixColor(prefix); });
        this.display();
      }));
    }
    let newPrefix = "";
    new Setting(containerEl).setName("Add a prefix").addText(text => text.setPlaceholder("work").onChange(value => { newPrefix = value.trim().toLowerCase().replace(/:$/, ""); }))
      .addButton(button => button.setButtonText("Add").onClick(async () => {
        if (!/^[a-z][\w-]*$/.test(newPrefix)) { new Notice("Use a word such as work, without spaces."); return; }
        const prefix = newPrefix;
        await this.plugin.updateSettings(next => { next.prefixColors[prefix] = themePrefixColor(prefix); });
        this.display();
      }));
  }
}
