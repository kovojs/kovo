---
title: Stability & Versioning
description: What Kovo promises about its public API, how versions change, and which packages are safe to depend on.
order: 9
---

# Stability & Versioning

This page answers "is this safe to depend on?". The full policy lives in
[`STABILITY.md`](https://github.com/kovojs/kovo/blob/main/STABILITY.md) at the repo
root; this is the short version.

## What counts as public

A symbol is supported public API only if **both** hold:

1. it is exported from a package marked `public` in `public-packages.json`, and
2. it is reachable from that package's published `exports` and is **documented**
   (not tagged `@internal`).

Everything else — `private` packages, `@internal` exports, and raw `./src/**` — is
internal and may change without notice. A CI gate (`scripts/api-surface-gate.mjs`) and
this site's generated [API reference](/api) keep that line visible.

## Public vs internal packages

| Public (depend on these)                                                                                                                                                                                                               | Internal / special                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@kovojs/core`, `@kovojs/server`, `@kovojs/browser`, `@kovojs/drizzle` (the real-database data layer — see the [data-layer guide](/guides/data-layer/))                                                                                | `@kovojs/compiler` — framework build machinery used behind the `kovo` CLI; app projects should run `kovo compile`, `kovo check`, or `kovo explain`, not import compiler APIs |
| `@kovojs/better-auth` — the Better Auth integration: credential mutations and session forwarding; `@kovojs/headless-ui` — accessible behavior/attribute builders for UI primitives (see [Components & copy-in UI](/guides/components)) | `@kovojs/test` — test harness helpers for Kovo apps and packages                                                                                                             |
| `@kovojs/style`, `@kovojs/ui` — versioned styled component subpaths such as `@kovojs/ui/button`; use `kovo add` only when you want copied source to become app-owned code                                                              |                                                                                                                                                                              |
| `@kovojs/cli`, `create-kovo` (CLIs — the `kovo` executable contract, plus `@kovojs/cli`'s `kovoCheck`/`kovoExplain`)                                                                                                                   |                                                                                                                                                                              |

## Versioning

Public packages follow [SemVer](https://semver.org). On the current `0.x` line the API
is stabilizing: **minor** bumps may break, **patch** bumps never do, and every breaking
change is in the release notes. At `1.0.0` the standard guarantee applies. Surface that
ships before it's frozen is marked `experimental_` / `@experimental` and is exempt until
the marker is removed. A public symbol is removed only after a deprecation cycle
(`@deprecated` for at least one minor on `0.x`, naming its replacement).

## Distribution

Published packages ship built `dist/` (JavaScript + rolled-up `.d.ts`), so depending on Kovo does
not couple you to the monorepo's `tsconfig`. The `@internal` boundary is enforced by the generated
API reference and api-surface gate; rolled-up declarations may still contain implementation details.

## Import boundaries

Use the public roots and subpaths that appear in the generated API reference and
`public-packages.json`. Do not import private packages, `@internal` symbols, raw `./src/**`, or
compiler-emitted runtime ABI such as `@kovojs/browser/generated`.

Author-authored browser helpers come from `@kovojs/browser`. The `@kovojs/browser/client` subpath is
for an app-owned browser entry that manually installs the runtime loader; ordinary app components do
not import it. `@kovojs/headless-ui` has no public root import; import primitive behavior from
subpaths such as `@kovojs/headless-ui/select` or `@kovojs/headless-ui/dialog`. `@kovojs/ui` keeps
component symbols on direct component subpaths such as `@kovojs/ui/button`. The root `@kovojs/ui`
entry intentionally exports no components.

`create-kovo` is a public CLI package, not an app import surface.

## Next

- [Components & copy-in UI](/guides/components/) - the package boundaries for UI imports and copied
  source.
- [`CONTRIBUTING.md`](https://github.com/kovojs/kovo/blob/main/CONTRIBUTING.md) - the monorepo
  package map and repo test commands.

<details>
<summary>Spec & diagnostics</summary>

Public API boundary, authorable TSX source requirement, and generated/internal separation: SPEC
§5.2. Additional package-level policy lives in `STABILITY.md` and `public-packages.json`.

</details>
