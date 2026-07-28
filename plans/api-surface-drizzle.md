# World-class DevEx — typed Drizzle annotation boundary

Status: **active child ledger**

Charter: `plans/worldclass-devex.md` Track 5c. Dependency: an explicit `SPEC.md` §10.1 decision.
Types remain defense-in-depth; AST/runtime proof remains authoritative.

- [ ] Specify the concrete table/column annotation contract in `spec/10-data-plane.md`.
- [ ] Bind owner, owner-via, fan-out, and SQL handles to concrete Drizzle identities with private
      witnesses.
- [ ] Remove optional structural brands and app-public `any` SQL returns.
- [ ] Move all eight runtime-metadata exports behind the internal boundary.
- [ ] Reject typo and wrong-table owner annotations in packed TypeScript fixtures.
- [ ] Reject typo and wrong-table owner-via/fan-out references.
- [ ] Reject structural SQL fakes while accepting valid typed bridge values.
- [ ] Pass packed Postgres, SQLite, and every supported Drizzle peer fixture.
- [ ] Preserve AST/runtime enforcement and explain parity.
- [ ] Complete the standing API/migration/snapshot/ratchet checklist and expose no recursive leak
      or unapproved `any`.

## Latest verification

No implementation checkbox has been closed in this ledger yet.
