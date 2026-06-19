# Browser Rename — `@kovojs/runtime` → `@kovojs/browser`

**Goal:** Rename the browser-side runtime package from `@kovojs/runtime` to `@kovojs/browser` for
execution-environment clarity, pairing cleanly with `@kovojs/server`. Decision rationale: `runtime`
is an overloaded token (Node/edge/`jsx-runtime`/run-time-vs-compile-time) that does not signal
_where_ the code runs; `browser` has exactly one meaning and reads clearly for both humans and LLMs.
Triad becomes `@kovojs/compiler` (produces) → `@kovojs/server` / `@kovojs/browser` (execute).

**Status:** Not started. Pre-release — **no back-compat window** for already-emitted modules is
required (no published consumers); the rename can be a single atomic flip.

**Behavior source of truth:** `SPEC.md`. The generated ABI subpath is compiler-owned and
compiler↔package co-versioned (`SPEC.md` §6.6, §8); renaming the package renames that ABI specifier
in lockstep, which is allowed precisely because the compiler and package ship together.

**Scope note (artifacts vs source):** Emitted/generated modules under `**/src/generated/**` and
lowered IR are **artifacts** (`SPEC.md` §5.2 — hand-authored lowered IR is KV235). Do **not** hand-edit
their `@kovojs/runtime*` imports; regenerate them from the renamed compiler emit and verify the diff.

Mark `- [x]` only when this session verifies the cited proving command for the exact item
(CLAUDE.md Progress Discipline). Nest proving evidence under the item when closed.

---

## Open decisions

- [ ] **Rename the directory too?** Recommend `packages/runtime/` → `packages/browser/` so the
      on-disk layout matches the package name (avoids a `dir: "browser"` / `name: "@kovojs/browser"`
      mismatch in `public-packages.json`). If we keep the dir, this whole plan still works but leaves a
      `packages/runtime` folder publishing `@kovojs/browser` — confusing. **Default: rename the dir.**
- [ ] **Public docs slug.** `public-packages.json` uses slug `runtime` / `runtime-client` and the
      generated reference page `site/gen/api/runtime.md`. Default: slug → `browser` / `browser-client`,
      page → `browser.md`, and update guide cross-links.
- [ ] **Internal identifiers (optional polish).** `RUNTIME_GENERATED_IMPORT`,
      `galleryRuntimeModuleHref`, etc. are internal names, not the public specifier. Out of scope for the
      rename itself; rename opportunistically only if it does not widen the diff materially.

---

## Work items

### 1. Package itself

- [ ] Rename `packages/runtime/` → `packages/browser/` (git mv) and set `name` to `@kovojs/browser`
      in its `package.json`. Subpaths stay (`./client`, `./generated`, `./internal/*`) → become
      `@kovojs/browser/client`, `@kovojs/browser/generated`, etc.
  - Touch points: `packages/runtime/package.json` (`name`), `build:dist`/`build:inline-loader`
    scripts reference `src/*` paths only (no specifier change needed inside scripts).

### 2. Compiler emit (the hardcoded ABI specifier — highest-leverage)

- [ ] Flip the emitted import specifier `@kovojs/runtime/generated` → `@kovojs/browser/generated`
      in the four `RUNTIME_GENERATED_IMPORT` constants:
  - `packages/compiler/src/emit/bootstrap.ts:3`
  - `packages/compiler/src/emit/client.ts:21`
  - `packages/compiler/src/lower/structural-jsx.ts:41`
  - `packages/compiler/src/lower/inline-derives.ts:23`
- [ ] Update the emit↔barrel contract test asserts: `packages/compiler/src/emit/bootstrap-runtime-contract.test.ts`.

### 3. Dependent workspace `package.json`s

- [ ] Update every `@kovojs/runtime: "workspace:*"` dependency entry to `@kovojs/browser`.
      Consumers: `@kovojs/server`, `@kovojs/compiler`, `@kovojs/drizzle`, `@kovojs/ui`, `@kovojs/test`,
      `@kovojs/conformance-fixtures`, `@kovojs/cli`, `create-kovo`, plus the examples (gallery,
      stackoverflow, crm) and `site`. Then `pnpm install` to relink the workspace.

### 4. Hand-authored source imports

- [ ] Update non-generated `.ts/.tsx` imports of `@kovojs/runtime`(`/client`,`/internal/*`) across
      `packages/{server,compiler,drizzle,conformance-fixtures}/src`, example app source, and `site/src`.
      (Excludes `**/src/generated/**` — see item 6.)

### 5. Gallery runtime-href patching

- [ ] Update the `.replaceAll` specifier patches and import in:
  - `examples/gallery/src/app-shell.ts:166-167` (`@kovojs/runtime/generated`, `@kovojs/runtime`)
  - `examples/gallery/src/interactive-gallery.generated-browser-fixtures.ts:2` (`@kovojs/runtime/client`)
  - `examples/gallery/src/interactive-gallery.static-export.test.ts:28` (`not.toContain('@kovojs/runtime')` → `'@kovojs/browser'`)

### 6. Regenerate emitted artifacts (do NOT hand-edit)

- [ ] Regenerate generated modules so their imports point at `@kovojs/browser/*`:
  - `examples/gallery/src/generated/interactive/**` (~35 files)
  - `examples/stackoverflow/src/generated/optimistic/**` (~3 files)
  - any other `**/src/generated/**` and integration `tests/integration/fixtures/**` stamps that pin
    `@kovojs/runtime`.
  - Proof: regenerate via the example `emit-graph`/compile path, then `git diff` shows only the
    specifier change (no structural churn). Hand-edits here would violate `SPEC.md` §5.2.

### 7. Manifests, spec, rules, docs

- [ ] `public-packages.json`: `name`, `dir`, slugs, and description (drop "Client runtime:" wording
      if reslugged) at lines ~73–99.
- [ ] `SPEC.md` (§6.6, §8 + the `import { handler } from '@kovojs/runtime'` example).
- [ ] `STABILITY.md`, `rules/api-surface.md` reference, `docs/integration-testing.md`.
- [ ] `site/content/guides/{islands,streaming,optimistic}.md`, `site/content/docs/stability.md`, and
      regenerate `site/gen/api/runtime.md` → `browser.md` (+ `site/dist/**` rebuild artifacts).
- [ ] Cross-references in other `plans/*.md` (`api-cleanup.md`, `no-magical-generated.md`) — update
      the specifier mention; do not rewrite their historical evidence.

---

## Latest verification (fill on close)

Run the narrowest-then-broaden gate set:

- [ ] `grep -rn "@kovojs/runtime" . --exclude-dir=node_modules` returns **zero** (no stragglers).
- [ ] `pnpm install` relinks the workspace cleanly.
- [ ] `tsc` / typecheck across touched packages passes.
- [ ] `packages/compiler` emit + `bootstrap-runtime-contract.test.ts` green (ABI specifier flip).
- [ ] api-surface gate (`scripts/api-surface-gate.mjs`) passes with the renamed manifest entry.
- [ ] Integration suite (`tests/integration`) + gallery static-export test green.
- [ ] `git diff --check` clean.
