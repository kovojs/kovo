# Papercuts 18

Created 2026-06-30 from an exhaustive multi-agent `dogfood` pass against
`main` commit `1417b8037`. Source of truth remains `SPEC.md`; this ledger
captures verified framework/template/dev-tooling papercuts found while building
real apps from local Kovo packages.

## Scope

Five fresh SQLite apps under `/Users/mini/kovo-dogfood-exhaustive-20260629-182057`
covered islands, Drizzle/optimistic/idempotency, auth/cache/error shells, static
export/Defer/navigation, and endpoints/storage/webhooks. The Drizzle/optimistic
track found no confirmed framework issue; auth/cache and Defer regressions were
refuted by dev/prod evidence.

## Issues

### A. Static Assets And Stylesheets

- [ ] **A1 — Node production static output omits `public/` assets referenced by route HTML.** (med, framework; found by `t4-export-defer-navigation`, verified independently)
  - Observed behavior: `kovo build ./src/t4-static-app.tsx --preset node` emits static HTML referencing `/kovo-t4-mark.svg` and `/t4-note.txt`, but the node artifact serves both as 404 while explicit manifest-backed `kovo export` copies them.
  - Root cause: neutral static output calls `exportStaticApp` with manifest-derived assets but without `publicAssetRoot`, so document public-asset discovery is disabled (`packages/server/src/neutral-build.ts`, `packages/server/src/static-export.ts`).
  - Why it matters: a green production build can ship broken image/download links for valid `public/` assets that work in dev and manifest-backed export.
  - Repro evidence: verifier build under `/Users/mini/kovo-dogfood-exhaustive-20260629-182057/t4-export-defer-navigation` served `/static-assets` as 200, `/assets/styles.css` as 200, but `/kovo-t4-mark.svg` and `/t4-note.txt` as 404; explicit manifest-backed export wrote both public assets.
  - Acceptance: node preset static output includes referenced public assets, with a prod-artifact test proving served route HTML links resolve to 200 files.

- [ ] **A2 — `stylesheet('./file.css')` can emit a missing production/export asset.** (med, framework; found by `t4-export-defer-navigation`, verified independently)
  - Observed behavior: declaring `stylesheet('./local.css')` emits `/assets/local.css` in production/export HTML, but `kovo build` does not write the file unless Vite separately includes that source; the node server returns 404.
  - Root cause: `stylesheet(source)` derives an href but does not retain the source path, and neutral stylesheet materialization only writes critical CSS, build-owned CSS, or Vite manifest CSS (`packages/server/src/hints.ts`, `packages/server/src/neutral-build.ts`).
  - Why it matters: the API accepts a local stylesheet path and creates a valid-looking link, but app authors get an unstyled production artifact unless they know to wire the file into Vite.
  - Repro evidence: verifier copy with `src/local.css` and `stylesheet('./local.css')` built green; static HTML and `_headers` referenced `/assets/local.css`, but `dist/.kovo/static/assets/local.css` and `dist/server/static/assets/local.css` were absent; production `/assets/local.css` returned 404.
  - Acceptance: local stylesheet sources are copied/materialized or fail loudly; a production build regression proves `/assets/<file>.css` exists and is served.

### B. Endpoint And Capability Ergonomics

- [ ] **B1 — `ctx.signUrl` signs storage capability URLs with the app CSRF secret, while `createStorageDownloadEndpoint` verifies with its own declared secret.** (med, framework/API; found by `t5-endpoints-files-webhooks`, verified independently)
  - Observed behavior: a documented pairing of `createStorageDownloadEndpoint({ secret })` and route `ctx.signUrl({ key })` mints `/downloads/...` links that 404 in dev and production unless the capability secret happens to equal the app CSRF secret.
  - Root cause: route context creates `ctx.signUrl` from `app.csrf.secret`, but the download endpoint verifies with `options.secret` (`packages/server/src/app-document.ts`, `packages/server/src/capability-route.ts`). This overturns the previously refuted auth-C7 note in `plans/papercut-super-2.md`.
  - Why it matters: the framework-owned capability URL surface fails closed for ordinary apps with separate secrets and gives only a 404, not an actionable diagnostic.
  - Repro evidence: T5 app POSTed a signed webhook, listed a fresh `/downloads/...` URL from `/files`, and GET returned 404; control run with `KOVO_CAPABILITY_SECRET=KOVO_CSRF_SECRET` returned 200 with the stored body.
  - Acceptance: `ctx.signUrl` and the mounted storage download endpoint share the same configured capability signer or fail with a clear build/runtime diagnostic; regression proves the documented pairing returns 200 without secret aliasing.

- [ ] **B2 — Public `csrfToken`/`csrfField` cannot mint the first anonymous CSRF cookie for raw endpoint forms or JSON.** (med, framework/API+docs; found by `t5-endpoints-files-webhooks`, verified independently)
  - Observed behavior: default-CSRF raw endpoints build, but anonymous endpoint forms render an empty token, endpoint-posture cannot mint a token via public APIs, and first same-origin POST returns 422 `CSRF` unless another mutation form seeded the cookie.
  - Root cause: public `csrfToken` requires an existing session or anonymous binding, while anonymous binding minting is only available through internal mutation-form rendering; endpoint dispatch validates tokens but has no mint/render channel (`packages/server/src/csrf.ts`, `packages/server/src/app-dispatch.ts`).
  - Why it matters: app authors can keep endpoint CSRF enabled but cannot author a first anonymous browser endpoint flow through public APIs without switching to `csrf:false` or relying on unrelated mutation forms.
  - Repro evidence: verifier reran `pnpm exec kovo check endpoint-posture .kovo/endpoint-posture.json` in the T5 app and got `csrfToken requires a session id or anonymous CSRF cookie`; direct built-handler flow showed `GET /files` no `Set-Cookie`, upload form empty CSRF, and first POST 422 `CSRF`.
  - Acceptance: public endpoint form/token helpers can mint and set an anonymous binding safely, or documentation/API clearly routes endpoint authors through a supported CSRF minting channel; endpoint-posture and first anonymous POST pass without disabling CSRF.

### C. Starter Tooling Noise

- [x] **C1 — Generated starter `vp check` warns on `scripts/check-sound-subset.mjs`.** (low, template/dev-tooling; found by `t3-auth-session-access-cache`, verified independently)
  - Observed behavior: `pnpm exec vp check` exits 0 but prints `typescript(require-array-sort-compare)` for the generated `scripts/check-sound-subset.mjs`.
  - Root cause: the create-kovo template uses comparator-less `.sort()` in `sourceFiles()` (`packages/create-kovo/templates/scripts/check-sound-subset.mjs`).
  - Why it matters: the starter's own verification path should be quiet when green; generated-tooling warnings blur app warnings with framework noise.
  - Repro evidence: independent verifier reran `pnpm exec vp check` and `pnpm run check` in the T3 app; both exited 0 and reported the warning at generated script lines 27-34.
  - Acceptance: the generated script uses a deterministic comparator and fresh starter `vp check` emits no warning.
  - Evidence: `pnpm exec vitest run packages/create-kovo/src/index.test.ts --run --reporter=dot` proves the template emits the comparator; a fresh linked scaffold at `/Users/mini/kovo-dogfood-exhaustive-20260629-182057/c1-template-warning-check` passed `pnpm exec vp check` with no warnings.

## Refuted / Not Carried Forward

- Data/Drizzle/optimistic/idempotency track: parent-child reads, aggregates, output schemas, touch extraction, hand-written optimistic transforms, duplicate mutation failure, same-idempotency replay, `kovo explain --access`, `--endpoints`, and optimistic explain all passed after app-author corrections.
- Auth/cache/error shells: guarded routes, login/logout, guarded `/_q` cache headers, enhanced/no-JS mutation behavior, expired-session reauth, and custom error shells passed in dev and production.
- Defer streaming/isolation: dev and production streamed placeholders plus independent fragments; throwing regions produced per-region error state without blocking slow regions.

## Latest Verification

- `pnpm --filter create-kovo run build:dist`; fresh baseline scaffold `check`, `test`, `build:prod`, and dev HTTP smoke passed before fan-out.
- `gh run list --branch main --limit 6`: CI, GitHub Pages, and Race-Prone Integration Repeats were green for pushed commit `1417b8037`.
