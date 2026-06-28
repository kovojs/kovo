# Bugz 9

Created 2026-06-28. Source of truth remains `SPEC.md`; this ledger captures
security/soundness defects found during the third exhaustive Kovo dogfood pass
after `plans/papercuts-7.md` and `plans/bugz-8.md` were fixed.

## Scope

Dogfooded linked local apps under `/Users/mini/kovo-dogfood-20260628d`:
`base-pristine`, `auth-session-cache`, `endpoints-webhooks-agent`,
`registry-ui-catalog`, `storage-multi-capability`, and
`streaming-deferred-mpa`.

The fresh baseline passed `pnpm run check`, `pnpm run test`, `pnpm run build:prod`,
and a dev HTTP smoke. This bug ledger carries findings where Kovo's proof or
security floor is materially false or missing; app-author friction is filed in
`plans/papercuts-8.md`.

## Issues

### A. Response Security Floors

- [ ] **Route and no-JS mutation failure responses bypass the per-principal cache/security floor.** (high, security/soundness; found by `auth-session-cache`)
  - Observed behavior: anonymous guarded route redirects and route
    `guards.rateLimit` 429 responses ship only `Vary: Origin` plus minimal
    headers, and no-JS mutation failure pages ship no cache-control or
    cookie-varying cache posture; equivalent guarded documents, guarded 403s, guarded `/_q/` failures,
    and enhanced mutation failures include the no-store/security floor.
  - Root cause: `packages/server/src/guards.ts:720-723` returns
    unauthenticated route redirects with only `Location`,
    `packages/server/src/route.ts:1134-1143` returns rate-limit fallback bodies
    with only `Content-Type` / `Retry-After`, `packages/server/src/mutation.ts:855-861`
    returns no-JS CSRF failure pages with only `Content-Type`, and
    `packages/server/src/document-core.ts:340-355` passes non-200 route responses
    through unchanged.
  - Why it matters: SPEC §6.6 / §9.5 require session- and principal-dependent
    HTML/error outcomes to carry the cache/security floor. Missing `no-store` and
    `Vary: Cookie` on non-OK route/mutation documents can make personalized auth
    state cacheable or replayable by intermediaries or browser state.
  - Repro evidence: in `/Users/mini/kovo-dogfood-20260628d/auth-session-cache`,
    `curl -i http://localhost:5293/dogfood/admin` returned `303` with
    `Vary: Origin` and no `Cache-Control`; a second
    `curl -i http://localhost:5293/dogfood/rate-limit` returned `429` with
    `Vary: Origin` and no `Cache-Control` / CSP; no-JS
    `POST /_m/auth/sign-in` with bad CSRF returned `422` HTML with no
    `Cache-Control`.
  - Acceptance: all route and no-JS mutation non-OK HTML/auth/cache-sensitive
    responses are stamped with the same no-store, `Vary: Cookie`, and document
    security baseline as equivalent guarded documents and enhanced failures.

### B. Audit Proof Surface

- [ ] **Webhook `recordChange()` domains are omitted from `kovo explain --endpoints` writes.** (med, soundness; found by `endpoints-webhooks-agent`)
  - Observed behavior: a webhook handler calls `context.recordChange(...)` for
    the `auditEvent` domain; runtime responses include `kovo-changes` for
    `audit-event`, but the built endpoint audit prints `writes=-` for
    `/webhooks/audit`.
  - Root cause: `packages/cli/src/commands/build-export.ts:753` serializes
    endpoint facts without populating `EndpointExplain.writes` from webhook
    `recordChange` / declared write facts, while `packages/cli/src/graph-output.ts`
    faithfully renders the missing field.
  - Why it matters: SPEC §11.4 makes `kovo explain --endpoints` the stable
    machine-ingress audit. A webhook that records domain changes but audits as
    writing nothing creates a false negative in review and downstream tooling.
  - Repro evidence: in
    `/Users/mini/kovo-dogfood-20260628d/endpoints-webhooks-agent`,
    `pnpm exec kovo explain --endpoints dist/.kovo/graph.json` prints
    `ENDPOINT /webhooks/audit ... writes=-`; the same app's webhook curl returned
    `kovo-changes: [{"domain":"audit-event","keys":["evt_curl_1"]}]`.
  - Acceptance: endpoint graph/export facts include webhook write domains proven
    by first-party `recordChange` declarations, and `kovo explain --endpoints`
    prints those domains.

## Refuted / Not Carried Forward

- JSON-body endpoint CSRF is not a regression of `plans/bugz-3.md` L15: a valid
  anonymous cookie-bound token in a JSON body plus same-origin `Origin` returned
  200 in `endpoints-webhooks-agent`.
- CSRF-exempt endpoint cookie stripping is not a regression of `plans/bugz-3.md`
  L16 on the tested path: an HMAC machine endpoint received `Cookie: sid=victim`
  and the handler observed `cookie: null`.
- Webhook replay did not re-execute the handler: a duplicate delivery replayed
  the stored response and idempotency header.
- The bfcache reload defense from `plans/bugz-3.md` M12 appears fixed in the
  current runtime: the emitted loader contains the `pageshow`/`event.persisted`
  reload hook for session documents.

## Latest Verification

- 2026-06-28 in `/Users/mini/kovo`: `pnpm run check` passed after the
  `plans/papercuts-7.md` / `plans/bugz-8.md` fixes were merged.
- 2026-06-28 in `/Users/mini/kovo-dogfood-20260628d/base-pristine`:
  `pnpm run check`, `pnpm run test`, `pnpm run build:prod`, and a dev HTTP smoke
  passed.
- 2026-06-28 first-hand repros from the main agent confirmed the missing route
  non-OK cache/security headers and the webhook endpoint audit `writes=-`
  false negative.
