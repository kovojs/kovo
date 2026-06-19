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

| Public (depend on these)                                                                                                                                                                                                                   | Internal / special                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@kovojs/core`, `@kovojs/server`, `@kovojs/runtime`, `@kovojs/drizzle` (the real-database data layer — see the [data-layer guide](/guides/data-layer/))                                                                                    | `@kovojs/compiler` — framework build machinery used behind the `kovo` CLI; app projects should run `kovo compile`, `kovo check`, or `kovo explain`, not import compiler APIs                                                                                       |
| `@kovojs/better-auth` — the Better Auth integration: credential mutations and session forwarding, and `@kovojs/headless-ui` — accessible behavior/attribute builders for UI primitives (see [Components & copy-in UI](/guides/components)) | `@kovojs/test` (harness only; fixtures live in the private `@kovojs/conformance-fixtures`)                                                                                                                                                                         |
| `@kovojs/style`                                                                                                                                                                                                                            |                                                                                                                                                                                                                                                                    |
| `@kovojs/cli`, `create-kovo` (CLIs — the `kovo` executable contract, plus `@kovojs/cli`'s `kovoCheck`/`kovoExplain`)                                                                                                                       | `@kovojs/ui` — the styled component package; **not** a versioned dependency you must pin: import `@kovojs/ui/<component>` subpaths or copy components in shadcn-style (see [Components & copy-in UI](/guides/components)); copied source builds on public packages |

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
