# Papercuts 21

Created 2026-06-30. Source of truth remains `SPEC.md`. This ledger captures the
confirmed non-security rough edges from an exhaustive local dogfood pass after
`plans/claude-bugz-23.md` and `plans/claude-papercuts-21.md` were closed.

## Scope

Baseline: fresh SQLite `create-kovo` starter linked to the local monorepo passed
`pnpm run check`, `pnpm run test`, `pnpm run build:prod`, and a dev HTTP smoke.

Six independent dogfood tracks then exercised interaction islands/live updates,
data/Drizzle extraction, MPA/deploy/static export, auth/access, files/endpoints/
webhooks, and UI/testing APIs. Every candidate below was checked by a separate
skeptical verifier and deduped against existing `bugz*`, `papercut*`,
`papercuts*`, and `claude-*` ledgers. No confirmed issue in this round warranted
a new `bugz` ledger: the findings are fail-closed, audit-visibility, or API
ergonomics papercuts.

## Issues

### A. Static Export

- [ ] **A1 - `kovo export` cannot handle a Vite `public/` asset and a local Kovo stylesheet in one documented command.** (med, framework/static-export; found by `mpa-deploy`, verified independently)
  - Observed behavior: a standalone exportable app with `stylesheet('./styles.css')` and `<img src="/kovo-export-asset.svg">` fails bare export because `/kovo-export-asset.svg` is resolved under `src/`; using `--root public` copies the SVG and client module but writes HTML that links `/assets/styles.css` without writing that file.
  - Root cause: `staticExportDefaultPublicAssetRoot()` defaults to the app module directory when no manifest is present (`packages/cli/src/commands/build-export.ts:2305`), and document asset discovery skips build-owned stylesheet hrefs (`packages/server/src/static-export.ts:111-125`) even when no configured asset will materialize the stylesheet.
  - Why it matters: ordinary starter/Vite `public/` assets and Kovo local stylesheets both work in dev and production, but the static host can end up either failing export or serving an unstyled page.
  - Repro evidence: in `/Users/mini/kovo-dogfood-20260630-round4/mpa-deploy`, `pnpm exec kovo export ./src/export-app.tsx --out dist-export-only-maincheck` exits KV229 looking under `src/kovo-export-asset.svg`; `pnpm exec kovo export /Users/mini/kovo-dogfood-20260630-round4/mpa-deploy/src/export-app.tsx --root public --out dist-export-publicroot-maincheck` exits 0, writes `kovo-export-asset.svg`, and leaves `dist-export-publicroot-maincheck/assets/styles.css` missing while HTML links it.
  - Acceptance: export resolves the app-public root and build-owned stylesheet assets without overloading one `--root` switch into a broken combination, or fails loudly before writing a broken export.

### B. Drizzle Static Extraction

- [ ] **B1 - SQLite raw SQL through `db.run(trustedSql(...))` cannot use the declared `tables`/`touches` escape.** (med, framework/static-analysis; found by `data-plane`, verified independently)
  - Observed behavior: a SQLite mutation with `registry: { tables: ['projects'], touches: [project] }` still fails KV406 when it calls `request.db.run(trustedSql(sql`...`))`.
  - Root cause: raw declared-table coverage only treats `execute` as the raw operation (`packages/drizzle/src/static.ts:2247-2251`), raw trust scanning only looks for direct receiver calls named `execute` (`packages/drizzle/src/static.ts:2275-2279`), and `run` falls into the unclassified receiver path.
  - Why it matters: the SQLite dogfood path exposes BetterSQLite's `run()` method, so authors cannot ship the documented raw-SQL `tables`/`touches` posture on that dialect without changing APIs or avoiding raw SQL entirely.
  - Repro evidence: in `/Users/mini/kovo-dogfood-20260630-round4/data-plane`, `pnpm run build:prod` reports KV406 at `src/mutations.ts:86` and `:87` for the `archiveProject` raw SQL mutation despite declared `tables` and `touches`.
  - Acceptance: trusted raw SQL `run()` calls on a proven Drizzle receiver use the same declared-table/trustedSql handling as `execute()`, while untrusted or undeclared `run()` calls still fail closed.

- [ ] **B2 - RQB `db.query.<table>` fails closed unless the root table symbol is imported in the loader file, even when reads are declared.** (low, framework/static-analysis; found by `data-plane`, verified independently)
  - Observed behavior: `db.query.workspaces.findMany(...)` with static projections and `reads: [workspace, project, ledgerEntry]` emits KV406 until the file imports the `workspaces` table symbol.
  - Root cause: relational table-name resolution is built from local declarations/imports (`packages/drizzle/src/static/schema.ts:118-166`); unresolved RQB table properties become KV406 (`packages/drizzle/src/static/summaries.ts:297-324`). The declared Kovo `reads` list does not help resolve the root `db.query.<table>` property.
  - Why it matters: a runtime-valid Drizzle 1.0 RQB query and explicit Kovo read declarations are not enough; authors must add an otherwise-unused table import solely for static extraction.
  - Repro evidence: in `/Users/mini/kovo-dogfood-20260630-round4/data-plane`, `pnpm run build:prod` reports `ERROR KV406 queries.ts:44 ... Query relational read source could not be resolved to a Drizzle table`; a verifier's throwaway import of `workspaces` removed only that KV406.
  - Acceptance: the analyzer either resolves RQB root table names from project schema/relations or emits a targeted diagnostic that names the missing table-symbol import instead of a generic write-site KV406.

- [ ] **B3 - Passing a request object to a non-DB helper trips KV406 because the object carries `db`.** (low, framework/static-analysis; found during `data-plane` verification)
  - Observed behavior: `const userId = requireUserId(request)` is reported as KV406 even though the transaction writes in the same mutation are extracted correctly.
  - Root cause: project unresolved-call extraction treats external helper calls with arguments containing a receiver carrier as opaque DB helper calls (`packages/drizzle/src/static/project-receivers.ts:913-950,1028-1065`), then turns them into KV406 (`packages/drizzle/src/static/summaries.ts:2586-2590`).
  - Why it matters: common helper shapes that read only `request.session` are blocked when the request type also contains `db`; the diagnostic points at a non-write helper and asks for manual touches.
  - Repro evidence: in `/Users/mini/kovo-dogfood-20260630-round4/data-plane`, `pnpm run build:prod` reports KV406 at `src/mutations.ts:42`; the static-analysis cache shows `project` and `ledger-entry` touches were extracted and the unresolved site is the `requireUserId(request)` helper call, not `transaction(...)`.
  - Acceptance: helper calls are not treated as unresolved DB writes merely because they receive a request/container object, unless the helper body or signature actually consumes the Drizzle receiver opaquely.

### C. Endpoint Audit Output

- [ ] **C1 - `kovo explain --endpoints` omits body-size and rate-limit posture for endpoints and webhooks.** (low, framework/audit; found by `files-endpoints-webhooks`, verified independently)
  - Observed behavior: endpoint explain prints `bodySize=- rateLimit=-` for raw endpoints, the storage download endpoint, and webhooks; `dist/.kovo/graph.json` lacks those fields entirely.
  - Root cause: `EndpointExplain` already has `bodySize` and `rateLimit` fields (`packages/core/src/graph.ts:324-343`) and the renderer prints them (`packages/cli/src/graph-output.ts:1786-1798`), but `endpointCheckFact()` never populates them (`packages/cli/src/commands/build-export.ts:1190-1205`).
  - Why it matters: SPEC-facing machine-ingress audit output cannot show the coarse pre-dispatch body and rate posture a reviewer expects to inspect.
  - Repro evidence: in `/Users/mini/kovo-dogfood-20260630-round4/files-endpoints-webhooks`, `pnpm run build:prod && pnpm exec kovo explain --endpoints dist/.kovo/graph.json | rg 'bodySize=|rateLimit='` prints `bodySize=- rateLimit=-` for every endpoint row.
  - Acceptance: endpoint graph facts populate the applicable body-size and rate-limit posture, or the fields are removed/narrowed if the framework does not intend to audit them.

### D. Client/UI Authoring Ergonomics

- [ ] **D1 - Later islands in a multi-component module emit handler/derive exports under the first component's name.** (low, framework/compiler; found by `interaction-ladder`, verified independently)
  - Observed behavior: a module with `ContactFilterIsland` and `LocalCounterIsland` builds and hydrates, but the second island's event handlers and text derive are exported and referenced as `ContactFilterIsland$button_click_2`, `ContactFilterIsland$button_click_3`, and `ContactFilterIsland$p_text_derive_2`; no `LocalCounterIsland$...` exports exist.
  - Root cause: the compiler computes one module-wide `componentName` from the first component (`packages/compiler/src/compile.ts:242`) and threads it into lowering and handler/derive emission (`packages/compiler/src/compile.ts:277-298`); anonymous handler and derive names are built from that single name (`packages/compiler/src/lower/handlers.ts:68-70`, `packages/compiler/src/lower/structural-jsx.ts:1498-1513`).
  - Why it matters: the app works, but generated client ABI/debug output for later islands is misleading and unnecessarily coupled to whichever component appears first in the source module.
  - Repro evidence: in `/Users/mini/kovo-dogfood-20260630-round4/interaction-ladder`, `rg -n 'ContactFilterIsland|LocalCounterIsland|button_click|p_text_derive' dist/.kovo/client/c/__v/*/src/components/contacts.client.js` shows all second-island handler/derive exports prefixed with `ContactFilterIsland`.
  - Acceptance: anonymous handler and derive export names use the owning component name for each component, or the compiler records an intentional module-scope naming policy that is stable and non-misleading.

- [ ] **D2 - `FormErrorProps` accepts arbitrary attributes, but rendered errors drop `style` and `data-*`.** (low, framework/API; found by `ui-testing`, verified independently)
  - Observed behavior: `FormError({ style: 'color:red', 'data-testid': 'contact-error', class, id, role })` type-checks, but the rendered `<output>` preserves only `role`, `id`, `class`, and framework-owned `data-error-code`.
  - Root cause: `FormErrorProps` includes `[attribute: string]: unknown` (`packages/core/src/index.ts:762-770`), while `failureOutputAttributes()` serializes only the narrow allowlist (`packages/core/src/index.ts:1036-1045`).
  - Why it matters: common styling and browser-free test hooks are accepted by the public type and silently ignored at render time.
  - Repro evidence: in `/Users/mini/kovo-dogfood-20260630-round4/ui-testing`, `pnpm exec vitest run repro/form-error-style.test.ts --reporter=dot` proves the current output lacks `style=` and `data-testid=`.
  - Acceptance: either forward safe `data-*`/style-like authored attributes through the helper output, or narrow the public prop type so ignored attributes are compile-time errors.

## Refuted / Not Carried Forward

- Auth/access track found no new issues: guarded cache posture, stale-session enhanced reauth, CSRF denial flows, Better Auth secret classification, rate/body floors, `publicAccess` cache behavior, and session fingerprints held in dev and prod.
- MPA/deploy controls passed: nested/parallel `<Defer>` streamed, error/timeout regions isolated, redirects and route meta worked, endpoint cache headers were correct, versioned client modules served immutable, and repeated/no-cache production builds were deterministic.
- Files/endpoints/webhooks controls passed: multipart MIME sniffing rejected lying HTML, upload forms emitted multipart enctype, one-time signed downloads replay-protected, JSON endpoint CSRF worked, and webhook HMAC/idempotency held.
- UI/testing controls passed: `@kovojs/ui`, `@kovojs/icons`, style tokens/custom colors, no-JS FormError markup, and browser-free `@kovojs/test` assertions worked.
- Data-plane transaction rollback worked at runtime; the original "transaction callback remains KV406" framing was refuted. The carried B3 item is the corrected request-helper false positive.

## Latest Verification

- Baseline `/Users/mini/kovo-dogfood-20260630-baseline/base`: `pnpm run check`, `pnpm run test`, `pnpm run build:prod`, and a dev HTTP smoke passed.
- Author tracks: six linked apps under `/Users/mini/kovo-dogfood-20260630-round4/*` ran focused gates and returned structured results; every carried candidate above has an independent verifier result.
- Main-thread repros: static export A1, data-plane B1/B2/B3, endpoint explain C1, island ABI D1, and FormError D2 were rechecked from the dogfood apps or generated artifacts before this ledger was written.
