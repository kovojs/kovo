# API Surface Rules

How Kovo draws the line between **public** API (an outside consumer may depend on
it; it is documented and changes only under the stability policy) and **internal**
API (repo-internal; no outside consumer should import it and it may change at any
time). The boundary is machine-enforced — these rules explain the mechanism so it
stays binding rather than conventional. Tracked by `plans/api-cleanup.md`.

## The manifest is the source of truth

`public-packages.json` (repo root) classifies **every** workspace package as
`public` or `private`. It is the single source consulted by both the API-reference
generator (`site/scripts/api-ref.mjs`) and the api-surface CI gate, so docs and
enforcement cannot diverge. Adding a package without classifying it fails
`scripts/public-packages.test.mjs`.

- `visibility: "public"` — safe to depend on. Must NOT set `package.json` `private`.
- `visibility: "private"` — repo-internal. MUST set `package.json` `"private": true`.
- `kind` — `library` (importable), `build-tool` (consumed by an app's build/codegen
  step), `cli` (run as a bin), `starter` (shadcn-style copy-in, not a versioned dep).
- `apiRef` — present when the package's public surface is rendered into the generated
  API reference.

## `@public` / `@internal` on exports

A package being public does **not** make every symbol it exports public. Within a
public package:

- A symbol reachable from a published entry point (the `package.json` `exports` map)
  is **public by default** and must be documented (JSDoc, ideally citing the SPEC §).
- Mark a symbol `@internal` (JSDoc tag) when it is exported only for other in-repo
  packages, tests, or compiler-emitted code — never for app authors. `@internal`
  symbols are excluded from the API reference, and the api-surface gate
  (`scripts/api-surface-gate.mjs`) is what makes the tag binding: it fails when an
  untagged, undocumented symbol becomes reachable from a published entry. (The
  rolled-up `.d.ts` does not yet strip `@internal` — the gate, not the build, is the
  enforcement.)
- Prefer moving a cluster of internal exports behind a dedicated internal **subpath**
  (e.g. `@kovojs/server/internal`, `@kovojs/runtime/loader`) over scattering
  `@internal` tags on a flat barrel.

## No `export *` on a public barrel

`export * from './x.js'` auto-publishes every current and future symbol of `x`,
silently widening the public surface. Public package barrels must use explicit named
re-exports so the surface is reviewed on change. (Internal subpaths may use `export *`.)

## Bins are not importable APIs

A package whose `kind` is `cli` exposes a stable **command** contract (subcommands,
flags, exit codes), not an importable JS API. Such packages either omit `exports["."]`
or expose only a small, documented, curated entry — never the argv dispatcher or
transport internals.

## Distribution: source in-repo, `dist` when published

Public packages keep their top-level `exports`/`bin` pointing at `./src` so the
workspace resolves source directly (plain `node`/`tsc`, example `vite build`s, the
compiler's source reads — none of which honor a `development` export condition). The
published tarball instead resolves a built `dist/` (JS + rolled-up `.d.ts`) via pnpm
**`publishConfig`**: pnpm swaps a package's top-level `exports`/`bin` for its
`publishConfig.exports`/`publishConfig.bin` at `pnpm pack`/`publish` time only, a
`prepack` script builds `dist` (`vp pack <entries> --dts`), and `files: ["dist"]`
limits the tarball. This was chosen over a live `exports` flip / `development`
condition precisely because those break in-repo source resolution.

`scripts/build-publish.mjs` is the generator: from each public package's top-level
`exports`/`bin` it derives the build entries (every distinct `./src/<path>.ts(x)`)
and the `publishConfig` (each `./src/<path>.ts(x)` → `{ types: ./dist/<path>.d.mts,
default: ./dist/<path>.mjs }`; `bin` → `./dist/<path>.mjs`). Run `--write` to
regenerate after changing a package's `exports`; the default mode builds and verifies
every published target resolves to a built file.

## Enforcement

- `scripts/public-packages.test.mjs` — every package classified; `private` flags match.
- api-surface CI gate (`scripts/api-surface-gate.mjs`) — fails when an untagged,
  undocumented symbol is reachable from a published entry (a ratchet against
  `api-surface-baseline.json`).
- `scripts/build-publish.mjs` (CI gate `pnpm run check:publish`) — builds each public
  package and asserts every `publishConfig` target file exists under `dist/` (publish-readiness).
- `site/scripts/api-ref.test.mjs` — the reference is generated from real sources for the
  documented set; undocumented public exports are flagged, never silently omitted.
