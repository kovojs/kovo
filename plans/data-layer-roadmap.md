# Data-Layer Roadmap

`SPEC.md` section 10 defines normative data-plane behavior.
`rules/data-layer-policy.md` defines the standing adapter and inference policy.
This ledger tracks staged data-layer work.

## Stages

- [x] **v1 floor.** Core model: domain layer with declared `touches`, flat tags
      as the low-ceremony on-ramp, and `invalidate()` as a linted escape hatch.
      Evidence: `rules/data-layer-policy.md`.
- [x] **v1 blessed adapter.** `@kovojs/drizzle`: touches inferred from ASTs,
      schema-as-registry, query shapes/keys derived, and optimism hand-written
      against the transform IR. Evidence: `rules/data-layer-policy.md`.
- [ ] **v1.5 verification layer.** Runtime instrumentation as CI cross-check
      for KV402-KV409; unified typed change record `{ domain, keys, input }`
      feeding optimism now and the v2 live bus later. Mechanism: pglite harness.
- [ ] **v2 derived optimism and live queries.** Compiler-generated transforms via
      the `SPEC.md` §10.5 algebra, property-tested soundness, named punts, and
      `<kovo-live>` over SSE with guard-recheck-per-push and in-process/Redis
      bus. CDC adapter as live-query transport and out-of-band write support.
- [ ] **v3 runtime read/write tracking.** Full Convex-style precision only if a
      managed data product exists; never the default because it trades static
      printability away.
