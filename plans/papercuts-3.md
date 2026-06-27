# Papercuts 3

Created 2026-06-27. Source of truth remains `SPEC.md`; this ledger captures
small but user-visible framework/template papercuts found while dogfooding the
SQLite starter at `/Users/mini/kovo-dogfood-3` from local `create-kovo`.

## Scope

This run built local `packages/create-kovo`, scaffolded a fresh SQLite app with
`node packages/create-kovo/dist/index.mjs /Users/mini/kovo-dogfood-3 --dialect
sqlite --disable-git`, linked generated `@kovojs/*` dependencies to the local
monorepo, installed dependencies, and exercised test, check, production build,
dev server on `0.0.0.0:5193`, browser auth, enhanced add-contact, HMR edit,
sign-out, no-JS auth/add-contact, and node-preset production startup. Production
fixes are intentionally out of scope for this ledger.

## Issues

- [x] **Node preset build output requires `undici` at app runtime.**
  - Observed behavior: `pnpm run build:prod` exited 0, but running the emitted
    server with `HOST=0.0.0.0 PORT=5194 node dist/server/server.mjs` crashed
    before listening with `Error: Cannot find module 'undici'` from
    `dist/server/server/handler.mjs`.
  - Root cause: the node-preset server handler bundle leaves a dynamic
    `require('undici')` from `@kovojs/server/src/egress-undici.ts` in the emitted
    handler. `packages/cli/src/commands/build-export.ts` only marks
    `@node-rs/argon2` external, so `undici` appears intended to bundle, but the
    dynamic require survives. The generated app does not declare `undici`
    directly, and pnpm keeps the transitive copy nested under
    `node_modules/@kovojs/server/node_modules/undici`, where the standalone
    emitted `dist/server/server/handler.mjs` cannot resolve it.
  - Why it matters: SPEC §9.5 makes the node preset a production request shell;
    a starter can pass build and still fail at first production boot unless the
    app author knows to add an internal framework transport dependency.
  - Repro evidence: initial `HOST=0.0.0.0 PORT=5194 node
dist/server/server.mjs` failed with `MODULE_NOT_FOUND: undici`; `pnpm why
undici` showed only transitive `@kovojs/server` copies; adding
    `undici@^7.28.0` directly to the throwaway app made the same command listen
    and `curl -i http://127.0.0.1:5194/login` returned `200 text/html`.
  - Acceptance: node-preset output should either bundle the `undici` egress floor
    dependency, emit/copy a runtime dependency manifest that installs beside the
    server output, or make `create-kovo` generate the direct dependency. Add a
    starter-level production smoke that builds a fresh SQLite app and boots
    `dist/server/server.mjs` under pnpm's non-hoisted dependency layout.
  - Fixed: `packages/cli/src/commands/build-export.ts` now teaches the node
    preset bundler about the framework-owned dynamic `undici` dependency, while
    `packages/server/src/egress-undici.ts` keeps the lazy `createRequire` import
    that avoids dev/test SSR evaluating Undici during app import.
  - Evidence: `pnpm exec vitest run packages/cli/src/index.kovo-build.test.ts -t
"boots emitted node preset output from production dependencies"` passed and
    asserts the emitted handler has no `require('undici')`; `pnpm exec vitest run
packages/create-kovo/src/index.build.test.ts` passed.

- [x] **Generated pnpm starter runs subchecks through `npm run`, producing npm config warnings.**
  - Observed behavior: `pnpm run check` passed, but each generated subcheck
    printed npm warnings such as `Unknown env config "verify-deps-before-run"`,
    `"_jsr-registry"`, and `"minimum-release-age"`.
  - Root cause: `packages/create-kovo/templates/package*.json` define
    `"check": "vp check && npm run check:sound-subset && npm run
check:endpoint-posture"` even though the generated `packageManager` is
    `pnpm@10.12.1`. Running npm from inside a pnpm command inherits pnpm-specific
    npm-config environment variables that npm does not understand.
  - Why it matters: the app is green, but a fresh starter's main verification
    command emits warnings unrelated to app code. That makes the first check run
    look suspicious and weakens the "clean starting point" promise.
  - Repro evidence: `pnpm run check` in `/Users/mini/kovo-dogfood-3` passed after
    formatting, but both `check:sound-subset` and `check:endpoint-posture`
    invocations printed the npm unknown-config warnings before their successful
    output.
  - Acceptance: generated scripts should invoke the selected package manager
    consistently, or avoid package-manager recursion for same-package scripts.
    `pnpm run check` in a freshly scaffolded pnpm app should pass without npm
    unknown-config warnings.
  - Fixed: `packages/create-kovo/templates/package*.json` now use `pnpm run` for
    same-package subchecks and `serve`; template READMEs now document `pnpm run`
    commands consistently.
  - Evidence: `pnpm exec vitest run packages/create-kovo/src/index.test.ts`
    passed and checks the generated script shape; `pnpm exec vitest run
packages/create-kovo/src/index.build.test.ts` passed against generated apps.

- [x] **Local monorepo dogfood linking has an easy broken path.**
  - Observed behavior: after changing generated `@kovojs/*` dependencies to
    `file:../kovo/packages/*`, `pnpm install` first failed on unresolved
    transitive `workspace:*`; after adding a temporary workspace, `pnpm run test`
    and `pnpm run check` failed to resolve `@kovojs/server/vite`, and
    `pnpm run build:prod` failed with
    `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` for `@kovojs/cli/src/bin.ts`
    under `node_modules`.
  - Root cause: local package manifests intentionally expose source `.ts` files
    in-repo, while publish config flips exports to built `dist`. A `file:`
    dependency copies those source-exporting packages into pnpm's `.pnpm`
    store under `node_modules`, where Node's built-in TypeScript stripping
    refuses to execute `.ts` and Vite's config loader resolves source subpaths as
    missing node_modules files. The working local setup needed both
    `link:../kovo/packages/*` and a temporary `pnpm-workspace.yaml` including
    `../kovo/packages/*`.
  - Why it matters: the dogfood skill correctly says to test local monorepo
    packages rather than unpublished npm versions, but the obvious `file:`
    dependency route fails in ways that look like framework or starter breakage.
    Contributors need a reliable one-command local-link path.
  - Repro evidence: `pnpm install` with `file:` dependencies produced
    `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND` for `@kovojs/compiler@workspace:*`; after
    adding `pnpm-workspace.yaml`, `vp test` reported unresolved
    `@kovojs/server/vite`, and `kovo build` failed on
    `@kovojs/cli/src/bin.ts` under `node_modules`. Switching the same app to
    `link:` dependencies plus the workspace file made `pnpm install`,
    `pnpm run test`, `pnpm run check`, and `pnpm run build:prod` pass.
  - Acceptance: provide and document a supported local-dogfood command or script
    that rewrites/scaffolds local Kovo deps correctly. The path should avoid
    source-exported Kovo packages under `node_modules` and should be covered by a
    smoke test that runs `pnpm install`, `pnpm run test`, and `pnpm run
build:prod` in an outside throwaway app.
  - Fixed: `scripts/link-local-kovo.mjs` rewrites generated `@kovojs/*`
    dependencies to `link:` specs and writes a temporary `pnpm-workspace.yaml`;
    `.agents/skills/dogfood/SKILL.md` now instructs dogfood runs to use the
    helper and explicitly keeps it out of public `create-kovo` options.
  - Evidence: `node packages/create-kovo/dist/index.mjs
/tmp/kovo-link-helper-proof --dialect sqlite --disable-git && node
scripts/link-local-kovo.mjs /tmp/kovo-link-helper-proof /Users/mini/kovo`
    produced `link:` specs for generated Kovo dependencies and a workspace entry
    for `/Users/mini/kovo/packages/*`.

## Refuted / Not Carried Forward

- The papercuts-2 auth empty-fragment navigation issue did not reproduce. With JS
  enabled, sign-in and sign-out returned `200
text/vnd.kovo.fragment+html`, `Kovo-Changes: [{"domain":"auth"}]`, empty
  bodies, and the browser navigated to the expected document.
- The papercuts-1/2 empty-fragment and lost-stamp mutation refresh issues did not
  reproduce. Enhanced `addContact` returned a non-empty fragment, inserted the
  new contact, and the DOM still had one `[kovo-deps]`, one
  `[kovo-fragment-target]`, and one `[kovo-live-component]` afterward.
- The dev HMR duplicate live-target renderer issue did not reproduce. Editing
  `src/components/contacts.tsx` caused a Vite SSR page reload, and a subsequent
  enhanced `addContact` returned `200` with a non-empty fragment rather than a
  duplicate-renderer `500`.
- The Better Auth Drizzle peer warning for `drizzle-orm@^0.45.2` versus
  `1.0.0-rc.3` was still present during install, but this run again did not prove
  a direct workflow failure caused by that peer range.

## Latest Verification

- `pnpm exec vp check packages/cli/src/commands/build-export.ts
packages/server/src/egress-undici.ts packages/create-kovo/src/index.ts
packages/create-kovo/src/index.test.ts packages/create-kovo/src/index.build.test.ts
packages/create-kovo/src/index.test-support.ts packages/create-kovo/templates/package.json
packages/create-kovo/templates/package.sqlite.json packages/create-kovo/templates/README.md
packages/create-kovo/templates/README.sqlite.md packages/create-kovo/templates/vite.config.ts
.agents/skills/dogfood/SKILL.md scripts/link-local-kovo.mjs`: passed.
- `pnpm exec vitest run packages/create-kovo/src/index.test.ts`: 19 tests passed.
- `pnpm exec vitest run packages/create-kovo/src/index.build.test.ts`: 4 tests passed.
- `pnpm exec vitest run packages/cli/src/index.kovo-build.test.ts -t "boots emitted node preset output from production dependencies"`:
  passed.
- `pnpm exec vitest run scripts/ci-shards.test.mjs`: 7 tests passed.
- `pnpm --filter create-kovo run build:dist`: passed.
- `node packages/create-kovo/dist/index.mjs /tmp/kovo-link-helper-proof --dialect sqlite --disable-git && node scripts/link-local-kovo.mjs /tmp/kovo-link-helper-proof /Users/mini/kovo`:
  produced `link:` specs and a temporary workspace file.

Historical dogfood run evidence:

- `pnpm --filter create-kovo run build:dist` in `/Users/mini/kovo`: passed before
  scaffolding.
- `pnpm install` in `/Users/mini/kovo-dogfood-3`: passed after switching local
  Kovo deps to `link:` and adding a temporary workspace file.
- `pnpm run test`: 2 files, 5 tests passed.
- `pnpm run check`: passed after formatting local dogfood-only package edits;
  this command also reproduced the npm unknown-config warning papercut.
- `pnpm run build:prod`: passed.
- Browser dev flow on `http://127.0.0.1:5193`: JS-enabled sign-in navigated to
  `/`, enhanced add-contact returned `Kovo-Changes: [{"domain":"contact"}]` with
  a 14 KB fragment and preserved live stamps, HMR edit plus a second enhanced
  add returned a 17 KB fragment, sign-out returned to `/login?next=%2F`, and
  no-JS sign-in/add-contact followed `303 Location: /` document redirects.
- `HOST=0.0.0.0 PORT=5194 node dist/server/server.mjs`: failed before adding a
  direct app `undici` dependency; after `pnpm add -w undici@^7.28.0`, the same
  command listened and `curl -i http://127.0.0.1:5194/login` returned `200`.
