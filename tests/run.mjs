import { build } from "esbuild";
import { readdir, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const output = resolve("tests", ".build");
await mkdir(output, { recursive: true });
try {
  const tests = (await readdir("tests")).filter(name => name.endsWith(".test.ts"));
  await build({
    entryPoints: tests.map(name => resolve("tests", name)),
    outdir: output,
    bundle: true,
    packages: "external",
    alias: {
      obsidian: resolve("tests", "obsidian-mock.ts"),
      electron: resolve("tests", "electron-mock.ts")
    },
    platform: "node",
    format: "cjs",
    outExtension: { ".js": ".cjs" },
    logLevel: "silent"
  });
  const result = spawnSync(process.execPath, ["--test", ...tests.map(name => resolve(output, name.replace(/\.ts$/, ".cjs")))], { stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} finally {
  await rm(output, { recursive: true, force: true });
}
