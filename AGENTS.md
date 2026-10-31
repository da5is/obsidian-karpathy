# Repository Guidelines

## Project Structure

Karpathy is an append-and-review stream for Obsidian desktop/mobile. `src/main.ts`
handles lifecycle/settings; `view.ts` renders the stream; `editor.ts` and
`preview.ts` implement editing; `store.ts`, `model.ts`, and `index.ts` implement
entry persistence and local caches. Styles are in `styles.css`, tests/mocks in
`tests/`, portable helpers in `scripts/`, and documentation in `docs/`.

Start each new session with `docs/handoff.md`, `docs/development.md`, Git status,
and the current manifest. Use `docs/storage.md` for the storage contract and
`docs/compatibility.md` for validation evidence. `docs/VAULT_LLM_GUIDE.md` is a
standalone guide for agents working on vault content, not repository code.

## Build and Development

Use Node.js 24. `npm ci` installs locked dependencies; `npm test` runs the suite;
`npm run build` type-checks and bundles; `npm run dev` watches without deploying.

After building, `node scripts/create-test-vault.mjs "../karpathy-test-vault"`
creates disposable fixtures; the destination must not exist. Automated tests
need no Obsidian installation. Native testing needs the desktop app. Deploy only
`main.js`, `manifest.json`, and `styles.css` into the verified test vault's
`.obsidian/plugins/karpathy/`; preserve `data.json` and reload the plugin.

## Coding and Testing

Use two spaces, double quotes, semicolons, camelCase functions/variables, and
PascalCase types. Match existing TypeScript; no formatter/linter is configured.
Prefer Obsidian APIs, guard desktop-only imports, and use theme CSS variables.

Tests use `node:test`, jsdom, and host mocks; name them `<module>.test.ts`. Add
regression coverage for changed persistence, editor gestures, cache invalidation,
and recovery. Run tests and the production build. Check visible/host integration
changes in Obsidian when available; report unavailable native checks. Simulated
mobile input and narrow screenshots do not establish physical-device support.

## Delivery and Documentation

Use imperative commit messages and describe behavior, validation, and limitations.
Update affected README, handoff, storage, backlog, and compatibility instructions;
keep historical measurements clearly labeled. Include screenshots for visible
changes where useful.

Default: commit, push `main`, and publish a BRAT-compatible release without another
confirmation. Review/planning/local-only user requests override this. Increment all
version metadata and verify published asset hashes against the tested build.
Never include unrelated changes or credentials.

## Data Safety

Preserve entry identity, YAML properties, attachment links, atomic local writes,
and bounded caches/rendering. Rescue updates in place; no version-1 conversion.
Never commit notes, settings, drafts, generated bundles, or `.release-work/`.
Do not depend on earlier chats or ignored benchmark helpers.

Verify absolute vault paths; identical display names are insufficient. Use new
disposable fixtures instead of clearing personal notes. Original-machine test
vault: `C:\Users\da5is\Documents\karpathy.md`. Both reference plugins under
`C:\Users\da5is\OneDrive\Documents\karpathy.md\.obsidian\plugins\`
(`karpathy`, `obsidian-jot-plugin`) remain read-only.
