# Repository Agent Guidelines

## Source file size

- Keep source files at or below 300 lines whenever practical.
- If a source file exceeds 300 lines, split it by responsibility into focused modules before adding more behavior.
- Prefer clear domain boundaries over arbitrary line-based splitting; keep public APIs small and avoid circular dependencies.
- Generated files, vendored code, lockfiles, and third-party sources are exempt.

## Documentation

- After completing each functional change, review whether the related README files, usage instructions, configuration examples, command references, or architecture documentation need to be updated, and update them in the same change when necessary.

## Plugin development references

- When designing or implementing Pi plugin features, use the open-source [xAI Grok Build](https://github.com/xai-org/grok-build) coding-agent harness as a reference when relevant, especially for tool architecture, TUI behavior, todo/plan workflows, reminders, goal orchestration, background tasks, and verification loops. Adapt its design ideas to Pi's extension APIs and this repository's boundaries rather than copying assumptions specific to Grok Build.

## Cursor Cloud specific instructions

- This repo is a Pi coding-agent plugin bundle, not a standalone server. The "application" is the Pi CLI (`@earendil-works/pi-coding-agent`, installed by `npm install` into `node_modules/.bin/pi`) loading this toolkit's extensions/skills/themes. There is no build step and no ports; Pi executes the `.ts` extensions directly.
- Node version: Pi packages require Node `>=22.19`. `nvm` default is set to Node 22, and login/interactive shells resolve it automatically. The non-interactive `/exec-daemon/node` is 22.14 and only triggers an `EBADENGINE` warning (Pi still runs). If Node resolves to 22.14 and you want the newer one, run `nvm use 22`.
- Run the app (no path config needed): `cd /workspace && export PATH="$PWD/node_modules/.bin:$PATH" && pi --no-session`. On first launch, choose "Trust" at the project-folder prompt. The startup dashboard should list 9 extensions (agent-todos, context7, cursor-models, model-manager, pi-lens, search-subagent, tapd, titlebar-working, startup-dashboard). The toolkit is already registered in Pi user settings via `pi install .`; if it isn't loading, re-run `pi install .` from the repo root.
- Toolkit commands (e.g. `/context7`, the startup dashboard) work with no credentials. Running the actual LLM agent loop requires provider credentials via `/login`, so headless `pi --print` fails with "No API key found" until a provider is configured.
- External-API-backed extensions need their own config and are optional for loading: TAPD (`~/.pi/agent/tapd.json`), Context7 (`~/.pi/agent/context7.json` or `CONTEXT7_API_KEY`), GitLab (`gitlab.token` / `GITLAB_PERSONAL_ACCESS_TOKEN`), Cursor models (OAuth `/login`).
- Tests/lint: there is no root test/lint/build script and no `tsconfig`/test files. The vendored `vendor/open-cursor/*` packages declare `typecheck`/`test`/`lint` scripts, but their tools (`oxlint`, `oxfmt`, `tsx`, a modern `tsc`) are NOT in the dependency graph, so those scripts do not run out of the box. Do not assume `npm test` exists.
