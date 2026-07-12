# Security Bug Ledger (`bugz-28`)

**Date:** 2026-07-11

**Scope:** Findings from the adversarial remediation pass run after `bugz-27` began landing. Each
item survived an executable exploit-shaped reproduction plus an independent source/test cross-check.
This is an active closure ledger; `SPEC.md` remains normative.

## Severity summary

| Severity | Count | Items |
| -------- | ----: | ----- |
| Critical |     3 | C1-C3 |
| High     |     6 | H1-H6 |
| Medium   |     4 | M1-M4 |

## Critical

- [ ] **C1 - A late `Array.prototype.map` override can mint an authenticated raw-SQL recipe.**
      `packages/core/src/internal/sql-safety.ts`
  - A selective override replaced Kovo's private pinned chunks with `DELETE ...`; the managed SQL
    snapshot returned `ok: true` with attacker SQL and no values.
  - **Acceptance:** construction and rendering must traverse dense own-data entries through
    boot-pinned controls, never app-mutable array iterators/prototypes; the real managed execution
    path must retain the original parameterized statement under hostile import order and late poison.

- [ ] **C2 - Mutable egress classification intrinsics can waive private-network SSRF policy.**
      `packages/server/src/{egress,egress-undici}.ts`
  - With the default empty policy, a selective late `Array.prototype.some` override made
    `evaluateEgress` admit `127.0.0.1`; adjacent mutable host-normalization operations can classify
    different bytes than the per-hop transport ultimately dials.
  - **Acceptance:** policy resolution, IP/hostname parsing, CIDR matching, DNS answer traversal, and
    every Undici redirect/connect hop use boot-pinned, semantically checked controls and bind the
    classified host bytes to the actual dial; real-fetch poison regressions must keep private and
    metadata destinations blocked.

- [ ] **C3 - Mutable path-containment prototypes escape the framework output filesystem root.**
      `packages/core/src/{storage,internal/filesystem}.ts`
  - Selective late `String.prototype.startsWith` and `Array.prototype.includes` overrides made the
    real output boundary write `../outside/escaped.txt` outside its pinned root; storage key
    normalization uses adjacent mutable segment controls.
  - **Acceptance:** logical-key parsing, relative-path rejection, and every read/write/copy/rename/
    delete containment decision use boot-pinned, semantically checked operations and exact path bytes;
    a real outside sentinel must remain unchanged under hostile import order and late poison.

## High

- [ ] **H1 - Mutable String/Array/RegExp prototypes bypass server and browser output chokes.**
      `packages/server/src/{html,renderable,route}.ts`,
      `packages/browser/src/security-output.ts`, `packages/core/src/internal/sink-policy.ts`
  - Independent proofs made an array child and scalar emit raw `<img onerror>`, admitted a dynamic
    `x><img ...` attribute name, and classified an original `javascript:` URL as allowed.
  - **Acceptance:** escape, attribute-name, URL/CSS, rich-HTML, and nested render controls use
    semantically checked boot-pinned operations; hostile import-order and late-poison regressions
    fail closed at real output sinks.

- [ ] **H2 - PostgreSQL live posture can be fooled by public/temp privilege-oracle shadows.**
      `packages/server/src/postgres-runtime.ts`
  - A runtime login with real schema/database creation authority installed shadow
    `has_schema_privilege`/`has_database_privilege` functions and obtained a green posture report.
  - **Acceptance:** one catalog-first, temp-last, repeatable-read read-only transaction owns every
    posture fact, with qualified catalog/oracle references and query uncertainty failing closed.

- [ ] **H3 - PostgreSQL app DDL executes attacker shadows with provisioner authority.**
      `packages/server/src/postgres-runtime.ts`
  - A pre-existing writer-created `public.lower(text)` intercepted reviewed seed and migration SQL
    when provisioning explicitly placed `public` before `pg_catalog`.
  - **Acceptance:** catalog lookup stays first while unqualified app object creation still targets
    `public`; both seed and migration exploits must execute the genuine built-in.

- [ ] **H4 - No-login PostgreSQL role closure can retain role-administration authority.**
      `packages/server/src/postgres-runtime.ts`
  - Reader/writer closure admitted `CREATEROLE`, predefined privileged roles, and `ADMIN OPTION`
    whenever no runtime login role was configured.
  - **Acceptance:** the complete reader/writer/runtime membership closure is always audited before
    ACL mutation; any elevated attribute, predefined role, privileged framework role, or admin edge
    aborts and rolls back provisioning.

- [ ] **H5 - Post-closure schema and crypto method mutation can replace validation or proof bytes.**
      `packages/server/src/{app-snapshot,schema,app-document,confidential-at-rest,mutation-wire,replay}.ts`,
      `packages/core/src/verifier.ts`
  - Retained custom/composite schema methods could become permissive after `createApp`; adjacent
    late crypto/subtle/cipher method poison could forge output/attestation proofs or observe secrets.
  - **Acceptance:** app declarations snapshot schema topology and executable identities; every
    cryptographic proof/encryption operation uses boot-pinned, semantically checked methods and
    private byte snapshots with post-import hostile regressions.

- [ ] **H6 - Mutable RegExp/String controls reopen ambiguous reserved Node request targets.**
      `packages/server/src/{node,build}.ts`
  - A selective late `RegExp.prototype.test` override disabled only the percent-encoded separator
    detector and admitted `/_m/a/%2f/b` through the live Node conversion boundary; the generated
    Node/Vercel copies use the same mutable parsing controls.
  - **Acceptance:** live and emitted target lexing use boot-pinned, semantically checked operations;
    encoded separators, dot segments, slash/backslash aliases, and absolute forms stay rejected under
    hostile import order and late poison while canonical targets retain their configured authority.

## Medium

- [ ] **M1 - The CSRF Origin floor dispatches through mutable Request/String/URL controls.**
      `packages/server/src/csrf.ts`
  - Replacing `globalThis.Request` after import or selectively mapping `POST` to `GET` through
    `String.prototype.toUpperCase` made a real cross-origin unsafe request skip the Origin floor.
  - **Acceptance:** pin and self-test Request identity, URL parsing, method classification, and
    trusted-origin traversal; both late-poison proofs must reject.

- [ ] **M2 - PostgreSQL provisioning rewrites undeclared external-role ACLs instead of rolling back.**
      `packages/server/src/postgres-runtime.ts`
  - An unsafe reachable shared role was silently stripped of grants, mutating authority outside the
    declared Kovo topology.
  - **Acceptance:** mutate only `PUBLIC` and configured roles; any residual external authority must
    fail before revocation and roll back without changing the external role.

- [x] **M3 - Unicode-escaped PostgreSQL identifiers bypass the scoped-client session-control
      scanner.** `packages/server/src/managed-db.ts`
  - `U&"set_con\0066ig"` resolved to `set_config`, replaced the transaction principal, and updated
    another principal's RLS row when the routine ACL was deliberately permissive; default Kovo ACL
    revocation remains a separate floor.
  - **Evidence:** focused fake and real-PGlite principal-swap regressions pass; the scanner rejects
    the entire Unicode-escaped identifier syntax, including schema-qualified, six-digit, custom
    `UESCAPE`, and comment-adjacent variants, while benign non-ASCII identifiers retain coverage.

- [ ] **M4 - Mutable diagnostic String/Array controls re-expose credentials and log injection.**
      `packages/server/src/{diagnostics,logging}.ts` and generated Node copies
  - Selective late `String.prototype.replaceAll` kept a full URL with userinfo, query secrets, and
    fragment in diagnostic text; selective `String.prototype.replace` preserved an attacker newline
    in the log-neutralization choke.
  - **Acceptance:** secret discovery, URL scrubbing, replacement, traversal, and control-character
    neutralization use boot-pinned, semantically checked operations in live and emitted paths; hostile
    import-order and late-poison tests keep credentials absent and each event on one line.

## Latest verification

The first remediation pass is intentionally non-zero. PostgreSQL H2-H4/M2 are integrated with a
97-test matrix and focused live/exploit evidence; C1/H1/H5-H6/M1 remain under active
runtime/compiler checkpoints. A complete fresh sweep of the final integrated tree is still required.
