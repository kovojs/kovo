# Open Design Areas

These areas ship with v1 only if resolved; otherwise they are explicitly punted
with documented workarounds.

- [ ] **13.1 CSS.** Kovo v1 is StyleX-first for app-authored styling through
      `@kovojs/style`. Starters, examples, docs, and official UI primitives
      author typed style objects with `style.create(...)`, compose them with the
      JSX `style` prop or the `style.attrs()` lowering target, and reserve
      `style.raw(...)` for the rare dynamic inline custom-property escape hatch.
      The compiler extracts StyleX atoms into readable provenance-prefixed
      classes, records `data-style-src` in development output, emits CSS in
      cascade-priority `@layer` buckets, and keeps rule attribution so a single
      v1 stylesheet can later split without changing render callers. Raw
      co-located component CSS remains an escape hatch for selectors or
      third-party theming StyleX cannot express well.
- [ ] **13.2 Lists at scale.** Template stamps and the shared `kovo-key` identity
      contract are normative in `SPEC.md` §4.8. Remaining design: cursor
      pagination through URL params, infinite scroll as fragment appends, and
      keyed reordering under simultaneous optimistic updates plus morphing.
- [ ] **13.3 Streaming details.** `<kovo-defer>` exists in `SPEC.md` §8. Remaining
      design: priority hints between deferred fragments and query-JSON placement
      guarantees under HTTP/1.1 fallbacks.
- [x] **13.4 Persistent cross-navigation elements.** Resolved for framework v1 by
      `SPEC.md` §8 and the archived `plans/enhanced-navigation.md` ledger:
      authors still write real
      routes and anchors, and JS-off navigation is a full document. JS-on enhanced
      navigation may preserve only unchanged compiler-stamped layout DOM after
      fetching the canonical target document; this is not app-authored persistent
      state or a client router. Media/state that must survive outside that proof
      still uses app-level platform escape hatches such as SharedWorker sockets or
      popout players rather than a half-iframe architecture.
- [ ] **13.5 Adopt-don't-invent list.** Remaining adoption targets: head/meta, file
      uploads, per-island error boundaries, i18n, and rate limiting as guard
      middleware. Typed sessions have graduated to core in `SPEC.md` §6.5.

## Storage Capability Floor

File upload/download storage is a capability floor, not framework-owned object
storage. The core `StorageCapability` interface is:

- `put(key, body, { contentType?, etag?, metadata? })`
- `get(key)`
- `stat(key)`
- `stream(key)`

Results carry `key`, `size`, `contentType`, `etag`, `lastModified`, and string
metadata. Keys are relative storage keys and adapters must reject paths that
escape their configured root or prefix.

Blessed adapters are in-memory test storage, filesystem storage rooted under a
guarded directory, and an injected S3-compatible client. All share one
conformance suite and preserve caller/provider ETags.
