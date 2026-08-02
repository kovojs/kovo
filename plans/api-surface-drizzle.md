# World-class DevEx — typed Drizzle annotation boundary

Status: **implementation complete; final same-manifest packed proof pending**

Charter: `plans/worldclass-devex.md` Track 5c. Types are defense-in-depth; AST/runtime proof remains
authoritative under `SPEC.md` §10.1.

## Completed implementation

- [x] Specify callback-bound concrete table/column identities, parent-table binding, private
      authoring witnesses, and independent AST/runtime enforcement in `spec/10-data-plane.md`.
  - Evidence: `spec/10-data-plane.md` §10.1 owns the callback identity, parent-table, private
    witness, and independent-enforcement contract.
- [x] Bind owner, owner-via, fan-out, and SQL handles to concrete Drizzle identities; reject
      structural/native SQL lookalikes at runtime while accepting witnessed bridge values.
  - Evidence: the focused Drizzle/server static/runtime parity suite covers exact identity,
    generated registry consumption, managed SQL witnesses, and owner-guard use.
- [x] Remove optional structural brands and app-public `any` SQL returns, and internalize all eight
      runtime-metadata exports.
  - Evidence: `pnpm run check:api-surface` reports 31 intended Drizzle root names with zero public
    or recursive leaks; built declarations expose the witnessed `SQL<T>` bridge.
- [x] Ship the checked Drizzle migration rule and packed consumer fixtures for valid, typo,
      wrong-table, owner-via, fan-out, structural-fake, Postgres, and SQLite cases.
  - Evidence: focused Drizzle/migration and `scripts/check-packed-drizzle-consumer.test.mjs` suites
    pass; this proves the runner contract, not the final tarball subject.

## Remaining integration proof

- [ ] Run `pnpm run check:packed-drizzle-consumer` from the final integrated release manifest.
  - Require the canonical `drizzle-orm@1.0.0-rc.4` peer fixture, Postgres and SQLite success,
    compile-time typo/wrong-table/owner-via/fan-out refusal, structural SQL-fake refusal, and no
    unapproved `any` or recursive leak.
- [ ] Close Track 5c only after exact candidate `R` passes the standing source-checkout API,
      migration, snapshot, and ratchet gates, while `R`'s frozen manifest/package set separately
      passes packed publicness, Drizzle, pack-security, and certificate/module-identity gates in
      the release capstone.
  - Source gates bind `R`; only packed gates consume the authenticated manifest/tarballs.

The prior package-local and runner-contract suites are deliberately not promoted to final packed
evidence.
