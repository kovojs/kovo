# Bugz 7

Created 2026-06-28. Source of truth remains `SPEC.md`; this ledger captures a
confirmed security-floor defect found during exhaustive Kovo dogfooding on
`main` at `f5c0b0a36`.

## Scope

Dogfooded a linked SQLite app at
`/Users/mini/kovo-dogfood-20260628/security-egress`, then verified the core
transport behavior with an app-local Vitest probe. The probe opened a raw
`node:http` keep-alive socket before installing Kovo's egress floor with
`createApp({ egress: { allowInternal: [] } })`, then compared a fresh localhost
dial with a reused pre-floor socket.

## Issues

### A. Outbound Egress Floor

- [ ] **Raw `node:http` keep-alive sockets opened before the egress floor remain usable for blocked private-network destinations.** (high, security; found by `security-egress`)
  - Observed behavior: after installing the empty-allowlist egress floor, a fresh raw `node:http` request to the local test server is blocked, but a request reusing the socket opened before `createApp()` succeeds with `reusedSocket: true` and `status: 200`.
  - Root cause direction: `packages/server/src/egress.ts:507` gates raw `node:http` at `net.Socket.prototype.connect`, and `packages/server/src/egress-undici.ts:20` documents that pooled reuse skips `net.connect`; the undici per-request layer intentionally covers `fetch`, but it does not see raw `node:http`/`node:https`.
  - Why it matters: SPEC §6.6 requires a deny floor for private-network egress. An app or dependency that opens a keep-alive raw HTTP socket before Kovo bootstrap can continue using it after the floor is installed.
  - Evidence: `pnpm exec vitest run src/egress-prewarm.verify.test.ts` in `/Users/mini/kovo-dogfood-20260628/security-egress` passed; the test asserts `fresh` matches `{ ok: false, blocked: true }` while `reused` matches `{ ok: true, reusedSocket: true, status: 200 }`.
  - Acceptance: installing or re-installing the egress floor must close, poison, or otherwise deny pre-existing raw HTTP(S) sockets that target disallowed private-network destinations, or fail loudly before serving if such sockets cannot be controlled.

## Refuted / Not Carried Forward

- `fetch`/undici pooled reuse is not this bug: the current undici dispatcher layer is designed to gate `fetch` per request.
- Fresh raw `node:http` dials are not this bug: the verifier proves they are blocked under `allowInternal: []`.

## Latest Verification

- `pnpm exec vitest run src/egress-prewarm.verify.test.ts` in `/Users/mini/kovo-dogfood-20260628/security-egress`
