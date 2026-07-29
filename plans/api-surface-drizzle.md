# World-class DevEx — typed Drizzle annotation boundary

Status: **implementation complete; integration proof pending**

Charter: `plans/worldclass-devex.md` Track 5c. Dependency: an explicit `SPEC.md` §10.1 decision.
Types remain defense-in-depth; AST/runtime proof remains authoritative.

- [x] Specify the concrete table/column annotation contract in `spec/10-data-plane.md`.
  - Evidence: `spec/10-data-plane.md` §10.1 defines callback identities, parent-table binding,
    private authoring witnesses, and independent AST/runtime proof.
- [x] Bind owner, owner-via, fan-out, and SQL handles to concrete Drizzle identities with private
      witnesses.
  - Evidence: the focused Drizzle/server parity suite below passes 64 tests, including exact
    runtime identity rejection and managed SQL witnesses.
- [x] Remove optional structural brands and app-public `any` SQL returns.
  - Evidence: `pnpm --filter @kovojs/drizzle run build:dist` emits the witnessed `SQL<T>` bridge;
    the packed declaration assertion rejects structural leaks and `any`.
- [x] Move all eight runtime-metadata exports behind the internal boundary.
  - Evidence: `pnpm run check:api-surface` reports 31 intended root names and zero public or
    recursive-publicness leaks.
- [ ] Reject typo and wrong-table owner annotations in packed TypeScript fixtures.
  - Integration proof: the fixture is encoded in `scripts/check-packed-drizzle-consumer.mjs`; run
    the canonical packed command below after integration.
- [ ] Reject typo and wrong-table owner-via/fan-out references.
  - Integration proof: run `pnpm run check:packed-drizzle-consumer` after the canonical release
    manifest is generated.
- [x] Reject structural SQL fakes while accepting valid typed bridge values.
  - Evidence: `packages/drizzle/src/runtime-surface.test.ts` and the focused parity suite below
    accept witnessed constructors while rejecting native and structural lookalikes.
- [ ] Pass packed Postgres, SQLite, and every supported Drizzle peer fixture.
  - Integration proof: `scripts/check-packed-drizzle-consumer.mjs` installs the canonical tarball
    with the ratified `drizzle-orm@1.0.0-rc.4` fixture and compiles both dialects.
- [x] Preserve AST/runtime enforcement and explain parity.
  - Evidence: the focused parity suite below covers static resolution, compiler-bound runtime
    metadata, generated registry consumption, and owner-guard use.
- [ ] Complete the standing API/migration/snapshot/ratchet checklist and expose no recursive leak
      or unapproved `any`.
  - Remaining integration work: run the canonical packed gate, refresh the parent track/certificate
    evidence, and close this item from that exact integrated state.

## Latest verification

- `pnpm exec vitest --run <Drizzle/runtime/server parity files> --reporter=dot` — 8 files, 64 tests.
- `pnpm exec vitest --run scripts/check-packed-drizzle-consumer.test.mjs --reporter=dot` — 5 tests.
- `pnpm run check:api-surface` — zero public leaks; 28 API ledger/protocol tests.
- `pnpm exec vitest --run scripts/migrate-drizzle-api-v1.test.mjs --reporter=dot` — 5 tests.
- `pnpm --filter @kovojs/drizzle run build:dist` and targeted `vp check` — clean.
