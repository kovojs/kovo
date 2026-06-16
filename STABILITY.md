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
(`@kovojs/*/internal`, `@kovojs/runtime/loader`, …), and the raw `./src/**` of any
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
`./src`. `@internal` symbols are stripped from the published type surface. Consuming
Kovo therefore does not couple you to the monorepo's `tsconfig`. (In-repo development
and tests resolve source directly; see `plans/api-cleanup.md` Phase 3 for the
packaging mechanism.)
