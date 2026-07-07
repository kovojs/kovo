# Classify-and-Pin Audit

Date: 2026-07-06

This note records the followup-16 DEC-F validate-then-emit audit for the known boundary sinks.
Status meanings:

- `pinned`: the framework classifies/normalizes the caller value, then pins the exact accepted
  value into an immutable framework-owned carrier used by the sink.
- `fixed`: the framework discards caller-owned bytes at the sink and emits a reconstructed or
  fail-closed fixed value.
- `N-A`: the sink is already framework-owned/structural at construction time, so classify-and-pin is
  not the relevant invariant to claim.

| Sink                                 | Status   | Concise evidence                                                                                                                                                                                                                                     |
| ------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Egress connect floor                 | `pinned` | `packages/server/src/egress.ts` installs the net-connect floor; `packages/server/src/egress.test.ts` proves live enforcement, loose-IPv4 resolve-then-pin, and multi-A/per-entry validation before connect.                                           |
| Redirect `Location`                  | `fixed`  | `packages/server/src/response.ts` routes redirects through `redirectLocationHeader()` / `redirectLocationHeaderValue()` and fails closed to `/`; `packages/server/src/response.test.ts` proves final-sink revalidation of mutable values.             |
| Wrapped-client statement reconstruct | `pinned` | `packages/server/src/sql-safe-handle.ts` names the single managed SQL choke; `packages/server/src/managed-db.test.ts` shows request-scoped principal/role reconstruction and proves unsafe statement text is refused before execution.                |
| `sql.identifier(...)`                | `pinned` | `packages/drizzle/src/runtime.ts` validates the identifier before minting the branded fragment; `packages/drizzle/src/runtime-surface.test.ts` proves hostile identifier text and allowlist drift fail closed with KV422.                              |
| Header / cookie serialization        | `N-A`    | `packages/server/src/cookies.ts` and `packages/server/src/response.ts` serialize through framework-owned typed builders/channels; `packages/server/src/cookies.test.ts` and `packages/server/src/response-posture.test.ts` prove structural handling. |

Audit conclusion: the live classify-and-pin obligations are the egress resolved-IP floor, managed SQL
statement reconstruction, and `sql.identifier(...)` witness minting. Redirects satisfy the invariant
through fixed reconstruction at the final sink. Header and cookie channels are already framework-owned
structural serialization sinks, so the relevant claim is owned-channel serialization, not pinning.
