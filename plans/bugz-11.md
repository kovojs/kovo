# Bugz 11

Created 2026-06-28. Source of truth remains `SPEC.md`; this ledger captures
security/soundness defects found during the exhaustive Kovo dogfood pass after
`plans/bugz-10.md` and `plans/papercuts-11.md` were fixed.

## Scope

Dogfooded linked local apps under `/Users/mini/kovo-dogfood-20260628g`:
`base-pristine`, `auth-storage-regression-2`, `ui-copyin-recheck`,
`query-stream-export-recheck`, `webhook-files-export-recheck`, and
`drizzle-optimistic-style-recheck`.

The baseline app passed first-run `pnpm run test`, `pnpm run check`,
`pnpm run build:prod`, and a dev HTTP smoke. App-author friction from the same
pass is filed in `plans/papercuts-12.md`.

## Issues

### A. Mutation Failure Semantics

- [x] **No-JS mutation rate-limit denials are rewritten to login redirects for sessionless requests.** (high, security/soundness; found by `auth-storage-regression-2`)
  - Observed behavior: `guards.rateLimit({ max: 0, per: 'global' })` returned
    `429 Retry-After` for route and query guards, but the same guard on a no-JS
    mutation returned `303 Location: /login?next=%2F` with no `Retry-After`.
  - Root cause: `packages/server/src/mutation.ts:917-923` calls
    `noJsMutationReauthResponse(...)` before mapping the guard failure status;
    `packages/server/src/mutation.ts:1515-1522` delegates to
    `guardFailureIsUnauthenticated(...)`, and
    `packages/server/src/guards.ts:963-970` treats auth-less guard failures as
    unauthenticated whenever the request has no session.
  - Why it matters: SPEC §9.5 / §10.3 require rate-limit denials to remain 429
    with `Retry-After`. Rewriting them to login redirects hides overload/backoff
    posture and diverges from route/query behavior.
  - Repro evidence:
    `/Users/mini/kovo-dogfood-20260628g/auth-storage-regression-2`
    `pnpm exec vitest run dogfood/auth-storage-regression.test.ts` passed while
    asserting the current route/query 429 behavior and mutation 303 behavior.
  - Acceptance: no-JS mutation guard failures preserve non-auth status mapping
    before reauth redirect handling, with focused coverage for rate-limit 429
    and unauthenticated auth-guard 303.
  - Evidence: 2026-06-28
    `pnpm exec vitest --run packages/server/src/mutation-endpoint.test.ts`
    passed with no-JS mutation coverage for rate-limit `429 Retry-After` and
    true unauthenticated auth-guard `303` reauth.

### B. Static Export Fail-Closed Boundary

- [x] **Vite-backed static export serializes `redirect()` route outcomes into status-200 HTML.** (high, security/soundness; found by `webhook-files-export-recheck`)
  - Observed behavior: `kovo export ./src/export-redirect-only-app.tsx --vite`
    exited 0 and wrote `/old-dogfood/index.html` containing
    `{"location":"/","status":303}` inside the HTML body for a route whose page
    returns `redirect('/')`.
  - Root cause: `packages/server/src/route.ts:637` recognizes redirects only
    when `isRedirect(...)` succeeds; `packages/server/src/route.ts:1301-1311`
    requires the `core:route-redirect` blessed-sink witness. Under Vite-backed
    export the redirect object is not recognized, so it falls through to normal
    page rendering. `packages/server/src/static-export-response.ts:97` can only
    fail closed if replay returns a real 3xx response.
  - Why it matters: SPEC §6.4 and §9.5 make `redirect()` a sanctioned non-200
    route outcome. Static export must fail or skip loudly, not publish corrupt
    status-200 documents that misrepresent route behavior.
  - Repro evidence:
    `/Users/mini/kovo-dogfood-20260628g/webhook-files-export-recheck`
    `pnpm exec kovo export ./src/export-redirect-only-app.tsx --vite --root .
--out dist-export-redirect-selfcheck` wrote
    `dist-export-redirect-selfcheck/old-dogfood/index.html` containing
    `{"location":"/","status":303}`.
  - Acceptance: Vite-backed static export treats route redirects like the
    non-Vite path: concrete KV229 fail/skip, no HTML artifact.
  - Evidence: 2026-06-28
    `pnpm exec vitest run packages/server/src/vite-export-replay.test.ts packages/server/src/static-export-response.test.ts packages/server/src/route.test.ts`
    passed with Vite-backed redirect replay producing KV229 instead of a
    status-200 HTML artifact.

### C. Verification Surface Omissions

- [x] **Endpoint explain omits route `respond.file` / `respond.stream` outcomes.** (med, security/soundness; found by `webhook-files-export-recheck`)
  - Observed behavior: the app declared `/download/report.txt` with
    `respond.file(...)` and `/stream/events.ndjson` with `respond.stream(...)`,
    but `kovo explain --endpoints dist/.kovo/graph.json` listed only raw
    endpoints, the webhook, and mutations.
  - Root cause: `packages/cli/src/commands/build-export.ts:753-784` serializes
    only `app.endpoints` into endpoint explain facts; routes are serialized by
    `routeCheckFact(...)` at `packages/cli/src/commands/build-export.ts:743-750`
    without route file/stream posture rows.
  - Why it matters: SPEC §6.4 / §11.4 put file and stream route outcomes on the
    audit surface. Missing rows hide cache/header/body posture from endpoint
    explain and security review.
  - Repro evidence:
    `/Users/mini/kovo-dogfood-20260628g/webhook-files-export-recheck`
    `pnpm exec kovo explain --endpoints dist/.kovo/graph.json` listed
    `/api/*`, `/webhooks/signed-write`, and mutations, but no
    `/download/report.txt` or `/stream/events.ndjson`.
  - Acceptance: route file/stream outcomes appear in explain/check posture with
    their path, method, cache/header/body posture, and route surface.
  - Evidence: 2026-06-28
    `pnpm exec vitest run packages/cli/src/index.kovo-route-outcomes.test.ts`
    passed with `/download/report.txt` and `/stream/events.ndjson` serialized
    as `route-file` / `route-stream` endpoint explain rows.

## Refuted / Not Carried Forward

- Guarded route/query cache floors, stored upload sniffing, storage signed URL
  base paths, one-time replay, stored-file inline/attachment behavior, webhook
  replay posture, default-CSRF JSON endpoints, verifier endpoints, and file 304
  header preservation were rechecked and not carried forward.
- KV422 `RegExp#exec` false positives were refuted with a safe static-analysis
  probe; real `db.exec`, `db.execute`, aliased `sql.raw`, and namespace
  `sql.identifier` sinks still fail KV422.

## Latest Verification

- `pnpm run test`, `pnpm run check`, `pnpm run build:prod`, and dev HTTP smoke
  passed in `/Users/mini/kovo-dogfood-20260628g/base-pristine`.
- `pnpm exec vitest run dogfood/auth-storage-regression.test.ts` in
  `auth-storage-regression-2`: reproduced route/query 429 but no-JS mutation
  303 for the same rate-limit guard.
- `pnpm exec kovo export ./src/export-redirect-only-app.tsx --vite --root .
--out dist-export-redirect-selfcheck` in `webhook-files-export-recheck`:
  reproduced the status-200 redirect artifact.
- `pnpm exec kovo explain --endpoints dist/.kovo/graph.json` in
  `webhook-files-export-recheck`: reproduced missing file/stream route rows.
- 2026-06-28 focused fix gates:
  `pnpm exec vitest run packages/server/src/mutation-endpoint.test.ts packages/server/src/vite-data-plane-gate.test.ts packages/drizzle/src/sql-safety-static.test.ts`
  and
  `pnpm exec vitest run packages/cli/src/index.kovo-add.test.ts packages/cli/src/index.kovo-route-outcomes.test.ts packages/server/src/vite-export-replay.test.ts packages/server/src/static-export-response.test.ts packages/server/src/route.test.ts`
  both passed.
