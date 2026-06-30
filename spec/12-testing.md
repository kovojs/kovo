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

---
