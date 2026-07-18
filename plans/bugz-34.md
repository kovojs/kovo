# Security Bug Ledger (`bugz-34`)

<!-- kovo-security-ledger: transient -->

**Date:** 2026-07-18
**Status:** CLOSED — remediation complete; publication and required CI pending
**Baseline:** `e5f613be9f1bb1f1cfc568a53e88ee741b3a4ded`
**Lifecycle:** `closed-pending-publication`; archive by 2026-07-25 to
`plans/history/bugz-34.md` after the
verified closing tip is published and required CI is green.

**Scope:** The first fixed-charter remote Node-ingress convergence audit. Deliberately hostile
same-process code remains outside the app-level proof under SPEC §6.6.

## Severity summary

| Severity | Open | Closed |
| -------- | ---: | -----: |
| High     |    0 |      0 |
| Medium   |    0 |      1 |
| Low      |    0 |      0 |

## Medium

- [x] **M1 / threat-matrix M35 — A non-canonical HTTP authority crosses the Node-to-Fetch
      boundary as two app-visible identities.**
  - A real HTTP/2 peer can send `:authority: %65xample.com`. The live Node adapter accepts it,
    constructs `request.url === "http://example.com/"`, but preserves
    `request.headers.get("host") === "%65xample.com"`; generated Node/Vercel share the same
    validator and reconstruction shape. Authorization, origin, cache, or tenant policy can
    therefore consult different identities for one remote carrier.
  - **Reproduction:** the fixed-charter audit at `e5f613be9` sent the value through a real
    `node:http2` server/client and observed status 200 plus the split URL/Host JSON response.
  - **Required closure:** before Web `Request` construction, require one canonical serialized
    `host[:port]` identity and reject URL-normalizing spellings with 400 across live and emitted
    Node/Vercel adapters. Preserve canonical lower-case DNS with non-default ports and bracketed
    IPv6 controls, add a real-HTTP/2 regression and live/generated parity proof, enroll the closed
    verdict in C13, and make the SPEC §9.5 carrier rule explicit.
  - **Closure:** `766aa8c57` requires byte-identical URL serialization under both HTTP schemes
    before `Request` construction, preserving canonical lower-case DNS/non-default-port and
    bracketed-IPv6 controls while rejecting normalizing spellings. The live and generated
    adapters share the verdict, and SPEC §9.5 now makes authority identity normative.

## Latest verification

- Fixed audit charter and exact-SHA round: `security/security-convergence-audit-charter.json` and
  `security/security-convergence-audit-round-2026-07-18.json`; seeded canaries 2/2, R=1.
- Reproduction: `b92f2590f` failed on 1/1 real HTTP/2 request at audited SHA `e5f613be9`.
- Closure: focused real-wire/live and emitted Node/Vercel suites pass 6/6 and 2/2 respectively at
  `766aa8c57`; `node-fetch-authority-identity-closed` is enrolled in the 17-corpus C13 inventory.
