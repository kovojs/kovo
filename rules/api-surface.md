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
- Generated subpaths, such as `@kovojs/browser/generated`, expose compiler-emitted
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

## Every public concept has a checked decision

`api-surface-decisions.json` is the symbol-level review ledger for the
manifest-declared app-public surface. Each declaration is either covered by an
exact row or, for the generated UI and icon families only, one constrained
family rule. A row records:

- `keep`, `move`, `internalize`, or `remove`;
- its one canonical home;
- the concrete app-author story and owner;
- a precise `SPEC.md` or normative `spec/` section;
- a packed compilation marker and an existing behavioral contract test.

Every public subpath likewise has an owned, documented task. Wildcard decisions
are not allowed for ordinary packages, and `/types` or package-wide catch-all
barrels do not count as task homes.

The ledger baseline is a no-growth boundary, not a permanent compatibility
promise. A new declaration needs an exact public `keep` row. A new public value
also needs a release note, a non-test authored example that imports it, and a
contract test that imports it. A new subpath needs its own reviewed task row.
Exporting a previously internal helper to make a recursive leak disappear is
therefore public-surface growth and fails the gate.

Root declaration targets in the ledger are health metrics for the Track 5 cuts.
They do not authorize moving names to arbitrary subpaths; the story, canonical
home, example, and ownership requirements remain binding.

## Recursive signatures only descend

`api-surface-baseline.json` schema v2 records the exact identity of every
existing recursive-publicness leak and a maximum for each owning package.
CI rejects:

- a new leak identity, even if another leak was removed in the same package;
- moving debt to another package;
- any package exceeding its committed maximum;
- a stale baseline after a repair.

After a real repair, run `node scripts/api-surface-gate.mjs --write`. Write mode
accepts removals only and lowers the relevant package maximum. It refuses
additions. Making the leaked helper public is not a repair; the decision-ledger
growth gate independently rejects that anti-pattern unless the helper earns a
complete public API review.

## Packed declarations may not hide `any`

`scripts/packed-public-any-gate.mjs` compiles a generated consumer against the
canonical package tarballs, verifies the packed export names against the
decision ledger, and walks app-public declaration ASTs. The walk starts at
public exports and recursively resolves first-party aliases and referenced
types, so renaming an `any` or placing it behind a conditional/type alias does
not hide it. Text in comments is irrelevant, and third-party declaration
internals remain the dependency owner's responsibility.

Existing debt is listed in `api-public-any-exceptions.json`. An exception must
name one exact package, a declaration/symbol/member scope, a stable owner, a
concrete reason, an expiry date, and an exact match maximum. Expired, unused,
overlapping, over-budget, and stale-under-budget exceptions fail. Broad
declaration wildcards must narrow the symbol or member (the generated UI
`render` family is the intended example).

## Breaking batches require migration evidence first

`api-migrations.json` and `docs/api-migration-protocol.md` define the migration
contract. Before an old export disappears, its batch must:

1. expose exact `--check` and `--write` modes;
2. ship mechanical rewrite rules plus fail-closed refusal rules and fixtures;
3. emit the versioned structured result with source-anchored refusals;
4. record an exercised check run, a release note, and concrete rollback;
5. reach `removed` state and cover the exact decision row.

The public decision stays `state: "public"` while the batch is `preparing` or
`ready`. Marking it removed earlier fails CI. Migration tools must never guess
app context, authentication/CSRF/deployment posture, dynamic bindings, SQL
semantics, or trust decisions.

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
  when a new untagged undocumented public export appears; recursive leaks are an
  exact-identity, descending per-package ratchet in `api-surface-baseline.json`.
- checked API ledger (`scripts/api-decision-ledger.mjs`) — requires a complete
  decision, story, canonical home, SPEC citation, packed marker, contract test,
  and task-level subpath review; rejects unreviewed declaration/subpath growth.
- migration protocol (`scripts/api-migration-protocol.mjs`) — prevents an old
  public export from disappearing before its checked rewrite/refusal batch is
  exercised and marked removed.
- `scripts/build-publish.mjs` (CI gate `pnpm run check:publish`) — builds each public
  package and asserts every `publishConfig` target file exists under `dist/` (publish-readiness).
- packed app-public gate (`scripts/packed-public-any-gate.mjs`, after
  `check:publish`) — compiles every public tarball entry, compares packed exports
  with the ledger, recursively unwraps first-party declaration aliases, and
  enforces the expiring exact-count `any` exception ratchet.
- `site/scripts/api-ref.test.mjs` — the reference is generated from real sources for the
  documented set; undocumented public exports are flagged, never silently omitted.
