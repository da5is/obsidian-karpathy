# Repository Guidelines

## Project Structure & Module Organization

Karpathy is an Obsidian append-and-review stream for desktop and mobile. `src/main.ts` manages plugin lifecycle; `view.ts` renders the stream; `editor.ts` and `preview.ts` implement CodeMirror editing. `store.ts` handles persistence, rescue, and caches; `model.ts` defines entry parsing and serialization. Settings and date helpers have separate modules. Keep styling in `styles.css`, tests and mocks in `tests/`, and README screenshots in `docs/images/`.

## Build, Test, and Development Commands

- `npm ci`: install dependencies from the lockfile.
- `npm test`: bundle `tests/*.test.ts` and run Node's test runner.
- `npm run build`: type-check TypeScript and produce `main.js` with esbuild.
- `npm run dev`: rebuild on changes; does not replace the production type check.

To test locally, copy `main.js`, `manifest.json`, and `styles.css` into a test vault's `.obsidian/plugins/karpathy/`, then reload the plugin. Watch mode does not deploy automatically. Never overwrite plugin `data.json` during deployment.

## Coding Style & Naming Conventions

Follow existing TypeScript: two-space indentation, double quotes, semicolons, camelCase functions/variables, and PascalCase classes/interfaces. Use descriptive lowercase module filenames. No formatter or linter is configured; match surrounding code and run the build. Prefer Obsidian APIs; guard desktop-only Electron/filesystem paths so mobile remains supported. Use theme CSS variables for UI colors.

## Testing Guidelines

Tests use `node:test`, assertions, jsdom, and Obsidian/Electron mocks. Name files `<module>.test.ts` and test cases after observable behavior. Add regression coverage for parsing, persistence, rescue recovery, cache invalidation, or editor interactions when changing them. No numerical coverage threshold is configured. Run tests and the production build before submitting code. Check UI changes in Obsidian; simulated narrow screenshots do not establish physical mobile compatibility.

## Commit & Pull Request Guidelines

Use concise, imperative commit messages. PRs should describe behavior changes, validation, limitations, and relevant issues; include screenshots for visible changes.

## Default Delivery Workflow

Until the user changes this instruction, complete requested changes by committing, pushing to `main`, and publishing a new BRAT-compatible release without another confirmation. Honor requests to plan, review, or keep work local. Run checks first; increment version metadata, attach `main.js`, `manifest.json`, and `styles.css`, and verify published files match the build. Never include unrelated changes.

## Data Safety & Local Workspace

Preserve Markdown entry boundaries, attachment links, atomic writes, and rescue recovery. Keep caches and rendered entries bounded. Never commit vault notes, settings, drafts, or generated bundles.

This repository is the canonical source. The working vault is `C:\Users\da5is\Documents\karpathy.md`. Both reference plugins under `C:\Users\da5is\OneDrive\Documents\karpathy.md\.obsidian\plugins\` (`karpathy` and `obsidian-jot-plugin`) are read-only.
