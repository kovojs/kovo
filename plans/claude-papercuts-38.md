# Round-19 Papercuts 38

Created 2026-07-06. Source of truth remains `SPEC.md`. Over-block / proof-completeness / refuted-but-notable items from
the Round-19 security dogfood (verify followup-15 + hunt). Security fail-opens are in `plans/claude-bugz-40.md`.
Isolated worktree at `b805b5c88`; `/Users/mini/kovo` untouched. Line numbers cite that HEAD.

## Issues

- [ ] **P1 — `frameworkEgressFetch` blocks an explicitly ALLOWLISTED public hostname, because it classifies the raw
      hostname STRING (which fails closed to `special-use`) instead of a resolved IP. `allowDestinations:
['https://api.stripe.com']` passes the destination-allowlist check but is then denied by `classifyIp('api.stripe
.com') = special-use` before `globalThis.fetch` is called — so hostname egress to any allowlisted external API is
      broken.** (MEDIUM, framework/functional-over-block; `egress-hostname-overblock` EGRESS-3; unanimous REAL;
      fail-closed but a real functional regression)
  - Observed: `frameworkEgressFetch` sets `resolvedIp = literalIp ?? host` (`egress.ts:779`); for a hostname `literalIp`
    is null so `resolvedIp` = the hostname string. `evaluateEgress` passes the allowlist check but runs
    `classifyIp(resolvedIp)` (`:687`); a non-IP hostname fails closed to `special-use` ≠ `public`, so it falls to the
    `allowInternal` branch, finds no `host:port` entry, and returns `EgressBlockedError` (`reason: private-network`).
  - Why it matters: this is the task-runner default fetch (`task-runner.ts:282`), so agent-tool / webhook outbound to
    any external API BY HOSTNAME is blocked; only IP-literal destinations (or a hostname also added to `allowInternal`)
    pass. The documented `allowDestinations: ['https://api.stripe.com']` contract is unusable for hostnames. It is
    fail-CLOSED (safe, not an escape) but breaks legitimate egress — verify whether normal operation resolves DNS first
    (supplying a real `resolvedIp`) or genuinely classifies the hostname string.
  - Acceptance: a hostname destination that matches `allowDestinations` is permitted (resolve-then-pin, or treat an
    allowlist match as authoritative for a hostname whose resolved IP then still passes the private-address floor); the
    `allowDestinations` hostname contract works end-to-end. Add a test that an allowlisted PUBLIC hostname fetch
    succeeds through the floor.

- [ ] **P2 — The DEC-E corpus gate marker is decoupled from the pinned assertions: `check:security-classifier-corpus`
      can pass on a marker/existence check without re-proving that each classifier still rejects/classifies every corpus
      entry, so corpus EROSION (or a regression the corpus doesn't cover) is invisible.** (LOW, framework/checker-
      completeness; `corpus-gate-teeth` V4-1; REFUTED as a fail-open but a real hygiene gap — the checker is itself a
      C11/C13 subset)
  - Observed: the round-19 B1 (`((a|a))+`) regression stayed green through the corpus gate because the ReDoS corpus has
    no wrapped-overlapping-alternation entry AND the gate's assertion coverage is narrower than "re-run every classifier
    over every pinned input and assert the verdict." Both verifiers REFUTED it as a fail-open (the gate does run some
    assertions), but flagged that its completeness is not itself proven — the same "prove the checker is a superset"
    (C13) problem, now applied to the checker.
  - Acceptance: the gate re-executes each in-scope classifier over its full corpus and asserts every verdict (not a
    marker string / file-existence check); a mutation test (re-introduce B1/the round-18 nested-group case) must turn it
    RED; the corpus is append-only and each round's confirmed fail-open is added. Extend the ReDoS corpus to gate-2
    (overlapping-alternatives) forms and the egress corpus to ISATAP + loose-IPv4 forms.

## Refuted / Not Carried Forward (positive signal)

- **V3-1 (auth: last-segment-only lexicon misses a non-final credential noun) — REFUTED.** The classifier is a
  documented best-effort default-secret net with an author override (followup-15 O2); a non-lexically-positioned
  credential name is the acknowledged bounded ceiling, not a reachable framework-owned leak. (Pairs with
  `papercuts-37` P2.)
- **V3-2 (auth: over-block of `code`/`key`-suffixed benign columns) — REFUTED.** Over-block is fail-closed (blocks a
  wire projection that was readable); the author annotates it readable. Correct trade per the stronger-default bias.
- **C12-B1 (`forwardSetCookie` emits app `SameSite=None` without pairing `Secure`) — REFUTED.** `serializeCookie`'s own
  invariant covers the framework-owned cookies; the flagged path is an app-supplied cookie the app owns. Hygiene note:
  consider warning when an app sets `SameSite=None` without `Secure`.
- **C12-C1 (`sql.identifier` admits `.` as a qualified-name separator but the reconstruct quotes it as a single ident)
  — REFUTED.** Not reachable as an injection — the reconstruct quotes the whole string, so a `.` becomes a literal
  identifier character, not a schema separator; no cross-table reach. Hygiene note only.

## Latest Verification

- P1 (hostname over-block) reproduced by the workflow against the real `frameworkEgressFetch` with
  `allowDestinations:['https://api.stripe.com']` → `EgressBlockedError`. P2 (corpus gate teeth) is the round-19 B1
  regression slipping the gate green. The refuted items are recorded for provenance / minor hardening. Throwaway probes
  under `/Users/mini/kovo-dogfood-round19-apps/`; `/Users/mini/kovo` untouched.
