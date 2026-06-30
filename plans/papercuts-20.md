# Papercuts 20

Created 2026-06-30. Source of truth remains `SPEC.md`. These rough edges came from the same
exhaustive dogfood pass recorded in `plans/bugz-22.md`.

## Scope

Five advanced linked SQLite dogfood apps covered durable tasks, islands/live targets, storage/static
assets, endpoints/auth/webhooks, and routing/export/deploy skew. Confirmed soundness defects were
routed to `plans/bugz-22.md`; this ledger keeps non-security deploy/runtime papercuts.

## Issues

- [ ] **A1 — Node production artifacts for dynamic apps still omit referenced `public/` assets.**
      (med, framework deploy artifact; regression variant of `plans/papercuts-18.md` A1)
  - Observed behavior: apps with queries or mutations render route HTML linking valid `public/`
    assets, but the built node artifact serves those links as 404. The same assets exist in
    `public/` and `dist/.kovo-client/`, not in `dist/server/static/`.
  - Root cause: `packages/server/src/neutral-build.ts:273` skips `writeNeutralStaticOutput` when
    the app has mutations or queries; `packages/server/src/build.ts:307-308` copies `staticOutput`
    into `dist/server/static` only when it exists; the node server's public-asset fallback resolves
    under that missing `staticRoot` (`packages/server/src/build.ts:912`, `:969`).
  - Why it matters: the prior A1 fix proved static-output artifacts, but dynamic production apps are
    the common starter path. A green node build can still ship broken image/download links that work
    in dev.
  - Repro evidence: verifier confirmed T3 `/assets-proof` HTML referenced `/kovo-storage-mark.svg`
    and `/static-note.txt`, both 404 in prod; T5 `/directory/nested/meta` referenced
    `/dogfood-marker.txt`, also 404. Neither artifact had `dist/server/static/`.
  - Acceptance: node dynamic production builds copy and serve referenced `public/` assets, with a
    prod-artifact test where an app with at least one query or mutation renders `/logo.svg` and the
    emitted node server returns 200 for it.

- [ ] **A2 — Task-runtime startup failures bypass app `onError` and are opaque in dev.** (low-med,
      framework/dev-tooling; found by `t1-durable`)
  - Observed behavior: when task runtime startup fails, the request returns a generic/plain 500 and
    the app-level `onError` shell is not invoked; dev terminal output does not point authors to the
    durable-task store mismatch.
  - Root cause: `packages/server/src/app.ts:332` awaits `taskRuntime.ensureStarted` before entering
    `handleAppRequest`; `packages/server/src/app-request.ts:71` only calls app `onError` inside the
    later request handler catch; `packages/server/src/task-runtime.ts:79` can fail before runner
    `onError` exists.
  - Why it matters: fail-closed startup is acceptable, but the error path should still use the app's
    stable shell or emit an actionable diagnostic. Today authors see an opaque dev/runtime 500.
  - Repro evidence: verifier Parfit confirmed the T1 durable SQLite app logs a generic
    `[kovo] unhandled node server error` in production and bypasses app `onError` in dev when startup
    fails before request handling.
  - Acceptance: task-runtime startup failures route through the app/global error reporting surface
    with an actionable diagnostic, without hiding the underlying build-gate bug from `bugz-22` B3.

## Refuted / Not Carried Forward

- Static export expectedly skipped non-exportable dynamic routes where requested.
- Signed storage GET/HEAD, custom storage base paths, endpoint auth/CSRF, webhook signatures, and
  route/error shells passed in their dogfood tracks.
- Duplicate public-asset findings from T3 and T5 were collapsed into A1.

## Latest Verification

- Independent verifier reports confirmed A1 and A2 with source file/line roots and prod/dev smokes.
- `pnpm install` at the monorepo root completed after multi-app dogfood.
