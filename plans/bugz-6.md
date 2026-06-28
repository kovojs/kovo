# Bugz 6

Created 2026-06-27. Source of truth remains `SPEC.md`; this ledger captures a
confirmed security-header regression found during exhaustive Kovo dogfooding.

## Scope

The `request-shell-errors` dogfood app under
`/Users/mini/kovo-dogfood-20260627/request-shell-errors` exercised custom
404/403/500 shells, guarded routes, no-JS/enhanced form errors, and endpoint
posture. The finding below was author-reproduced, independently verified, and
self-checked on the main thread.

## Issues

### A. Request Shell Security Headers

- [x] **Custom 404/500 error shells bypass document security/header defaults.** (med, framework; found by `request-shell-errors`)
  - Observed behavior: configured 404 and 500 shell bodies render, but responses have `content-type: text/plain;charset=UTF-8` and omit the normal document security headers, including CSP, `X-Frame-Options`, and `X-Content-Type-Options`. The 403 control path renders a custom shell with the expected document/security/cache headers.
  - Root cause: `packages/server/src/app-document.ts:123` and `packages/server/src/app-document.ts:127` send route-level 404/500 responses through `renderAppErrorDocumentResponse`; `packages/server/src/app-document.ts:267` returns the configured shell renderer result unchanged, skipping the normal document assembly/header floor at `packages/server/src/app-document.ts:173`. `packages/server/src/response.ts:417` and `packages/server/src/response.ts:621` then construct a `Response` from only the supplied headers.
  - Why it matters: SPEC §9.2/§9.5 put 404/403/500 shells under the request shell with safe defaults. Apps that provide only a body/status lose framework-owned runtime defense-in-depth headers on error documents.
  - Repro evidence: `curl -i http://127.0.0.1:41801/missing-by-return` returned `404` with `data-rse-shell="404"`, `content-type: text/plain;charset=UTF-8`, and no CSP/XFO/nosniff. `curl -i http://127.0.0.1:41801/throws` did the same for `500`. `curl -i -H 'Cookie: rse_session=member' http://127.0.0.1:41801/forbidden` returned `403` with `content-type: text/html; charset=utf-8`, CSP, `x-frame-options: DENY`, `x-content-type-options: nosniff`, `cache-control: private, no-store`, and `vary: Cookie`.
  - Acceptance: every configured 404/403/500 shell response passes through the same document response floor as route documents unless the app explicitly declares a lower posture; regression coverage asserts content type plus CSP/XFO/nosniff/cache headers for custom 404, 403, and 500 shells.
  - Evidence: `pnpm exec vitest run packages/server/src/app-document.test.ts packages/server/src/route-query-guards.test.ts packages/server/src/access.test.ts` proves configured 404/403/500 shells are wrapped as HTML documents with CSP/XFO/nosniff/cache headers, including a configured 404 shell that tried to return `text/plain`.

## Refuted / Not Carried Forward

- The guarded 403 path is not this bug: it now carries the expected document and security headers.
- This is distinct from prior `plans/bugz-4.md` 403 guard-response header work and from `plans/papercut-super-2.md` status-code-only error-shell checks.

## Latest Verification

- `pnpm exec vitest run packages/server/src/app-document.test.ts packages/server/src/route-query-guards.test.ts packages/server/src/access.test.ts`
- `pnpm exec vp check packages/server/src/document-core.ts packages/server/src/app-document.ts packages/server/src/app-document.test.ts`
- `git diff --check`
