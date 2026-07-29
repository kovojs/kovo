# Testing API (SPEC §12)

This file is incorporated by reference from [../SPEC.md](../SPEC.md) and is normative for Kovo framework behavior.
The root spec remains the entry point and cross-reference index; this module owns the detailed contract below.

## 12. Testing API

The testing surface mirrors the framework proof surface. Mutations execute as functions with
touch-checking enabled, pages render to inspectable HTML without a browser, typed error paths expose
the declared error union, and generated optimistic transforms have property tests for
`patch(shape(s), input) ≡ shape(apply(effect, s, input))`. Handlers unit-test as `(event, ctx)`
functions; transforms as pure `(data, input)` functions; the wire as HTTP.

API examples and integration harness guidance live in `docs/integration-testing.md` and
`site/content/guides/testing.md`.

An app-scoped test harness accepts the opaque `KovoApp` plus a digest-verified compiler proof graph.
Compile-time types flow from the imported contract and declaration handles: query input/result,
mutation input/result/error union, route params/search, request/session/DB/env, and task/endpoint
types. The graph supplies runtime identities and proof facts; the token and TypeScript types do not
substitute for it. A stale, partial, failed-build, digest-mismatched, or wrong-app graph fails before
one handler runs. Public app tests do not inspect the token, call private aggregate constructors, or
mock framework internals.

---
