# Bugz 10

Created 2026-06-28. Source of truth remains `SPEC.md`; this ledger captures
security/soundness defects found during the fourth exhaustive Kovo dogfood pass
after `plans/bugz-9.md` and `plans/papercuts-9.md` were fixed.

## Scope

Dogfooded linked local apps under `/Users/mini/kovo-dogfood-20260628e`:
`base-pristine-fixed`, `auth-cache-response-floors`,
`storage-capability-files`, `streaming-query-deferred`,
`endpoints-webhooks-posture`, and `ui-registry-rich-composition`.

The fixed baseline passed first-run `pnpm run test`, `pnpm run check`,
`pnpm run build:prod`, and a dev HTTP smoke. This bug ledger carries findings
where Kovo's security floor or proof model is materially false; app-author
friction from the same pass is filed in `plans/papercuts-10.md`.

## Issues

### A. Auth Response Floors

- [x] **Unauthenticated guarded route redirects still bypass the auth cache floor.** (high, security/soundness; found by `auth-cache-response-floors`)
  - Observed behavior: anonymous `GET /dogfood/private` returns `303 Location:
/login?next=%2Fdogfood%2Fprivate` without `Cache-Control: private,
no-store` or `Vary: Cookie`; guarded query redirects and other non-OK
    failures now carry the expected floor.
  - Root cause: `packages/server/src/guards.ts:720` returns the unauthenticated
    redirect as a bare `blessRedirectResponse(...)`, and
    `packages/server/src/route.ts:1126-1132` returns that `authResponse`
    directly before the route non-OK stamping path. This is a residual/regression
    of the `plans/bugz-9.md` route failure floor fix.
  - Why it matters: SPEC §6.6 and §9.5 require auth/session-dependent outcomes
    to avoid principal cache bleed. A login redirect encodes the guarded URL and
    auth state, so intermediaries must not treat it as a reusable public redirect.
  - Repro evidence: in
    `/Users/mini/kovo-dogfood-20260628e/auth-cache-response-floors`,
    `curl -sS -D /tmp/kovo-auth-private.headers -o /tmp/kovo-auth-private.body
http://127.0.0.1:5173/dogfood/private` returned `HTTP/1.1 303 See Other`
    and `location: /login?next=%2Fdogfood%2Fprivate` with no `Cache-Control` or
    `Vary: Cookie`.
  - Acceptance: unauthenticated route redirects receive the same auth
    cache/security floor as guarded query redirects, including focused coverage
    for `renderHttpGuardFailureResponse` route integration.
  - Evidence: 2026-06-28 `pnpm exec vitest run
    packages/server/src/route-query-guards.test.ts
    packages/server/src/guards.test.ts packages/server/src/schema.test.ts
    packages/server/src/upload-sniff.test.ts` passed with guarded route
    redirect cache-floor coverage.

### B. Upload Type Enforcement

- [x] **`s.file().accept([...]).store()` accepts client-MIME lies instead of enforcing the server-sniffed allowlist.** (high, security/soundness; found by `storage-capability-files`)
  - Observed behavior: a mutation declared
    `s.file().accept(['text/plain']).store(...)`; uploading HTML/script bytes as
    multipart `type=text/plain` returned `303` and persisted the object. The
    stored-file sink later served it safely as `application/octet-stream`, but
    the validation allowlist was bypassed.
  - Root cause: `packages/server/src/schema.ts:536` calls `parseFileLike` before
    bytes are available, `packages/server/src/schema.ts:636-643` checks
    `accept` against `input.type`, and `packages/server/src/schema.ts:548-550`
    only uses the sniffed content type for stored metadata, not rejection.
  - Why it matters: SPEC §6.6 / §9.1 and the KV428 comments distinguish the safe
    `accept([...])` path from `accept.unverified(...)`. Apps relying on the safe
    path can persist disallowed active bytes when a client lies about MIME.
  - Repro evidence: in
    `/Users/mini/kovo-dogfood-20260628e/storage-capability-files`, posting
    `/tmp/kovo-evil.html` with multipart `filename=evil.html;type=text/plain`
    to `/_m/app/upload-file` returned `HTTP/1.1 303 See Other`; `GET
/api/files` then listed the stored `evil.html` record with size `26`.
  - Acceptance: async stored-file parsing rejects sniffed content types outside
    plain `accept([...])`; `accept.unverified(...)` remains the explicit audited
    client-MIME escape and is covered separately.
  - Evidence: 2026-06-28 `pnpm exec vitest run
    packages/server/src/route-query-guards.test.ts
    packages/server/src/guards.test.ts packages/server/src/schema.test.ts
    packages/server/src/upload-sniff.test.ts` passed with verified
    `accept([...]).store(...)` rejection and `accept.unverified(...)` escape
    coverage.

## Refuted / Not Carried Forward

- Guarded route 429, no-JS mutation 429, enhanced mutation 429, stale-session
  enhanced mutation, stale-session no-JS mutation, guarded query redirect, and
  custom error shells were rechecked in `auth-cache-response-floors` and were
  not carried forward.
- Storage endpoint posture, multiple-download-endpoint `ctx.signUrl`
  diagnostics, filename metadata override, content-disposition sanitization, and
  one-time replay-store enforcement were rechecked in `storage-capability-files`
  and were not carried forward.

## Latest Verification

- `pnpm run test`, `pnpm run check`, `pnpm run build:prod` in the fresh fixed
  baseline app passed before fan-out.
- `curl /dogfood/private` in `auth-cache-response-floors`: reproduced the bare
  unauthenticated route redirect without cache floor.
- Multipart `curl` upload in `storage-capability-files`: reproduced
  `accept(['text/plain'])` accepting HTML bytes when the client supplied
  `type=text/plain`.
