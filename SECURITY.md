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
    },
    {
      "id": "owner-scope-managed-db-read-write",
      "statement": "In a KOVO_PARANOID production artifact against a real Postgres engine, a framework-managed database read or write is confined to the request principal's owner scope by the engine row-level-security floor: a cross-owner read returns no rows and a cross-owner write is refused, unless the app opens an audited escape (crossOwnerRead / actAs / declarePublicRead).",
      "tcbChokes": [
        "server.postgres-runtime.request-scoped-db",
        "server.postgres-runtime.pglite-request-scoped-db",
        "server.postgres-runtime.node-request-scoped-db"
      ],
      "runtimeProofs": [
        "phase-5-postgres-paranoid-dogfood-read-acceptance",
        "phase-5-postgres-paranoid-dogfood-write-acceptance"
      ]
    },
    {
      "id": "csrf-request-authenticity",
      "statement": "In a KOVO_PARANOID production artifact, a default-CSRF state-changing mutation refuses an unsafe request that is cross-origin, is missing its session-bound CSRF token, or is missing an Origin header: validateCsrfToken applies the Origin floor and the synchronizer-token check before the handler runs, and the handler executes only for a same-origin request that carries a valid token.",
      "tcbChokes": ["server.csrf.request-authenticity-verifier"],
      "runtimeProofs": ["csrf-cross-origin-refusal-prod-artifact"]
    }
  ],
  "nonGoals": [
    "Kovo does not sandbox an app author from their own server code, filesystem access, child processes, or arbitrary network calls.",
    "Kovo does not claim timing-side-channel resistance except for the documented constant-time comparison helpers on runtime poison boxes.",
    "Kovo does not guarantee availability or denial-of-service resistance.",
    "Beyond the enrolled owner-scope guarantee above, Kovo does not yet claim that every database reader handle is engine-enforced read-only, or that every declared-table write shape is engine-enforced against every non-owner-scope class; those remain Phase 1 guarantees until their paranoid-mode proofs are enrolled.",
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

## Two claim surfaces (read this before reporting)

Kovo makes security claims at two levels of confidence. A report is judged against the one
it targets:

1. **Formal guarantees** — the JSON register above. Each is backed by an enrolled TCB choke
   in `security/TCB.md` and a `KOVO_PARANOID` production-artifact runtime proof, and passes
   `pnpm run check:security-guarantee`. Today these cover **secret-value confidentiality at
   the query-wire egress**, **owner-scope confinement of framework-managed reads and writes**
   (cross-owner access refused by the engine RLS floor), and **request authenticity** (a
   default-CSRF mutation refuses a cross-origin, missing-token, or missing-Origin unsafe
   request). These are the strongest claims; a verified break is the most valuable finding.
2. **Hardened controls** — the coverage map in `docs/security-threat-matrix.md`. Every
   {surface × threat} cell names a control with its test/gate (session integrity, wire-
   injection defenses, the auth-adapter non-egress proof, the escape-hatch visibility
   guarantee, …). These are tested and gated but are **controls, not formal paranoid
   guarantees** unless they also appear in the register above.

The threat matrix has no open cell as of 2026-07-07, but "no open cell" is a self-graded
claim. This bounty exists to make it a verified one.

## Security bug bounty

We pay for **verified counterexamples to a stated claim**. The first **3** reporters with a
verified, distinct finding receive **$500 USD** each.

A finding is **verified** when we reproduce it. It must be:

- **Reproducible** against the latest published release,
- in a **default-configured** app (`create-kovo` defaults; no escape hatches enabled), and
- a violation of a **formal guarantee** (tier 1) or a **hardened control's stated behavior**
  (tier 2) — name the guarantee id, matrix cell, or `KV###` code.

### In scope

- **Cross-owner data access (IDOR/BOLA)** — reading or writing another owner's row through the
  framework-managed database API. Engine RLS is the sole owner-scope door. **(Tier-1 formal
  guarantee: `owner-scope-managed-db-read-write`.)**
- **Secret disclosure** — a value from a schema-declared secret column (or a raw-SQL read of a
  secret table/view) reaching the client wire, a header/redirect, a log, or an error, through
  a default path. **(Tier-1 formal guarantee.)**
- **Injection** — XSS (a value reaching an HTML/attribute/URL-scheme/JS position unescaped by
  default), SQL injection through the managed query API, header/cookie/CRLF injection, open
  redirect, or SSRF past the egress floor.
- **Request forgery (CSRF)** — a state-changing mutation executed cross-origin, or without a
  valid session-bound CSRF token, or without an Origin header, in a default-CSRF app.
  **(Tier-1 formal guarantee: `csrf-request-authenticity`.)**
- **Session / principal integrity** — forging, tampering with, or replaying a session to act
  as another principal, or principal confusion at dispatch.
- **Auth-adapter non-egress** — a request-reachable code path that reads an _unboxed_
  cross-user credential.
- **Compiler trust boundary** — app-authored untrusted input reaching an executable position
  in generated code.
- **Escape-hatch visibility** — an app-authored escape (`trustedSql`, `unsafeRegex`,
  `crossOwnerRead`, `trustedAssign`, `declarePublicRelation`, `rawRead`, `actAs`, …) that does
  **not** appear in `kovo explain`. The guarantee is that every intentional hole is visible.

### Out of scope

- **Dependency internals.** Better Auth (password hashing, token entropy/single-use, session
  compare), Drizzle, node-pg, PGlite, and argon2 are declared _trusted dependency surfaces_
  (`security/TCB.md`), not Kovo code. A bug in Better Auth's reset-token entropy is a Better
  Auth report, not a Kovo one.
- **Denial of service / availability / resource exhaustion.** Rate limits, connection-pool
  sizing, query cost, and `statement_timeout` are the deploy's responsibility; Kovo ships a
  default load-shed posture but makes **no availability guarantee** (see `nonGoals`). A
  _forced, un-mitigable framework footgun_ would be in scope; the known ones are closed.
- **Misuse of an audited escape hatch.** `trustedSql`, `unsafeRegex`, `crossOwnerRead`,
  `csrf: false`, `declarePublicRelation`, `rawRead`, `actAs`, `unsafeCookie`,
  `egressAllowInternal`, `acceptUnverified`, `trustedHtml`/`trustedUrl` are documented,
  `kovo explain`-visible holes the author opted into. Using one unsafely is not a framework
  bug. (An escape that is _invisible_ to `kovo explain` **is** in scope — see above.)
- **Deploy / operator responsibilities** — TLS, secret storage/rotation, per-tenant
  log-stream isolation, running dev-mode PGlite in production, and L3/L4 DDoS.
- **App-author server code.** Kovo does not sandbox an author from their own server code,
  filesystem, child processes, or network calls (see `nonGoals`).
- **Non-default reproductions** — anything requiring a modified framework, a non-default
  config, or `KOVO_PARANOID` disabled; missing best-practice headers without a demonstrated
  exploit; self-XSS; automated-scanner output without a working proof-of-concept; spam,
  social-engineering, or physical attacks.

### Rewards & eligibility

- **$500 USD** each to the **first 3** reporters with a verified, distinct finding.
- **Distinct** = a different root cause. Duplicates of the same root cause are credited to the
  first reporter only. One reward per root cause.
- We decide severity and validity in good faith. A finding that is real but explicitly listed
  as out of scope or as a known issue is not eligible.
- **Known issues are not eligible.** As of this writing there are none tracked; any that arise
  will be listed here before they disqualify a report.

## Reporting

Report privately to **security@kovojs.dev** (confirm the current address on the project
README). Include: the release/commit, a minimal reproduction (ideally a `create-kovo` app +
the steps), the claim it violates (guarantee id / matrix cell / `KV###`), and the observed vs.
expected behavior.

Do **not** include live secrets, credentials, or production customer data, and do **not** run
exploits against systems or deployments you do not own — only your own local or self-hosted
app.

## Coordinated disclosure & safe harbor

- We aim to acknowledge within **3 business days** and to ship a fix or a decision within
  **90 days**; please hold public disclosure until a fix is released or the window elapses.
- **Safe harbor:** good-faith research within this policy — testing only your own app, no data
  destruction, no privacy violation, no service degradation — will not be pursued as a policy
  violation. This is not legal advice and does not authorize testing third-party services.
