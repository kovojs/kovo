# Security convergence baseline

This is the first comparable row for `plans/10x-better-security.md`. It measures audited code at
`e5f613be9f1bb1f1cfc568a53e88ee741b3a4ded`; the report files were added afterward and do not
retroactively change that audited tree. The fixed charter is
`security/security-convergence-audit-charter.json`, and the executed round is
`security/security-convergence-audit-round-2026-07-18.json`.

| Date       | R                                         | M                                  | P                                            | G                                                                          | C13                      |
| ---------- | ----------------------------------------- | ---------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- | ------------------------ |
| 2026-07-18 | 1 new root cause; 8m06s; one investigator | 2/2 canaries; 37/37 mutants killed | 5,956 enumerative obligations (vector below) | 18/18 fixture rows; 0 unexpected closed verdicts; 2.350s; 447 MiB peak RSS | 17 corpora / 143 anchors |

R is not zero. The fixed audit found that a real HTTP/2 `:authority=%65xample.com` crossed the
Node-to-Fetch boundary as two app-visible identities: `request.url` used `example.com`, while the
`Host` header retained `%65xample.com`. The round classifies this as a new medium root cause, not a
variant of an existing `bugz-33` or threat-matrix row. The immediate test-only follow-up preserves
the reproduction; remediation and matrix routing remain separate work.

## Measurement definitions

- **R:** one investigator, one turn, a 30-minute ceiling, and the charter's closed production,
  proof-file, and prompt scope. The actual round used 486 seconds. No token budget is claimed
  because the runtime exposed no enforceable per-audit token meter.
- **M:** the two controlled historical ingress canaries were both identified. The live harness
  imported all 37 entries from `SECURITY_GATE_MUTANTS`; all 37 were killed and none survived.
- **P:** 5,899 complete-file `trust-escapes-static.ts` syntax/name obligations, eight imperative-DOM
  sink names, and 49 egress obligations (37 range-table entries, five exact metadata addresses,
  and seven allow paths). The trust-static vector is 2,508 `Node.is*` sites, 827 `SyntaxKind`
  sites, 674 entries in 62 named inventories, 1,316 direct literal-name predicates, 558 inline
  membership entries, and 16 literal switch cases. These counts intentionally expose the
  enumerative treadmill; they are not a claim that every branch has equal security weight.
- **G:** `pnpm run check:green-corpus` accepted all 18 DEC10 fixture rows with no unexpected KV
  verdict. The measured process took 2.350 seconds and peaked at 468,713,472 bytes RSS on Node
  v24.18.0, Darwin arm64, Apple M4, 16 GiB RAM. The current gate accepts zero full real apps; this
  baseline records that gap instead of calling fixture rows applications.
- **C13:** the checked classifier catalog contains 17 corpora, 143 verdict anchors, and 56 unique
  proof files.

Informational only: `trust-escapes-static.ts` was 38,480 lines and `egress.ts` was 2,299 lines.
LOC does not contribute to P.

## Current structural snapshot

The immutable comparable row above remains measured at `e5f613be9` with R=1 and 143 C13 anchors.
After M35's regression anchor landed, the deterministic structural snapshot was refreshed from
parent `f7a82a75c84da95d675c4c713340f3984328d8ca`: M remains 37 catalogued mutants, P remains
5,956, G remains 18 fixture rows, and C13 is now 17 corpora / 144 anchors. This refresh is not a
new audit round and does not manufacture a new R value.

Run `pnpm run check:security-convergence-baseline` to detect deterministic catalog/count drift.
Run it with `-- --live` to rerun all exported mutants and remeasure the green corpus. Timing and RSS
remain environment-specific observations; structural drift requires an explicit new exact-SHA row.
