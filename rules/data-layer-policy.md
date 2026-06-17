# Data-Layer Policy

`SPEC.md` section 10 defines Kovo's data-plane behavior. This rule records the
standing implementation policy for adapters and inference.

Kovo core defines a capability interface, not a portability promise:

- Writes expose touch sets.
- Queries expose read sets, result types, and instance keys.
- Adapters implement what they can; declared touches and explicit invalidation
  remain the universal floor.

The v1 floor is:

- A domain layer with declared `touches`.
- Flat tags as the low-ceremony on-ramp.
- `invalidate()` as a linted escape hatch.
- `@kovojs/drizzle` as the blessed adapter, with touches inferred from ASTs,
  schema-as-registry, derived query shapes/keys, and hand-written optimism
  against the transform IR.

Drizzle coupling is managed by a pinned, conformance-tested subset of Drizzle's
surface. The extraction pass targets tables as first-argument identifiers, and
the suite must fail loudly on API drift.

Raw SQL is a marked second-class citizen: it requires KV406 annotation and
runtime verification, and it is excluded from derived optimism. That is
acceptable only because the seam is explicit.
