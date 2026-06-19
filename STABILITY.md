# Stability & Versioning Policy

This document states what Kovo promises about its public API and how it changes.
It is the answer to "is this safe to depend on?" — the question the audit found had
no answer. Tracked by `plans/api-cleanup.md`.

## What is "public"

A symbol is part of the supported public API only if **both**:

1. it is exported from a package classified `public` in `public-packages.json`, and
2. it is reachable from that package's published `exports` map and is **documented**
   (not tagged `@internal`).

Everything else — `private` packages, `@internal` exports, internal subpaths
(`@kovojs/*/internal`, `@kovojs/browser/loader`, …), and the raw `./src/**` of any
package — is internal. It may change or disappear in any release with no notice. Do
not import it; the api-surface gate (`scripts/api-surface-gate.mjs`) and the generated
API reference exist to keep this line visible.

`@kovojs/ui` is **not** a versioned dependency: it is a shadcn-style copy-in starter
("you own the code"). Its stability contract is the contract of what you copied; the
primitives it builds on (`@kovojs/headless-ui`) are the versioned public dependency.

## Versioning (SemVer, from `0.x`)

Public packages follow [Semantic Versioning](https://semver.org). While on the `0.x`
line, the API is stabilizing: **minor** bumps may contain breaking changes, **patch**
bumps never do, and every breaking change is called out in the release notes. At
`1.0.0` the standard SemVer guarantee takes effect — breaking changes to public API
only on a **major** bump.

Unfinished surface that ships before it is frozen is marked: a `experimental_` name
prefix or an `@experimental` JSDoc tag means "public, but exempt from the SemVer
guarantee until the marker is removed."

## Deprecation

A public symbol is removed only after a deprecation cycle: it is first marked
`@deprecated` (with the replacement named) for at least one minor release on the `0.x`
line (one major on `1.x`+), kept working for that window, then removed. Deprecations
are listed in the release notes.

## Distribution

Published packages ship a built `dist/` (JavaScript + rolled-up `.d.ts`) — never raw
`./src`. Consuming Kovo therefore does not couple you to the monorepo's `tsconfig` or
`jsxImportSource`.

The mechanism is pnpm **`publishConfig`**: each public package's top-level
`exports`/`bin` point at `./src`, but a `publishConfig.exports`/`publishConfig.bin`
points at `./dist`, and pnpm swaps them in at `pnpm pack`/`pnpm publish` time (a
`prepack` script builds `dist` first via `vp pack … --dts`, and `files: ["dist"]`
keeps the tarball to the build output). So the published tarball resolves `dist`
while the in-repo workspace resolves `./src` exactly as during development.

A live `exports` flip — or resolving source only behind a `development`/`source`
export condition — was evaluated and **rejected**: many in-repo consumers resolve
source via plain `node`/`tsc` (and example `vite build`s) that do not honor a
`development` condition, so the workspace would break. `publishConfig` is the only
mechanism that keeps source resolution unchanged in-repo while still shipping `dist`
to consumers. The generator (`scripts/build-publish.mjs`) derives each package's
build entries and `publishConfig` from its top-level `exports`/`bin`;
`node scripts/build-publish.mjs` (the generator's default build+verify mode, run in CI
as `pnpm run check:publish`) builds every public package and proves each published
target resolves to a built file. See `plans/api-cleanup.md` Phase 3.
