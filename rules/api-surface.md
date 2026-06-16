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
  symbols are stripped from the rolled-up `.d.ts` at build (plan Phase 3) and excluded
  from the API reference.
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

## Enforcement

- `scripts/public-packages.test.mjs` — every package classified; `private` flags match.
- api-surface CI gate (plan Phase 3) — fails when an untagged symbol is reachable from
  a published entry, or an `@internal` symbol leaks into a published `.d.ts`.
- `site/scripts/api-ref.test.mjs` — the reference is generated from real sources for the
  documented set; undocumented public exports are flagged, never silently omitted.
