# Round-14 Papercuts 33

Created 2026-07-04. Source of truth remains `SPEC.md`. DevEx/parity items from the Round-14 Postgres security dogfood
AFTER `plans/fundamental-fixes-followup-9.md`. Security fail-opens are in `plans/claude-bugz-35.md`. This round was
security-focused and largely confirmed followup-9 held; only one parity papercut surfaced.

## Issues

- [ ] **P1 — `rawRead` skips the declared-reads table-scope validation and the owner-scope `actAs` requirement on Postgres (enforced on SQLite), so the two dialects diverge on what `rawRead` checks.** (LOW, framework/parity; `pg-principal-role-forge` PRF-2; refuted as a fail-open — RLS still scopes the read on PG — but a real inconsistency)
  - Observed: on Postgres, a `rawRead` does not run the declared-reads table-scope validation / `actAs`-owner requirement that the SQLite path enforces; the read is instead scoped by engine RLS. No cross-owner leak (RLS holds), but the framework-level check is a no-op on PG.
  - Root cause: the `rawRead` validation is wired for the SQLite predicate-injection path; on Postgres the engine RLS is the enforcement, so the framework check was left as a no-op — but the divergence is undocumented and could mislead an author porting between dialects.
  - Why it matters: dialect parity for a security-adjacent escape; an author who relies on the SQLite-side `rawRead` validation gets different behavior on PG (safe, but different).
  - Acceptance: either the `rawRead` framework validation runs identically on both dialects, or SPEC documents that on Postgres `rawRead` is scoped by engine RLS and the declared-reads check is advisory; a test pins the intended behavior per dialect.

## Refuted / Not Carried Forward

- See `claude-bugz-35.md` "Refuted" — the strong positive signal this round: the aclexplode retain-and-prove audit held against 15 shapes (types, domains, rules, ownership, multi-hop membership, default privileges, partitions, large objects), the auth brand sole-door is fixed, `structuredClone` box parity is fixed, SSRF/XSS/secret-egress held, and the least-priv provision + identity invariant hold. The new findings are on the session-GUC/role-frame axis and the definer-trigger audit gap (bugz-35).

## Latest Verification

- P1 reproduced/refuted-as-failopen by the `pg-principal-role-forge` verifier. Throwaway apps under
  `/Users/mini/kovo-dogfood-round14/` — safe to delete. `/Users/mini/kovo` untouched; no servers left running.
