# Papercuts 19

Created 2026-06-30 from an exhaustive multi-agent `dogfood` pass against local
`main` commit `3fdfa6447`. Source of truth remains `SPEC.md`; this ledger
captures newly confirmed, non-duplicate framework papercuts found while building
real apps from local Kovo packages.

## Scope

Five fresh SQLite apps under `/Users/mini/kovo-dogfood-exhaustive-20260629-192219`
covered registry-bounded rich content, Drizzle/optimistic writes, navigation and
liveness, endpoints/files/webhooks, and UI/style/accessibility. Each track ran
the relevant scaffold/link/install flow plus `check`, `test`, `build:prod`, and
dev or production HTTP/browser smoke where observable. Candidates were verified
by independent skeptical sub-agents before being carried forward.

## Issues

### A. Mutation Failure Rendering

- [ ] **A1 — Component-scoped `FormError` renders as escaped text on no-JS 422 failure pages.** (med, framework; found by `t5-ui-style-a11y`, independently verified)
  - Observed behavior: a component-scoped mutation form returns HTTP 422 for a declared failure, but the full-page failure response contains escaped literal `&lt;output role="alert" ... data-error-code="BLOCKED_TITLE"&gt;...&lt;/output&gt;`; there is no real `output[data-error-code="BLOCKED_TITLE"]`.
  - Root cause: `packages/core/src/index.ts:1017` returns `FormError` markup as a raw string; component JSX children in `packages/server/src/jsx-runtime.ts:601` flow through `renderServerRenderable`, and `packages/server/src/renderable.ts:21,46` preserves only `RenderedHtml`/trusted HTML while escaping scalar strings.
  - Why it matters: `SPEC.md` §6.3/§9.2 describe declared mutation failures as normal TSX rendered through `FormError`/`FieldError`; escaping removes `role="alert"`, the error code marker, and accessible no-JS error UI.
  - Repro evidence: verifier ran the production node artifact for `/Users/mini/kovo-dogfood-exhaustive-20260629-192219/t5-ui-style-a11y`, submitted a valid-CSRF no-JS POST with `title=blocked launch`, and observed status 422, `realOutputCount=0`, `escapedOutputCount=1`.
  - Acceptance: declared `FormError`/`FieldError` helpers render as real elements on full-page no-JS failure responses; regression should assert the 422 production response has an actual `output[role="alert"][data-error-code]` and no escaped helper markup.

### B. Styling Token Extraction

- [ ] **B1 — `style.tokens.customColor(name)` is documented and typed, but `style.create(...)` cannot extract it.** (med, framework; found by `t5-ui-style-a11y`, independently verified)
  - Observed behavior: replacing raw `var(--kovo-theme-custom-warning-*)` strings with `style.tokens.customColor('warning').colorContainer`/`color`/`onColorContainer` in an app `style.create(...)` rule fails `build:prod` with KV236, despite the app theme defining `warning`.
  - Root cause: `packages/style/src/theme.ts:206-209,291-299,693-698` exposes and emits custom color token refs, but `packages/compiler/src/style.ts:1421-1458` recognizes public tokens only as property-access paths and cannot prove call expressions such as `style.tokens.customColor('warning').colorContainer`, so `packages/compiler/src/style.ts:1381-1390` emits KV236.
  - Why it matters: `SPEC.md` §13.1 allows compiler-known imported theme token references, and the public style API provides `customColor(name)` as the typed semantic-color path; app authors hit a hard production build wall unless they fall back to raw CSS variable strings.
  - Repro evidence: verifier made a disposable edit in `/Users/mini/kovo-dogfood-exhaustive-20260629-192219/t5-ui-style-a11y/src/components/t5-lab.tsx`, ran `pnpm run build:prod`, and captured `KV236 src/components/t5-lab.tsx:57:7 Static style extraction could not prove style.create values`; the edit was reverted.
  - Acceptance: `style.create(...)` accepts literal custom-color token calls from `@kovojs/style` while preserving KV236 for unprovable dynamic token names; focused compiler/style tests should cover accepted literal calls and rejected dynamic calls.

### C. Drizzle Provenance Ergonomics

- [ ] **C1 — KV438 still flags governed owner columns after wrapping a session-derived local in `serverValue(...)`.** (med, framework; found by `t2-data-optimistic`, independently verified)
  - Observed behavior: `build:prod` reports KV438 on `ownerId` writes even though the app assigns `const ownerId = request.session?.user.id ?? 'demo-user'` and passes `serverValue(ownerId, 'session owner')` into owner-annotated inserts.
  - Root cause: the `serverValue` gate at `packages/drizzle/src/static/derivation.ts:1320-1331` rejects the wrapped value because local alias provenance is not recovered as server/session-derived before that check (`packages/drizzle/src/static/derivation.ts:859-862,991-993`; session alias limits in `packages/drizzle/src/static/session-provenance.ts:171-175`).
  - Why it matters: `SPEC.md` §10.3/§11.1 make `serverValue` the author-facing discharge for governed values proven not request input. The diagnostic recommends the escape hatch, but ordinary session-derived locals still fail the deploy gate.
  - Repro evidence: verifier ran `pnpm run build:prod` in `/Users/mini/kovo-dogfood-exhaustive-20260629-192219/t2-data-optimistic` and captured KV438 diagnostics for project/task/activity `ownerId` values wrapped in `serverValue(ownerId, 'session owner')`.
  - Acceptance: `serverValue(sessionDerivedLocal, reason)` clears KV438 when provenance traces to `request.session`, while `serverValue(input.x, reason)` and other request-derived locals still fail; regression should cover both paths.

## Refuted / Duplicates

- T1 registry rich-content XSS boundaries, malformed XML handling, `trustedHtml` server export, and schema `.default()`/`.optional()` all passed in the real app.
- T1 KV407 read-mostly rich-content failed in the app but verified as duplicate/app-shape fallout of `plans/papercut-super-1.md` A4; using the schema `content` domain with `readOnly: true` removes KV407.
- T2 KV414 owner INSERT, query helper fallback, select-star KV406, and optimistic owner mismatch were duplicates or app-author mistakes; only the `serverValue` local-provenance false positive is carried.
- T3 query-shape derived metadata is a confirmed duplicate of the known Drizzle projection-vs-loader-return class; `refetchOnFocus` query opt-out is already tracked in `plans/capability-gaps.md:134`.
- T4 endpoints/files/webhooks found no new issue: default endpoint CSRF, storage capability upload/download/delete, signed webhook verification/replay, endpoint posture, `check`, `test`, and `build:prod` passed after app-author corrections.
- T5 UI copy-in dependency and copied table child rendering regressions were refuted; strict dev-port failure is a duplicate of earlier starter dev-port ledgers.

## Latest Verification

- Baseline scaffold under `/Users/mini/kovo-dogfood-exhaustive-20260629-192219/base`: `pnpm run check`, `pnpm run test`, `pnpm run build:prod`, and dev HTTP smoke passed.
- Root repair after multi-app dogfood: `pnpm install` and `node -p "require.resolve('@material/material-color-utilities', { paths: ['/Users/mini/kovo/packages/style'] })"` passed.
