import esbuild from "esbuild";

const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian", "electron", "node:fs/promises",
    "@codemirror/state", "@codemirror/view", "@codemirror/language",
    "@codemirror/commands", "@codemirror/search", "@codemirror/autocomplete",
    "@lezer/common", "@lezer/highlight", "@lezer/lr"
  ],
  format: "cjs",
  platform: "browser",
  target: "es2022",
  outfile: "main.js",
  logLevel: "info",
  sourcemap: false
};
if (process.argv.includes("--watch")) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build({ ...options, minify: true });
}
