# API Surface Rules

How Kovo draws the line between **public** API (an outside consumer may depend on
it; it is documented and changes only under the stability policy), **generated**
ABI (compiler-emitted code may import it; app authors may not), **internal** API
(repo-internal; no outside consumer should import it and it may change at any
time), and **private** implementation files (not exported from a package). The
boundary is machine-enforced — these rules explain the mechanism so it stays
binding rather than conventional. Tracked by `plans/api-boudnary.md`.

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
- `apiBoundary.public` — package export subpaths that are app-facing public API.
- `apiBoundary.generated` — package export subpaths that form compiler-emitted
  generated-code ABI. These are published and typed when listed in `exports`, but
  are not human-public API.
- `apiBoundary.internal` — package export subpaths for repo-internal consumers.
  Use the narrowest subsystem path that matches the dependency graph; a broad
  `./internal` barrel is a compatibility fallback, not the default design.
- `apiRef` — present when the package's public surface is rendered into the generated
  API reference. Public docs are root/public-entry only; generated and internal
  subpaths are excluded.

## Public, generated, internal, and private exports

A package being public does **not** make every symbol it exports public. Within a
public package, every `package.json` export subpath is classified by
`public-packages.json`:

- Public subpaths expose only app-facing API. Every exported declaration must be
  documented (JSDoc, ideally citing the SPEC § where behavior is normative), and
  public subpaths must not export declarations tagged `@internal` or `@generated`.
  If a function, class, constant, or type is public, then every parameter type,
  return type, property type, callback type, generic constraint/default, overload,
  and referenced helper type needed to use it must also be public, recursively.
  A public signature must not require importing or naming an internal/generated
  type. Either promote the supporting type to the same public surface, redesign
  the signature to use an existing public type, or move the original symbol behind
  an internal/generated subpath too.
- Generated subpaths, such as `@kovojs/runtime/generated`, expose compiler-emitted
  ABI. They may export declarations tagged `@generated` plus documented public
  types needed to type that ABI. They must not export `@internal` declarations or
  untagged undocumented declarations.
- Internal subpaths, such as `@kovojs/server/internal/wire`, expose repo-internal
  contracts. They may export declarations tagged `@internal` plus documented
  public types needed to type those contracts. They must not export `@generated`
  declarations or untagged undocumented declarations.
- Private files are implementation details imported only by relative paths within
  the same package. Do not add a package export for a file unless a sibling
  package, emitted module, test fixture, or tool has a real import contract.

`scripts/api-surface-gate.mjs` makes these tags binding. The rolled-up `.d.ts`
files may still contain generated/internal declarations for their non-public
subpaths; docs and the gate define whether an entry is human-public.

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
- api-surface CI gate (`scripts/api-surface-gate.mjs`) — fails when
  `@internal`/`@generated` declarations are reachable from a public subpath, when
  generated/internal subpaths export declarations outside their allowed tier, or
  when a new untagged undocumented public export appears (a ratchet against
  `api-surface-baseline.json`).
- `scripts/build-publish.mjs` (CI gate `pnpm run check:publish`) — builds each public
  package and asserts every `publishConfig` target file exists under `dist/` (publish-readiness).
- `site/scripts/api-ref.test.mjs` — the reference is generated from real sources for the
  documented set; undocumented public exports are flagged, never silently omitted.
