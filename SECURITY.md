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
      "id": "secret-column-query-wire-egress",
      "statement": "In a KOVO_PARANOID production artifact, a runtime value boxed from a schema-declared secret column is refused before it crosses the Kovo query-wire egress unless the app explicitly reveals or redacts it before egress.",
      "tcbChokes": [
        "core.secret.poison-box",
        "core.secret.secret",
        "core.secret.is-secret",
        "core.secret.reveal-secret",
        "server.secret-egress.assert-no-secret",
        "server.response-posture.emit-to-wire"
      ],
      "runtimeProofs": ["runtime-secret-db-read-boundary"]
    },
    {
      "id": "secret-raw-sql-query-wire-egress",
      "statement": "In a KOVO_PARANOID production artifact, a runtime value boxed from a raw-SQL read of a secret table is refused before it crosses the Kovo query-wire egress unless the app explicitly reveals or redacts it before egress.",
      "tcbChokes": [
        "core.secret.poison-box",
        "core.secret.secret",
        "core.secret.is-secret",
        "core.secret.reveal-secret",
        "server.secret-egress.assert-no-secret",
        "server.response-posture.emit-to-wire"
      ],
      "runtimeProofs": ["runtime-secret-raw-sql-read-boundary"]
    },
    {
      "id": "secret-view-query-wire-egress",
      "statement": "In a KOVO_PARANOID production artifact, a runtime Secret read through a Drizzle view is refused at Kovo query-wire egress unless the app explicitly reveals or redacts it before egress.",
      "tcbChokes": [
        "core.secret.poison-box",
        "core.secret.secret",
        "core.secret.is-secret",
        "core.secret.reveal-secret",
        "server.secret-egress.assert-no-secret",
        "server.response-posture.emit-to-wire"
      ],
      "runtimeProofs": ["runtime-secret-view-egress"]
    }
  ],
  "nonGoals": [
    "Kovo does not sandbox an app author from their own server code, filesystem access, child processes, or arbitrary network calls.",
    "Kovo does not claim timing-side-channel resistance except for the documented constant-time comparison helpers on runtime poison boxes.",
    "Kovo does not guarantee availability or denial-of-service resistance.",
    "Kovo does not yet claim that every database reader handle is engine-enforced read-only or that every declared-table write is engine-enforced; those remain Phase 1 guarantees until their paranoid-mode proofs are enrolled.",
    "Kovo does not yet claim complete contextual renderer default-deny coverage for every executable render position; that remains a Phase 3 guarantee until its paranoid-mode proofs are enrolled.",
    "Static diagnostics are defense-in-depth and author feedback. The guarantees above do not depend on static classifiers being complete."
  ]
}
```

## Current Guarantee Shape

Kovo's current published guarantee is confidentiality at the framework query-wire egress
for runtime `Secret` values proven in paranoid production artifacts. The load-bearing
runtime chokes are the non-coercible `Secret` box, the `isSecret` guard, the audited
`revealSecret` path, the secret-egress refusal helper, and `emitToWire`.

Broader plan language such as "secure by construction", "one choke per property", or
"runtime chokes close the class" is architectural direction unless and until a precise
invariant appears in the JSON ledger with TCB entries and paranoid/runtime proof IDs.

## Reporting

Please report suspected Kovo framework security issues privately to the maintainers. Do
not include live secrets, credentials, production customer data, or exploit payloads that
target third-party systems.
