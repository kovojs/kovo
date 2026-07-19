# Kovo Security Guarantees

This document is Kovo's current security guarantee register. It is deliberately narrow:
the guarantees below are only the invariants backed by an enrolled TCB choke in
`security/TCB.md` and by a runtime/paranoid-mode proof in the production-artifact test
registry. Roadmap items in `plans/` are not guarantees until they appear in the register
and pass `pnpm run check:security-guarantee`.

The JSON block is the normative guarantee ledger. Prose in this file may explain the
ledger, but it must not add a broader guarantee outside the block.

```json security-guarantees
{
  "schema": "kovo.security.guarantees/v1",
  "source": "plans/fundamental-fixes-followup-3.md DEC-M / Phase 6.2",
  "threatModel": {
    "inScope": [
      "An app author can write arbitrary TypeScript, JSX, and raw SQL escape-hatch code inside a Kovo app.",
      "Static classifiers can be incomplete, disabled under KOVO_PARANOID=1, or wrong about source shape.",
      "Values returned by framework-managed database reads can reach framework wire, header, redirect, static export, logging, and error-reporting paths unless runtime chokes refuse them."
    ],
    "assumptions": [
      "Framework packages are installed from trusted Kovo artifacts and module-private symbols are not modified by the JavaScript engine or loader.",
      "Guarantees apply to framework-owned data, rendering, and egress paths that route through the enrolled Kovo runtime chokes.",
      "A guarantee is only current when the referenced TCB entries and proof claim IDs pass the mechanical checks."
    ]
  },
  "guarantees": [
    {
      "id": "pglite-secret-column-reader-role-test-floor",
      "statement": "In Kovo's PGlite-backed Postgres-role test posture for a KOVO_PARANOID production build, framework query reads run as the least-privilege reader role: declared public columns remain readable, while direct, raw-SQL, computed, function-backed, and whole-table reads that require declared secret columns are denied before a row reaches JavaScript. This proof does not claim an external-Postgres execution of the same secret-column fixture.",
      "tcbChokes": [
        "server.postgres-runtime.capability-closure-audit",
        "server.postgres-runtime.request-scoped-db",
        "server.postgres-runtime.pglite-request-scoped-db",
        "server.managed-db.postgres-scoped-client"
      ],
      "runtimeProofs": ["postgres-reader-role-secret-grant-floor"]
    },
    {
      "id": "pglite-secret-view-reader-role-test-floor",
      "statement": "In Kovo's PGlite-backed Postgres-role test posture for a KOVO_PARANOID production build, a security-invoker view cannot restore reader access to an underlying declared secret column; the reader-role query is denied before a row reaches JavaScript. This proof does not claim an external-Postgres execution of the same secret-view fixture.",
      "tcbChokes": [
        "server.postgres-runtime.capability-closure-audit",
        "server.postgres-runtime.reachable-view-audit",
        "server.postgres-runtime.request-scoped-db",
        "server.postgres-runtime.pglite-request-scoped-db",
        "server.managed-db.postgres-scoped-client"
      ],
      "runtimeProofs": ["postgres-reader-role-secret-view-floor"]
    },
    {
      "id": "explicit-secret-query-wire-egress",
      "statement": "In a KOVO_PARANOID production artifact, a framework Secret value created with the validating secret constructor is refused at Kovo query-wire egress; an explicitly audited trusted reveal is accepted.",
      "tcbChokes": [
        "core.secret.poison-box",
        "core.secret.secret",
        "core.secret.is-secret",
        "core.secret.reveal-secret",
        "server.secret-egress.assert-no-secret",
        "server.response-posture.emit-to-wire"
      ],
      "runtimeProofs": [
        "runtime-secret-explicit-box-egress",
        "runtime-secret-audited-reveal-acceptance"
      ]
    }
  ],
  "nonGoals": [
    "Kovo does not sandbox an app author from their own server code, filesystem access, child processes, or arbitrary network calls.",
    "Kovo does not claim timing-side-channel resistance except for the documented constant-time comparison helpers on runtime poison boxes.",
    "Kovo does not guarantee availability or denial-of-service resistance.",
    "The Postgres engine-denial proofs do not claim that denied database values were boxed at Kovo query-wire egress; Postgres refuses those reads before a secret row reaches JavaScript.",
    "The explicit Secret egress guarantee begins at a framework-owned Secret value and does not claim that arbitrary app strings are automatically runtime-tainted as secrets.",
    "Kovo does not yet claim that every database reader handle is engine-enforced read-only or that every declared-table write is engine-enforced; those remain Phase 1 guarantees until their paranoid-mode proofs are enrolled.",
    "Kovo does not yet claim complete contextual renderer default-deny coverage for every executable render position; that remains a Phase 3 guarantee until its paranoid-mode proofs are enrolled.",
    "Static diagnostics are defense-in-depth and author feedback. The guarantees above do not depend on static classifiers being complete."
  ]
}
```

## Current Guarantee Shape

Kovo's current published confidentiality guarantees have two distinct floors. Postgres
secret-column and security-invoker-view shapes are denied at the database engine under
the least-privilege reader role in the PGlite-backed test posture. Those two guarantees
are deliberately not external-Postgres execution claims. Separately, an explicit
runtime `Secret` is refused at the framework query-wire unless it passes through the
audited reveal path. The production-artifact proofs keep those claims separate so an
engine denial cannot be misreported as runtime value boxing.

Broader plan language such as "secure by construction", "one choke per property", or
"runtime chokes close the class" is architectural direction unless and until a precise
invariant appears in the JSON ledger with TCB entries and paranoid/runtime proof IDs.

## Reporting

Please report suspected Kovo framework security issues privately to the maintainers. Do
not include live secrets, credentials, production customer data, or exploit payloads that
target third-party systems.
