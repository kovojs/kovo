# Security Ledger Index

`plans/security-ledger-index.json` is the machine-readable registry for active security roadmaps
and transient bug or dogfood ledgers. A filename, sequence number, or unchecked box does not make a
ledger active; registration does. `pnpm run check:security-ledger-index` enforces this contract.

## Active roadmaps

| Roadmap                              | Role                                            |
| ------------------------------------ | ----------------------------------------------- |
| `plans/10x-better-security.md`       | Security convergence and forcing gates          |
| `plans/threat-matrix-plan.md`        | Coverage matrix, external audit, and v1 signoff |
| `plans/most-secure-web-framework.md` | Strategic opportunity backlog                   |
| `plans/secure-framework.md`          | Audit-driven implementation backlog             |
| `plans/secure-framework-3.md`        | Additional capability follow-ups                |

## Transient ledgers

| Ledger             | State                       | Archive deadline | Archive destination        |
| ------------------ | --------------------------- | ---------------- | -------------------------- |
| `plans/bugz-33.md` | Closed; publication pending | 2026-07-25       | `plans/history/bugz-33.md` |

There may be zero, one, or many transient ledgers. Do not infer a required count or discover them
from `bugz-*` / `papercuts-*` filenames.

## Lifecycle

1. Allocate a conventional path from the registry's `ledgerKinds.<kind>.nextSequence`, or honor an
   explicit user path. Add `<!-- kovo-security-ledger: transient -->`, register the exact path, and
   set `openedOn`, `archiveBy`, and `archivePath` in the same change. The deadline must be within 30
   days of opening. Increment the sequence only when its conventional path is consumed.
2. Keep the ledger `open` while any actionable item remains. After exact acceptance evidence closes
   every item, set `closedOn` and move it to `closed-pending-publication`.
3. After the closing commit is on the intended remote ref and required CI is known, record the
   commit, ref, and verification date and move it to `published-pending-archive`.
4. Before `archiveBy`, replace the transient marker with
   `<!-- kovo-security-ledger: archived -->`, move the file to its declared `plans/history/` path,
   remove it from `transientLedgers`, and add or update one compact historical-series summary when
   useful. A rename preserves exact findings and refutations for future deduplication.

Run `pnpm run check:security-ledger-index` after every lifecycle transition.

## Historical deduplication

Search all Markdown below every `history.dedupRoots` entry before filing a finding. This deliberately
includes archived files and old ledgers whose checkboxes are stale; activity comes only from the
explicit registry. The compact series summaries cover foundational security plans, the
fundamental-fixes sequence, adversarial security dogfood rounds, and numbered bug ledgers through
`bugz-32`. Read the source ledger when an exact prior root cause or refutation matters.
