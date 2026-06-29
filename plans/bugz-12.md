# Bugz 12

Created 2026-06-29. Source of truth remains `SPEC.md`; this ledger captures
security/soundness defects found during the exhaustive Kovo dogfood pass after
`plans/bugz-11.md` and `plans/papercuts-13.md`.

## Scope

Dogfooded linked local apps under
`/Users/mini/kovo-dogfood-20260629-exhaustive`: `base-pristine`,
`live-optimistic-cache`, `auth-access-shells`, `endpoints-files-export`,
`dynamic-routes-hmr`, and `ui-headless-style-a11y`.

The baseline starter passed `pnpm run check`, `pnpm run test`,
`pnpm run build:prod`, and a dev HTTP smoke. App-author friction from the same
pass is filed in `plans/papercuts-14.md`.

## Issues

### A. Verification Surface Omissions

- [ ] **Endpoint explain omits route file outcomes returned through
      `rootedFiles().serve()`.** (med, security/soundness; found by
      `endpoints-files-export`)
  - Observed behavior: `/exports/rooted.txt` returned file bytes through
    `rootedFiles(...).serve(...)`, and static export recognized the replay as a
    file/stream route outcome, but `dist/.kovo/graph.json` and
    `kovo explain --endpoints dist/.kovo/graph.json` omitted the route entirely.
  - Root cause: `packages/cli/src/commands/build-export.ts:889-897` emits route
    file/stream endpoint facts only when `sourceRouteOutcomeKinds(...)` maps the
    route path, and `packages/cli/src/commands/build-export.ts:925-937` detects
    outcomes by scanning app route source for literal `respond.stream` or
    `respond.file`. `packages/server/src/file.ts:82-86` implements
    `rootedFiles().serve(...)` by returning `respond.stream(...)`, but the app
    route body contains only `rootedReportFiles.serve(...)`, so the scanner
    misses the sanctioned framework-owned file sink.
  - Why it matters: SPEC §6.2 / §9.5 / §11.4 put file and stream route outcomes
    on the machine-auditable ingress surface. Missing rows hide method,
    cache/header/body posture from endpoint explain and endpoint-posture review.
  - Repro evidence:
    `/Users/mini/kovo-dogfood-20260629-exhaustive/endpoints-files-export`
    `pnpm exec kovo explain --endpoints dist/.kovo/graph.json` listed
    `/exports/report.txt` as `route-file` and `/exports/events.ndjson` as
    `route-stream`, but not `/exports/rooted.txt`; `node -e` inspection of
    `dist/.kovo/graph.json` showed endpoint paths for `/api/health`,
    `/api/signed-json`, `/api/csrf-json`, `/webhooks/receipt-exported`,
    `/exports/report.txt`, and `/exports/events.ndjson` only.
  - Acceptance: rooted file route outcomes appear in graph/explain/posture with
    the same file/stream posture rows as direct `respond.file` /
    `respond.stream` route outcomes; coverage includes a public route returning
    `rootedFiles().serve(...)`.

## Refuted / Not Carried Forward

- Literal `respond.file(...)` and `respond.stream(...)` route explain rows
  remain fixed from `plans/bugz-11.md`; the new issue is the helper-returned
  rooted-files variant.
- Default-CSRF JSON endpoints, webhook verifier posture, and static-export
  concrete KV229 diagnostics for file/stream routes were rechecked in
  `endpoints-files-export` and not carried forward.

## Latest Verification

- `/Users/mini/kovo-dogfood-20260629-exhaustive/base-pristine`: `pnpm run
check`, `pnpm run test`, `pnpm run build:prod`, and dev HTTP smoke passed.
- `/Users/mini/kovo-dogfood-20260629-exhaustive/endpoints-files-export`:
  `pnpm run check`, `pnpm run test`, `pnpm run build:prod`,
  `pnpm exec kovo check endpoint-posture .kovo/endpoint-posture.json`, and
  `pnpm exec kovo explain --endpoints dist/.kovo/graph.json` passed while
  reproducing the missing `/exports/rooted.txt` endpoint row.
- Independent verifier confirmed the rooted-files omission as a
  variant/regression of `plans/bugz-11.md` rather than an exact duplicate.
