import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];
if (!target || process.argv.length !== 3) {
  console.error('Usage: node scripts/create-test-vault.mjs "path/to/new-vault"');
  process.exit(1);
}
const vault = resolve(target);
// Read the build first; mkdir without recursive refuses every existing destination.
const assets = await Promise.all(["main.js", "manifest.json", "styles.css"].map(async name => [name, await readFile(join(root, name))]));
await mkdir(vault);
async function write(path, content) {
  const destination = join(vault, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, { flag: "wx" });
}
for (const [name, content] of assets) await write(`.obsidian/plugins/karpathy/${name}`, content);
await write("Reference/Project Alpha.md", '---\naliases: [Launch]\n---\n\n# Project Alpha\n\nA disposable wikilink target.\n');
await write("Other/Project Alpha.md", "# Another Project Alpha\n\nUse the folder names to distinguish completion results.\n");
const bodies = [
  "todo: sample capture\n\n- [ ] Check this task in the stream\n- [ ] Edit and rescue this entry",
  "# Theme heading\n\n## Smaller heading\n\n**Bold**, *italic*, and [[Reference/Project Alpha|Launch]].\n\n- First bullet\n- Second bullet",
  "read: rescued sample\n\nThis entry has two rescues. Search for sample to find it."
];
for (let i = 0; i < bodies.length; i++) {
  const created = new Date();
  created.setDate(created.getDate() - i);
  const day = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, "0")}-${String(created.getDate()).padStart(2, "0")}`;
  const rescued = i === 2 ? JSON.stringify(new Date().toISOString()) : "null";
  await write(`Karpathy/${day.slice(0, 4)}/${day.slice(0, 7)}/${day}-sample-${i}.md`,
    `---\nkarpathy: 2\nid: sample-${i}\ncreated: ${JSON.stringify(created.toISOString())}\nrescued: ${rescued}\nrescues: ${i === 2 ? 2 : 0}\n---\n\n${bodies[i]}\n`);
}
await write("clipboard-sample.html", '<!doctype html><meta charset="utf-8"><title>Clipboard test</title><p>Select and copy only this link text, then paste into Karpathy:</p><p><a href="https://example.com/article">Local clipboard title</a></p>');
await write("TEST-VAULT.md", "# Disposable Karpathy test vault\n\nGenerated fixtures only. Open this folder in Obsidian, trust community plugins, enable Karpathy, and run Karpathy: Open stream. Expect three entries. See docs/development.md in the source repository for checks.\n\nThis helper never enables plugins automatically and refuses existing destination folders. To reset, create another new vault; it does not erase notes.\n");
console.log(`Created disposable vault: ${vault}\nOpen this exact folder in Obsidian and enable Karpathy manually.`);
