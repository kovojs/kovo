# Plan: Integration Test Cases

## Purpose

This is the fixture/spec inventory for the framework-owned integration suite described in
`plans/integration-test-suite.md`. Each case should be a small app under
`tests/integration/fixtures/<fixture>/` plus one spec under `tests/integration/specs/`, driven by
`@kovojs/test/integration`.

Use `SPEC.md` as the normative behavior source. Keep assertions semantic: Playwright role/text
assertions, Kovo semantic anchors, server-truth database checks, request/response checks, and
`kovoApp.semantic(...)` snapshots.

Mark a checkbox complete only after the named fixture/spec exists and the same session records a
passing proving command under that checkbox. If a case is better proven by a browser-free compiler,
runtime, or conformance suite, leave it out of this file or add only the browser/server edge that the
integration harness uniquely proves.

## Existing coverage anchors

- [x] `static-home` / `static-home.spec.ts`: server boots a minimal app, serves a route, resolves
      `baseURL`, and emits a semantic snapshot.
  - Evidence: inspected `tests/integration/specs/static-home.spec.ts`; coverage maps to
    `plans/integration-test-suite.md` I0 and SPEC §9.5 request shell.
- [x] `auth` / `auth.spec.ts`: `login()` establishes an authenticated session through the rendered
      form, and a guarded route does not leak signed-in content when anonymous.
  - Evidence: inspected `tests/integration/specs/auth.spec.ts`; coverage maps to
    `plans/integration-test-suite.md` I2 and SPEC §6.5 guard failure/session behavior.
- [x] `counter` / `counter.spec.ts`: enhanced mutation posts to `/_m/counter/increment`, morphs the
      bound fragment in place, keeps the URL stable, verifies database truth, and snapshots the
      fragment target.
  - Evidence: inspected `tests/integration/specs/counter.spec.ts`; coverage maps to
    `plans/integration-test-suite.md` I3 and SPEC §9.1 mutation round-trip.
- [x] `stock` / `stock.spec.ts`: successful enhanced mutation decrements server truth; declared
      `OUT_OF_STOCK` failure morphs a typed error fragment without navigation.
  - Evidence: inspected `tests/integration/specs/stock.spec.ts`; coverage maps to
    `plans/integration-test-suite.md` I3 and SPEC §9.2 typed errors.

## First-wave gaps from the suite plan

- [ ] `query-refetch` / `query-refetch.spec.ts`: mutate server state outside the page, trigger the
      loader's focus/visibility refetch, and assert the typed read endpoint updates all
      `[kovo-deps]` consumers from `<kovo-query>` server truth.
  - SPEC refs: §4.4 loader, §9.3 liveness, §9.4 typed reads.
  - Assertions: wait for `/_q/<query>`; `[data-bind]` text updates; semantic snapshot keeps
    `kovo-query`, `kovo-deps`, and binding attrs; no full navigation.
  - Partial evidence: `tests/integration/fixtures/query-refetch` and
    `tests/integration/specs/query-refetch.spec.ts` verify `/_q/refetch` returns latest server
    truth and snapshots the stale page. Proving command:
    `pnpm --filter @kovojs/integration-tests exec playwright test specs/query-refetch.spec.ts specs/binding-text-attr.spec.ts specs/nullable-binding.spec.ts specs/shared-query-consumers.spec.ts`.
  - Gap: default inline loader still does not install focus/visibility typed-read refetch. Query-only
    chunks now update live `data-bind` / `data-bind:<attr>` text/attrs in `[kovo-deps]`
    consumers, but typed-read lifecycle wiring exceeded the SPEC §4.4 4KB gzip budget during this
    slice (prototype generated inline loader was 4619 bytes gzip > 4096).
- [ ] `optimistic-success` / `optimistic-success.spec.ts`: a hand-written optimistic transform
      updates every consumer of the invalidated query immediately, marks affected islands pending,
      and reconciles cleanly when the server response arrives.
  - SPEC refs: §10.4 optimism, §4.8 update plan, §9.1 `<kovo-query>`.
  - Assertions: pre-response UI changes; `kovo-pending`/`aria-busy` present while pending; final
    server truth matches db and no pending state remains.
  - Partial evidence: `tests/integration/specs/optimistic-success.spec.ts` records the current
    browser-integration blocker: fixture bootstraps install enhanced submit/query plans, but they do
    not expose optimistic plans or an `OptimisticRebaser` to authored fixtures. Focused command:
    `pnpm exec playwright test tests/integration/specs/optimistic-success.spec.ts --config tests/integration/playwright.config.ts --workers=1`.
- [ ] `optimistic-rollback` / `optimistic-rollback.spec.ts`: an optimistic transform predicts a
      change, the mutation returns a typed error, snapshots are restored, and the error fragment is
      rendered.
  - SPEC refs: §10.4 runtime protocol, §9.2 errors.
  - Assertions: transient predicted value; rollback to prior value; `data-error-code`; db unchanged.
  - Partial evidence: `tests/integration/specs/optimistic-rollback.spec.ts` pins the same missing
    end-to-end optimistic wiring in the browser fixture path. Focused command:
    `pnpm exec playwright test tests/integration/specs/optimistic-rollback.spec.ts --config tests/integration/playwright.config.ts --workers=1`.
- [ ] `optimistic-rebase` / `optimistic-rebase.spec.ts`: two same-query optimistic mutations are
      pending concurrently; the first server truth arrives before the second, and the loader rebases
      the remaining transform in order.
  - SPEC refs: §10.4 concurrency.
  - Assertions: ordered visible state, final query value equals db, no stale intermediate overwrite.
  - Partial evidence: `tests/integration/specs/optimistic-rebase.spec.ts` records that the browser
    fixture path still cannot attach the runtime optimistic log/rebase protocol to enhanced submits.
    Focused command:
    `pnpm exec playwright test tests/integration/specs/optimistic-rebase.spec.ts --config tests/integration/playwright.config.ts --workers=1`.
- [x] `enhanced-submit-controls` / `enhanced-submit-controls.spec.ts`: enhanced form submission
      preserves submitter semantics for multiple buttons, disabled controls, default values, and
      schema coercion.
  - SPEC refs: §6.3 form typing, §9.1 enhanced mutation round-trip, §6.6 wire validation.
  - Assertions: server receives the intended submitter/input shape; validation errors are field
    scoped; no-JS form markup remains a real `method="post"` form.
  - Evidence: `tests/integration/fixtures/enhanced-submit-controls` and
    `tests/integration/specs/enhanced-submit-controls.spec.ts` verify real `method="post"` markup,
    enhanced schema coercion for number/checkbox fields, disabled-control omission, and clicked
    submitter button `name`/`value` preservation for `intent=confirm` and `intent=preview`. Runtime
    parity is pinned by `packages/runtime/src/loader-enhanced-mutation-submit.test.ts` and
    `packages/runtime/src/inline-loader-enhanced-submit.test.ts`. Proving commands:
    `pnpm exec playwright test tests/integration/specs/enhanced-submit-controls.spec.ts --config
    tests/integration/playwright.config.ts --workers=1`; `pnpm exec vitest run
    packages/runtime/src/loader-enhanced-mutation-submit.test.ts
    packages/runtime/src/inline-loader-enhanced-submit.test.ts`; `pnpm --filter @kovojs/runtime run
    check:inline-loader`.
- [ ] `loader-lifecycle` / `loader-lifecycle.spec.ts`: a long-running handler receives
      `ctx.signal`, fragment morph removes its island, and cleanup runs without mount/unmount hooks.
  - SPEC refs: §4.4 loader, §4.7 lifecycle.
  - Assertions: handler starts only after declared trigger/interaction; removal aborts signal;
    replacement island remains inert until touched.
  - Partial evidence: `tests/integration/fixtures/loader-lifecycle` and
    `tests/integration/specs/loader-lifecycle.spec.ts` now exercise the intended trigger + morph
    shape, but the spec remains skipped because the browser fixture path morphs in the replacement
    island without aborting the running delegated handler signal, so SPEC.md §4.7 cleanup is not yet
    provable end-to-end. Focused command:
    `pnpm exec playwright test tests/integration/specs/loader-lifecycle.spec.ts --config tests/integration/playwright.config.ts --workers=1`.

## Render and document shell

- [x] `document-shell` / `document-shell.spec.ts`: default document assembly includes doctype/html
      shell, route meta, query JSON before consumers, page body, and the inline loader.
  - SPEC refs: §9.5 request shell, §4.2 rendered output.
  - Assertions: initial response is full HTML; semantic snapshot keeps query/consumer ordering
    without raw HTML brittleness.
  - Evidence: `tests/integration/fixtures/document-shell` and
    `tests/integration/specs/document-shell.spec.ts` verify doctype/html/lang, route title meta,
    inline loader script, initial `kovo-query` before the `[kovo-deps]` consumer, rendered body, and
    a full-document semantic snapshot. Proving command:
    `pnpm exec playwright test document-shell.spec.ts custom-document-template.spec.ts http-methods.spec.ts asset-serving.spec.ts client-module-versioning.spec.ts --config tests/integration/playwright.config.ts --workers=1`.
- [x] `custom-document-template` / `custom-document-template.spec.ts`: an app document template can
      wrap assembled parts but cannot drop loader, query scripts, or body content.
  - SPEC refs: §9.5 request shell.
  - Assertions: custom chrome renders; core assembled parts still present; interaction still works.
  - Evidence: `tests/integration/fixtures/custom-document-template` and
    `tests/integration/specs/custom-document-template.spec.ts` verify a custom template wrapping
    assembled `parts.head`, `parts.queryScripts`, and `parts.body`; the response keeps the inline
    loader, custom chrome, body content, and a client handler runs through the preserved loader.
    `packages/server/src/document.test.ts` verifies malformed `DocumentTemplate` /
    `DeferredDocumentTemplate` output now rejects omission of `parts.head`, `parts.body`, and
    non-empty `parts.queryScripts[*]`.
    Proving command:
    `pnpm exec vitest run packages/server/src/document.test.ts packages/server/src/app-document.test.ts packages/server/src/vite-dev.test.ts packages/server/src/app-dispatch.test.ts packages/server/src/app.test.ts packages/server/src/route.test.ts packages/server/src/route-query-guards.test.ts`
    and
    `pnpm exec playwright test tests/integration/specs/custom-document-template.spec.ts tests/integration/specs/http-methods.spec.ts tests/integration/specs/not-found-error-shells.spec.ts tests/integration/specs/forbidden-route.spec.ts --config tests/integration/playwright.config.ts --workers=1`.
- [x] `asset-serving` / `asset-serving.spec.ts`: built `/assets/*` files are served with immutable
      cache headers while app routes still dispatch through the Kovo handler.
  - SPEC refs: §9.5 request shell, `plans/integration-test-suite.md` serve path.
  - Assertions: asset response content type/cache headers; route response unaffected.
  - Evidence: `tests/integration/fixtures/asset-serving` and
    `tests/integration/specs/asset-serving.spec.ts` verify `/assets/shell.css` content type and
    immutable cache headers, then load `/` through the Kovo route shell. Proving command:
    `pnpm exec playwright test document-shell.spec.ts custom-document-template.spec.ts http-methods.spec.ts asset-serving.spec.ts client-module-versioning.spec.ts --config tests/integration/playwright.config.ts --workers=1`.
- [x] `client-module-versioning` / `client-module-versioning.spec.ts`: emitted `on:*` refs and module
      URLs stay readable and resolve after page load, with volatile version/hash normalized in
      semantic snapshots.
  - SPEC refs: §4.3 handlers, §5.2 source-derived names, §6.6 deploy skew.
  - Assertions: interaction imports module successfully; snapshot normalizes `?v=`/hash segments.
  - Evidence: `tests/integration/fixtures/client-module-versioning` and
    `tests/integration/specs/client-module-versioning.spec.ts` verify the readable
    `/c/versioned.client.js?v=a1b2c3d4#mark` `on:click` ref, immutable client-module response
    headers, successful first-interaction import, and semantic snapshot normalization. Proving
    commands: `pnpm exec vitest run packages/test/src/integration/semantic-snapshot.test.ts` and
    `pnpm exec playwright test document-shell.spec.ts custom-document-template.spec.ts http-methods.spec.ts asset-serving.spec.ts client-module-versioning.spec.ts --config tests/integration/playwright.config.ts --workers=1`.
- [x] `http-methods` / `http-methods.spec.ts`: page routes answer GET/HEAD, reject unsupported
      methods with 405, and mutation POSTs are owned by `/_m/`.
  - SPEC refs: §9.5 request shell.
  - Assertions: direct HTTP requests check status/method behavior; browser route still renders.
  - Evidence: `packages/server/src/vite-dev.test.ts` verifies Vite dev request ownership now claims
    matched page paths even for disallowed methods, while unknown non-navigation paths still fall
    through. `tests/integration/fixtures/http-methods` and
    `tests/integration/specs/http-methods.spec.ts` verify GET and HEAD route responses, browser
    route rendering, mutation POST ownership under `/_m/methods/record`, and page-path `POST /`
    returning app-shell 405 with `Allow: GET, HEAD`. Proving commands: the focused vitest and
    Playwright commands recorded under `custom-document-template`.
- [x] `not-found-error-shells` / `not-found-error-shells.spec.ts`: missing routes, `notFound()`, and
      unexpected page errors render the configured safe shells with correct status.
  - SPEC refs: §6.4 `notFound()`, §9.2 unexpected failures, §9.5 error shells.
  - Assertions: 404/500 status; no internal stack text; custom shell semantic snapshot.
  - Evidence: `packages/server/src/app-document.test.ts` verifies route-returned `notFound()`,
    route failures, and forbidden guard failures are routed through configured app error shells.
    `packages/server/src/vite-dev.test.ts` verifies HTML navigation misses are claimed by the app
    shell without claiming asset-like misses. `tests/integration/fixtures/not-found-error-shells`
    and `tests/integration/specs/not-found-error-shells.spec.ts` verify missing routes and
    route-returned `notFound()` render the configured 404 shell, and unexpected route errors render
    the configured 500 shell without leaking the private error message. Proving commands: the
    focused vitest and Playwright commands recorded under `custom-document-template`.

## Mutation wire and forms

- [x] `mutation-prg-no-js` / `mutation-prg-no-js.spec.ts`: when enhanced headers are absent, the same
      mutation endpoint follows POST-redirect-GET and renders errors into a full page.
  - SPEC refs: §9.1 no-JS path, §9.2 errors.
  - Assertions: `request.post` without `Kovo-Fragment` returns redirect or full page; browser can
    submit a real form with JavaScript disabled if Playwright project support is added.
  - Evidence: `pnpm exec playwright test mutation-prg-no-js.spec.ts post-commit-rerun.spec.ts typed-error-union-multiple.spec.ts validation-field-errors.spec.ts --config=tests/integration/playwright.config.ts` passed the no-JS redirect and typed-error full-page tests in `tests/integration/specs/mutation-prg-no-js.spec.ts`.
- [x] `csrf-required` / `csrf-required.spec.ts`: emitted mutation forms carry `kovo-csrf`, valid
      enhanced submits pass, missing/invalid tokens fail before parsing/guards.
  - SPEC refs: §6.6 CSRF boundary, §9.1 mutation lifecycle.
  - Assertions: hidden token is present but omitted from semantic snapshots; invalid raw POST is
    rejected; valid browser submit succeeds.
  - Evidence: added `tests/integration/fixtures/csrf-required/app.tsx` and
    `tests/integration/specs/csrf-required.spec.ts`; passed
    `pnpm --filter @kovojs/integration-tests exec playwright test --grep "CSRF|idempotency|headers|patched-in|Kovo-Changes|render-error" --config playwright.config.ts`.
- [x] `idempotent-mutation` / `idempotent-mutation.spec.ts`: duplicate `Kovo-Idem` submissions replay
      the stored response and do not execute the write twice.
  - SPEC refs: §9.1 wire protocol, §10.3 request lifecycle.
  - Assertions: same response shape; db row/count changes once; duplicate request is observable.
  - Evidence: added `tests/integration/fixtures/idempotent-mutation/app.tsx` and
    `tests/integration/specs/idempotent-mutation.spec.ts`; passed the Slice F Playwright command
    recorded under `csrf-required`.
- [x] `mutation-response-headers` / `mutation-response-headers.spec.ts`: mutation handlers can attach
      narrow transport headers such as `Set-Cookie` without replacing the framework response body.
  - SPEC refs: §9.1 mutation response headers.
  - Assertions: header is present on enhanced and no-JS paths; fragment/query vocabulary remains.
  - Evidence: added `tests/integration/fixtures/mutation-response-headers/app.tsx` and
    `tests/integration/specs/mutation-response-headers.spec.ts`; passed the Slice F Playwright
    command recorded under `csrf-required`.
- [x] `validation-field-errors` / `validation-field-errors.spec.ts`: schema validation failures return
      HTTP 422 with `data-error-path` and field-scoped messages.
  - SPEC refs: §6.3 form fields, §9.2 errors.
  - Assertions: malformed input produces 422; field error anchors morph in; db unchanged.
  - Evidence: `tests/integration/fixtures/validation-field-errors` and
    `tests/integration/specs/validation-field-errors.spec.ts` verify a malformed quantity returns
    HTTP 422, morphs a `data-error-path="quantity"` alert into the form target, leaves the URL
    stable, and leaves `reservations` empty. Proving commands:
    `pnpm exec vitest run packages/server/src/mutation-endpoint.test.ts packages/server/src/query-endpoint.test.ts packages/server/src/schema.test.ts` and
    `pnpm exec playwright test tests/integration/specs/validation-field-errors.spec.ts tests/integration/specs/query-args-search.spec.ts --config tests/integration/playwright.config.ts --workers=1`.
- [x] `typed-error-union-multiple` / `typed-error-union-multiple.spec.ts`: one mutation exposes
      multiple declared error codes and the enhanced path renders the right branch each time.
  - SPEC refs: §6.3 typed error union, §9.2 errors.
  - Assertions: each code has distinct `data-error-code`; no unexpected server detail leaks.
  - Evidence: `pnpm exec playwright test mutation-prg-no-js.spec.ts post-commit-rerun.spec.ts typed-error-union-multiple.spec.ts validation-field-errors.spec.ts --config=tests/integration/playwright.config.ts` passed `tests/integration/specs/typed-error-union-multiple.spec.ts`; semantic snapshots verify distinct `OUT_OF_STOCK` and `CARD_DECLINED` branches.
- [x] `post-commit-rerun` / `post-commit-rerun.spec.ts`: mutation responses re-run invalidated
      queries after commit, so the rendered `<kovo-query>` and fragments never show pre-commit data.
  - SPEC refs: §10.3 request lifecycle.
  - Assertions: response fragment shows committed value; db and UI agree; no visible revert.
  - Evidence: `pnpm exec playwright test mutation-prg-no-js.spec.ts post-commit-rerun.spec.ts typed-error-union-multiple.spec.ts validation-field-errors.spec.ts --config=tests/integration/playwright.config.ts` passed `tests/integration/specs/post-commit-rerun.spec.ts`; assertions inspect committed `<kovo-query>`, fragment HTML, UI text, and db truth.
- [x] `fragment-targets-live-dom` / `fragment-targets-live-dom.spec.ts`: `Kovo-Targets` is collected
      from the live DOM, including islands patched in by an earlier mutation.
  - SPEC refs: §9.1 `Kovo-Targets`, §4.4 morph application.
  - Assertions: second mutation refreshes newly patched island; server holds no screen session.
  - Evidence: added `tests/integration/fixtures/fragment-targets-live-dom/app.tsx` and
    `tests/integration/specs/fragment-targets-live-dom.spec.ts`; passed the Slice F Playwright
    command recorded under `csrf-required`.
- [x] `sanitized-kovo-changes` / `sanitized-kovo-changes.spec.ts`: successful mutation responses expose
      sanitized `Kovo-Changes` domain/key summaries and never input, stack, or failure details.
  - SPEC refs: §9.1 `Kovo-Changes`.
  - Assertions: response header contains only `{domain, keys}`; sensitive input absent.
  - Evidence: added `tests/integration/fixtures/sanitized-kovo-changes/app.tsx` and
    `tests/integration/specs/sanitized-kovo-changes.spec.ts`; passed the Slice F Playwright
    command recorded under `csrf-required`.
- [x] `render-error-fragment` / `render-error-fragment.spec.ts`: a post-commit fragment/render failure
      returns HTTP 500 with `data-error-code="RENDER_ERROR"` while preserving sanitized committed
      changes.
  - SPEC refs: §9.2 unexpected failures.
  - Assertions: db write committed; response status/header semantics; UI receives stable error shell.
  - Evidence: added `tests/integration/fixtures/render-error-fragment/app.tsx` and
    `tests/integration/specs/render-error-fragment.spec.ts`; passed the Slice F Playwright command
    recorded under `csrf-required`.

## Query and update plan

- [x] `binding-text-attr` / `binding-text-attr.spec.ts`: query and local-state changes update text
      bindings and attribute bindings through `data-bind` / `data-bind:<attr>`.
  - SPEC refs: §4.8 bindings.
  - Assertions: text and attribute values update from one query response; semantic snapshot keeps
    both binding forms.
  - Evidence 2026-06-16: `packages/runtime/src/inline-loader-build.ts` applies valid
    `kovo-query` chunks from enhanced mutation responses to live `data-bind` / `data-bind:<attr>`
    bindings before fragment application, and regenerated `packages/runtime/src/inline-loader.ts`
    passes `pnpm --filter @kovojs/runtime run check:inline-loader`.
  - Evidence 2026-06-16: `tests/integration/fixtures/binding-text-attr` now returns a query-only
    mutation response for the server update, and
    `tests/integration/specs/binding-text-attr.spec.ts` asserts `<kovo-query name="card">` with no
    `<kovo-fragment>` before observing updated text/attrs. Focused command:
    `pnpm --filter @kovojs/integration-tests exec playwright test specs/binding-text-attr.spec.ts specs/query-refetch.spec.ts specs/nullable-binding.spec.ts specs/shared-query-consumers.spec.ts specs/stamp-list-insert-remove.spec.ts specs/stamp-list-reorder.spec.ts --config playwright.config.ts`
    passed `binding-text-attr`, `query-refetch`, `nullable-binding`, and `shared-query-consumers`;
    the same command failed the still-open `data-bind-list` query-only cases in
    `stamp-list-insert-remove` and `stamp-list-reorder`.
  - Evidence 2026-06-16: clean focused subset passed 4/4:
    `pnpm --filter @kovojs/integration-tests exec playwright test specs/binding-text-attr.spec.ts specs/query-refetch.spec.ts specs/nullable-binding.spec.ts specs/shared-query-consumers.spec.ts --config playwright.config.ts`.
- [x] `nullable-binding` / `nullable-binding.spec.ts`: optional path traversal with `?.` renders empty
      text/removes attributes consistently between SSR and loader update.
  - SPEC refs: §4.8 null-aware paths, §6.2 query data/bindings.
  - Assertions: initial null state and later non-null state match; later null removes attr again.
  - Evidence: `tests/integration/fixtures/nullable-binding` and
    `tests/integration/specs/nullable-binding.spec.ts` verify initial null SSR, server null/non-null
    fragment updates, inline-loader local state null/non-null updates, DB truth, and semantic
    snapshots. Proving command: `pnpm --filter @kovojs/integration-tests exec playwright test specs/query-refetch.spec.ts specs/binding-text-attr.spec.ts specs/nullable-binding.spec.ts specs/shared-query-consumers.spec.ts`.
- [x] `derive-binding` / `derive-binding.spec.ts`: a named derive lazily imports on first relevant
      query change and updates a bound attribute without dependency tracking.
  - SPEC refs: §4.8 derives.
  - Assertions: derive-driven `disabled`/`hidden` flips; module import is tied to query change.
  - Evidence: `tests/integration/fixtures/derive-binding` and
    `tests/integration/specs/derive-binding.spec.ts` verify an enhanced mutation returning only a
    query chunk updates `data-bind` text, lazily imports the named derive module on that query
    change, flips the derived `disabled` attribute, checks DB truth, and snapshots the semantic
    derive binding. Proving command:
    `pnpm exec playwright test specs/derive-binding.spec.ts specs/stamp-list-insert-remove.spec.ts specs/stamp-list-reorder.spec.ts specs/query-args-search.spec.ts specs/multi-instance-query.spec.ts --config tests/integration/playwright.config.ts --workers=1`.
- [x] `stamp-list-insert-remove` / `stamp-list-insert-remove.spec.ts`: keyed template stamps clone,
      remove, and bind item-relative paths when array data changes.
  - SPEC refs: §4.8 template stamps, §13.2 keyed identity.
  - Assertions: row count/order/text updates; `kovo-key` values stable in semantic snapshot.
  - Evidence: `tests/integration/fixtures/stamp-list-insert-remove` and
    `tests/integration/specs/stamp-list-insert-remove.spec.ts` verify query-chunk-only enhanced
    mutation responses insert and remove keyed rows through `data-bind-list="cart.items"`, update
    item-relative `.qty`/`.name` bindings, preserve stable `kovo-key` values, check DB truth, and
    snapshot the semantic list. Proving command: same Slice J command recorded under
    `derive-binding`.
- [x] `stamp-list-reorder` / `stamp-list-reorder.spec.ts`: keyed list reorder preserves DOM identity
      for existing rows while updating item-relative bindings.
  - SPEC refs: §4.8 stamps, §13.2 lists at scale.
  - Assertions: element handles survive reorder; semantic order follows server truth.
  - Evidence: `tests/integration/fixtures/stamp-list-reorder` and
    `tests/integration/specs/stamp-list-reorder.spec.ts` verify a query-chunk-only reorder moves
    keyed rows into server-truth order, updates item-relative `.rank`/`.label` bindings, preserves
    expando identity on existing keyed DOM nodes, checks DB truth, and snapshots the semantic list.
    Proving command: same Slice J command recorded under `derive-binding`.
- [ ] `multi-instance-query` / `multi-instance-query.spec.ts`: two instances of one parameterized
      query coexist on a page and update only the matching instance keys.
  - SPEC refs: §10.2 instance keys, §9.4 typed reads.
  - Assertions: `kovo-query="product:p1"` and `product:p2` stay distinct; one mutation/refetch does
    not overwrite the other.
  - Partial evidence: `tests/integration/fixtures/multi-instance-query` and
    `tests/integration/specs/multi-instance-query.spec.ts` verify two initial
    `script[kovo-query="product"][key="product:p*"]` instances coexist, a keyed mutation response
    emits only `<kovo-query name="product" key="product:p1">` plus the matching `product-p1`
    fragment, leaves the `product-p2` fragment DOM identity untouched, checks DB truth, and
    snapshots the semantic page. Proving command: same Slice J command recorded under
    `derive-binding`.
  - Gap: left unchecked because the current `CompiledQueryUpdatePlan` lookup is keyed by query name
    only, not query instance key; a pure client query-plan update cannot safely target two
    same-query instances on one page without fragment scoping.
- [x] `shared-query-consumers` / `shared-query-consumers.spec.ts`: a single query value ships once and
      updates multiple islands consuming the same `kovo-deps` key.
  - SPEC refs: §4.2 query data ships once, §10.4 optimism keyed to queries.
  - Assertions: one query script/chunk; all dependent islands update together.
  - Evidence: `tests/integration/fixtures/shared-query-consumers` and
    `tests/integration/specs/shared-query-consumers.spec.ts` verify one initial `kovo-query` script,
    one mutation response query chunk, both dependent islands updating in one enhanced mutation, DB
    truth, and a semantic snapshot. Proving command: `pnpm --filter @kovojs/integration-tests exec playwright test specs/query-refetch.spec.ts specs/binding-text-attr.spec.ts specs/nullable-binding.spec.ts specs/shared-query-consumers.spec.ts`.
- [x] `query-args-search` / `query-args-search.spec.ts`: typed read endpoint coerces query args from
      search params and returns the canonical instance key.
  - SPEC refs: §9.4 typed reads, §10.2 query args/instance key.
  - Assertions: `/_q/product?id=p1` response includes `product:p1`; invalid args fail safely.
  - Evidence: `tests/integration/fixtures/query-args-search` and
    `tests/integration/specs/query-args-search.spec.ts` verify initial route search coercion,
    defaulted args, typed read responses with canonical `product:p1` / `product:p2` chunks, and
    invalid typed-read args returning HTTP 422 JSON
    `{"code":"VALIDATION","payload":{"issues":[...]}}`. Proving commands:
    `pnpm exec vitest run packages/server/src/mutation-endpoint.test.ts packages/server/src/query-endpoint.test.ts packages/server/src/schema.test.ts` and
    `pnpm exec playwright test tests/integration/specs/validation-field-errors.spec.ts tests/integration/specs/query-args-search.spec.ts --config tests/integration/playwright.config.ts --workers=1`.
- [ ] `broadcast-channel-sync` / `broadcast-channel-sync.spec.ts`: mutation response query chunks
      rebroadcast to another same-user tab.
  - SPEC refs: §9.3 BroadcastChannel liveness.
  - Assertions: two pages share session; mutation in one tab updates the other without navigation.
  - Gap: not implemented in this slice because the fixture document shell uses the generated inline
    loader, which now applies local query chunks to text/attr bindings but still does not install the
    full `installKovoLoader` BroadcastChannel mutation rebroadcast path.

## Morph survival

- [x] `morph-focus-caret` / `morph-focus-caret.spec.ts`: fragment morph preserves focus and caret
      selection in an edited input inside or adjacent to a patched fragment.
  - SPEC refs: §9.1 morph contract, §11.4 browser-bound survival suite.
  - Assertions: active element and selection range survive; bound text still reconciles.
  - Evidence: added `tests/integration/fixtures/morph-focus-caret/app.tsx` and
    `tests/integration/specs/morph-focus-caret.spec.ts`; passed
    `pnpm --filter @kovojs/integration-tests exec playwright test specs/morph-focus-caret.spec.ts specs/fragment-append.spec.ts specs/dialog-invoker.spec.ts specs/details-disclosure.spec.ts --config playwright.config.ts`.
- [x] `morph-scroll` / `morph-scroll.spec.ts`: fragment morph preserves scroll position in a scrollable
      region that remains keyed across the patch.
  - SPEC refs: §9.1 morph contract.
  - Assertions: scrollTop survives; inserted content reconciles.
  - Evidence: added `tests/integration/fixtures/morph-scroll/app.tsx` and
    `tests/integration/specs/morph-scroll.spec.ts`; passed
    `pnpm exec playwright test --config tests/integration/playwright.config.ts morph-scroll.spec.ts patched-in-island-inert.spec.ts popover-invoker.spec.ts module-scope-shared.spec.ts`.
- [ ] `morph-nested-island-state` / `morph-nested-island-state.spec.ts`: nested island local state
      survives a parent fragment morph when the nested island identity is preserved.
  - SPEC refs: §9.1 morph contract, §4.2 component identity.
  - Assertions: local state value remains; parent query text updates.
  - Current gap: not implemented in this slice because current DOM morph syncs the server fragment's
    attributes onto matched keyed elements, so a nested island's client-owned `kovo-state` would be
    overwritten instead of preserved.
- [ ] `morph-remove-aborts` / `morph-remove-aborts.spec.ts`: removing an island through morph aborts
      its `ctx.signal` and clears pending trigger observation.
  - SPEC refs: §4.4 loader, §4.7 lifecycle.
  - Assertions: abort callback fires; no later handler side effects from removed island.
  - Gap: left unchecked because the emitted inline loader used by the integration fixture shell creates
    a fresh `AbortController().signal` per delegated event and does not retain a per-island signal
    scope that fragment removal can abort. The full `installKovoLoader` path has
    `abortRemovedIslandSignals(...)`, but this harness path cannot currently prove removal aborts.
- [x] `fragment-append` / `fragment-append.spec.ts`: `<kovo-fragment mode="append">` appends paged rows
      without replacing existing keyed content.
  - SPEC refs: §9.1 append vocabulary, §13.2 pagination.
  - Assertions: existing element identity preserved; appended rows bind correctly.
  - Evidence: added `tests/integration/fixtures/fragment-append/app.tsx` and
    `tests/integration/specs/fragment-append.spec.ts`; passed
    `pnpm --filter @kovojs/integration-tests exec playwright test specs/morph-focus-caret.spec.ts specs/fragment-append.spec.ts specs/dialog-invoker.spec.ts specs/details-disclosure.spec.ts --config playwright.config.ts`.
- [x] `patched-in-island-inert` / `patched-in-island-inert.spec.ts`: islands introduced by a fragment
      are observable by future triggers but do not eagerly import client code.
  - SPEC refs: §4.4 morph application, §9.1 patched-in islands.
  - Assertions: no import before trigger; first interaction imports and runs handler.
  - Evidence: added `tests/integration/fixtures/patched-in-island-inert` and
    `tests/integration/specs/patched-in-island-inert.spec.ts`; passed
    `pnpm exec playwright test --config tests/integration/playwright.config.ts morph-scroll.spec.ts patched-in-island-inert.spec.ts popover-invoker.spec.ts module-scope-shared.spec.ts`.

## Execution triggers and loader behavior

- [x] `on-visible` / `on-visible.spec.ts`: `on:visible` uses the shared IntersectionObserver and fires
      once on first intersection.
  - Evidence: `tests/integration/fixtures/on-visible`; `tests/integration/specs/on-visible.spec.ts`;
    passed `pnpm exec playwright test --config tests/integration/playwright.config.ts event-chain.spec.ts handler-params.spec.ts on-idle.spec.ts on-load-justified.spec.ts on-visible.spec.ts --update-snapshots`.
  - SPEC refs: §4.7 execution triggers.
  - Assertions: no handler call before scroll; one call after visibility; no repeat after re-scroll.
- [x] `on-idle` / `on-idle.spec.ts`: `on:idle` schedules warm-up work without blocking initial render.
  - Evidence: `tests/integration/fixtures/on-idle`; `tests/integration/specs/on-idle.spec.ts`;
    passed `pnpm exec playwright test --config tests/integration/playwright.config.ts event-chain.spec.ts handler-params.spec.ts on-idle.spec.ts on-load-justified.spec.ts on-visible.spec.ts --update-snapshots`.
  - SPEC refs: §4.7 execution triggers.
  - Assertions: initial UI is interactive; idle handler runs once; semantic attrs remain legible.
- [x] `on-load-justified` / `on-load-justified.spec.ts`: a lint-justified `on:load` trigger executes at
      parse and appears as the app's greppable eager-JS budget.
  - Evidence: `tests/integration/fixtures/on-load-justified`;
    `tests/integration/specs/on-load-justified.spec.ts`; passed `pnpm exec playwright test --config tests/integration/playwright.config.ts event-chain.spec.ts handler-params.spec.ts on-idle.spec.ts on-load-justified.spec.ts on-visible.spec.ts --update-snapshots`.
  - SPEC refs: §4.7 `on:load`, §16 criterion 7.
  - Assertions: handler side effect visible after page load; `on:load` attr appears in snapshot.
- [x] `event-chain` / `event-chain.spec.ts`: merged/chained `on:*` refs execute author handler first,
      primitive handler second, sequentially awaited, and `defaultPrevented` does not stop the chain.
  - Evidence: `tests/integration/fixtures/event-chain`; `tests/integration/specs/event-chain.spec.ts`;
    passed `pnpm exec playwright test --config tests/integration/playwright.config.ts event-chain.spec.ts handler-params.spec.ts on-idle.spec.ts on-load-justified.spec.ts on-visible.spec.ts --update-snapshots`.
  - SPEC refs: §4.6 merge rules, §4.4 event delegation.
  - Assertions: server/client log order; primitive no-op contract can be observed when prevented.
- [x] `handler-params` / `handler-params.spec.ts`: element `data-p-*` params are parsed/coerced and
      passed to the imported handler.
  - Evidence: `tests/integration/fixtures/handler-params`;
    `tests/integration/specs/handler-params.spec.ts`; passed `pnpm exec playwright test --config tests/integration/playwright.config.ts event-chain.spec.ts handler-params.spec.ts on-idle.spec.ts on-load-justified.spec.ts on-visible.spec.ts --update-snapshots`.
  - SPEC refs: §4.3 capture channels.
  - Assertions: handler receives string and coerced non-string params; missing param errors visibly.
- [x] `module-scope-shared` / `module-scope-shared.spec.ts`: module-scope values are shared imports,
      not captured closure state, across repeated handler invocations.
  - SPEC refs: §4.3 capture channels.
  - Assertions: handler-visible module counter/cache behaves as module scope; params remain per element.
  - Evidence: added `tests/integration/fixtures/module-scope-shared` and
    `tests/integration/specs/module-scope-shared.spec.ts`; passed
    `pnpm exec playwright test --config tests/integration/playwright.config.ts morph-scroll.spec.ts patched-in-island-inert.spec.ts popover-invoker.spec.ts module-scope-shared.spec.ts`.

## L0 platform behavior and primitives

- [x] `dialog-invoker` / `dialog-invoker.spec.ts`: declarative `commandfor`/`command` opens a dialog
      without importing client code.
  - SPEC refs: §4.2 light DOM, §5.2 platform-behavior emission, §7 L0.
  - Assertions: dialog opens; no handler network/module import; IDREF remains in semantic snapshot.
  - Evidence: added `tests/integration/fixtures/dialog-invoker/app.tsx` and
    `tests/integration/specs/dialog-invoker.spec.ts`; passed
    `pnpm --filter @kovojs/integration-tests exec playwright test specs/morph-focus-caret.spec.ts specs/fragment-append.spec.ts specs/dialog-invoker.spec.ts specs/details-disclosure.spec.ts --config playwright.config.ts`.
- [x] `popover-invoker` / `popover-invoker.spec.ts`: Popover API wiring works as light DOM and degrades
      through platform attributes.
  - SPEC refs: §4.6 behavior attributes, §7 L0.
  - Assertions: popover visible state; IDREF attrs snapshot; no custom-element upgrade.
  - Evidence: added `tests/integration/fixtures/popover-invoker/app.tsx` and
    `tests/integration/specs/popover-invoker.spec.ts`; passed
    `pnpm exec playwright test --config tests/integration/playwright.config.ts morph-scroll.spec.ts patched-in-island-inert.spec.ts popover-invoker.spec.ts module-scope-shared.spec.ts`.
- [x] `details-disclosure` / `details-disclosure.spec.ts`: native `<details>` disclosure works with no
      Kovo client handler.
  - SPEC refs: §7 L0.
  - Assertions: toggled open state; no app module import.
  - Evidence: added `tests/integration/fixtures/details-disclosure/app.tsx` and
    `tests/integration/specs/details-disclosure.spec.ts`; passed
    `pnpm --filter @kovojs/integration-tests exec playwright test specs/morph-focus-caret.spec.ts specs/fragment-append.spec.ts specs/dialog-invoker.spec.ts specs/details-disclosure.spec.ts --config playwright.config.ts`.
- [x] `primitive-as-child` / `primitive-as-child.spec.ts`: primitive attrs merge into an author-owned
      element through `asChild`/attrs-function lowering.
  - SPEC refs: §4.6 primitive composition.
  - Assertions: one emitted element; merged class/style/ARIA/handler attrs; semantic snapshot.
  - Evidence: added `tests/integration/fixtures/primitive-as-child/app.tsx`,
    `tests/integration/fixtures/primitive-as-child/card.tsx`, and
    `tests/integration/specs/primitive-as-child.spec.ts`; passed
    `pnpm exec playwright test tests/integration/specs/primitive-as-child.spec.ts --config tests/integration/playwright.config.ts`.
- [ ] `primitive-id-author-wins` / `primitive-id-author-wins.spec.ts`: when an author id wins, primitive
      IDREFs are rewired to the surviving id.
  - SPEC refs: §4.6 merge rules, §6.2 IDREFs.
  - Assertions: runtime relationship works; snapshot shows final id/IDREF values.
  - Gap: a focused fixture probe using plain primitive attrs records left the authored dialog closed
    after trigger activation, so the current integration/compiler path is not yet rewriting the
    cross-element `commandfor`/`aria-controls` IDREFs needed by SPEC.md §4.6.
- [ ] `primitive-state-attrs` / `primitive-state-attrs.spec.ts`: primitive-owned `data-state` updates
      on interaction and author static overrides do not break runtime state.
  - SPEC refs: §4.6 merge rules, §12.1 accessibility conformance.
  - Assertions: `data-state`/ARIA state terminal values; axe-clean terminal state if axe helper lands.
  - Gap: the integration fixture path can lower stateless primitive `asChild` merges, but the
    attempted stateful primitive-composition probe hit unsupported fixture/compiler edges before the
    browser assertions ran, so this remains open pending a supported stateful primitive integration
    surface.

## Composition, slots, and component identity

- [x] `children-render-time` / `children-render-time.spec.ts`: children and named slots render once on
      the server as ordinary HTML with no client projection runtime.
  - SPEC refs: §4.5 composition.
  - Assertions: slotted content in initial HTML; no client re-render needed for static slot content.
  - Evidence: added `tests/integration/fixtures/children-render-time` and
    `tests/integration/specs/children-render-time.spec.ts`; passed
    `pnpm --filter @kovojs/integration-tests exec playwright test specs/children-render-time.spec.ts specs/layout-function-composition.spec.ts specs/native-host-kovo-c.spec.ts --config playwright.config.ts --workers=1`.
- [ ] `fragment-slot-hoist` / `fragment-slot-hoist.spec.ts`: fragment-target children that capture only
      serializable stamped props re-render in the fragment response.
  - SPEC refs: §4.5 fragment-target children, §9.1 fragments.
  - Assertions: slot subtree updates after mutation; semantic snapshot includes hoisted child output.
  - Gap: left unchecked because current integration fixture components still expose
    `definition.render(queries, state)` rather than the SPEC §4.5 third `Html` composition
    argument, and the fixture compiler does not emit fragment slot-hoist render metadata for
    mutation fragment responses. Compiler-only acceptance/diagnostic coverage exists in
    `packages/compiler/src/fragment-targets.test.ts`.
- [x] `layout-function-composition` / `layout-function-composition.spec.ts`: route-level layout
      composition renders a full document per navigation without persistent layout state.
  - SPEC refs: §4.5 layouts, §8 MPA spine.
  - Assertions: layout wraps two routes; navigation is a real document load; state does not persist.
  - Evidence: added `tests/integration/fixtures/layout-function-composition` and
    `tests/integration/specs/layout-function-composition.spec.ts`; passed
    `pnpm --filter @kovojs/integration-tests exec playwright test specs/children-render-time.spec.ts specs/layout-function-composition.spec.ts specs/native-host-kovo-c.spec.ts --config playwright.config.ts --workers=1`.
- [x] `native-host-kovo-c` / `native-host-kovo-c.spec.ts`: native hosts such as table rows use
      `kovo-c` instead of illegal dashed custom elements.
  - SPEC refs: §4.2 rendered output, KV225 content model.
  - Assertions: valid parsed table DOM; component identity present as `kovo-c`.
  - Evidence: added `tests/integration/fixtures/native-host-kovo-c` and
    `tests/integration/specs/native-host-kovo-c.spec.ts`; passed
    `pnpm --filter @kovojs/integration-tests exec playwright test specs/children-render-time.spec.ts specs/layout-function-composition.spec.ts specs/native-host-kovo-c.spec.ts --config playwright.config.ts --workers=1`.
  - Gap: the browser fixture proves current native-host stamping on a valid table host. A
    standalone row-root component still fails current integration compilation with KV225, so
    row-root identity remains covered only by compiler-level composition tests.
- [ ] `same-dom-leaf-disambiguation` / `same-dom-leaf-disambiguation.spec.ts`: two registry-distinct
      components with the same DOM leaf on one page get stable disambiguated `kovo-c` values.
  - SPEC refs: §4.2 rendered output, §6.1 component registry keys.
  - Assertions: both render and update independently; explain output may be better suited for the
    disambiguation reason while browser snapshot proves emitted identity.
  - Gap: left unchecked because current browser integration compiles fixture component modules one
    at a time and does not run `composePageComponentArtifacts`, where duplicate DOM leaf
    disambiguation is currently implemented and covered by `packages/compiler/src/page-composition.test.ts`.

## Routes and navigation

- [x] `typed-link-navigation` / `typed-link-navigation.spec.ts`: `<Link>`/`href()` lowers to plain
      anchors that perform real navigations and carry path/search params.
  - SPEC refs: §6.4 routes and links, §8 no client router.
  - Assertions: anchor `href` is readable; browser navigation loads new document; no router runtime.
  - Evidence: `pnpm exec playwright test tests/integration/specs/typed-link-navigation.spec.ts
    tests/integration/specs/get-form-search.spec.ts
    tests/integration/specs/trailing-slash-308.spec.ts
    tests/integration/specs/guarded-query-read.spec.ts
    tests/integration/specs/forbidden-route.spec.ts --config tests/integration/playwright.config.ts`
    passed on 2026-06-16; `tests/integration/specs/typed-link-navigation.spec.ts` asserts
    readable `Link()`/`href()` anchor hrefs and document navigation to typed path/search targets.
- [x] `get-form-search` / `get-form-search.spec.ts`: GET forms write typed route search params and
      refresh route/query output through normal navigation or fragment response.
  - SPEC refs: §6.4 GET forms, §7 URL coordination, §9.4 typed reads.
  - Assertions: URL search changes; rendered result matches coerced search schema.
  - Evidence: same Playwright command passed on 2026-06-16; `tests/integration/specs/get-form-search.spec.ts`
    asserts GET form URL search params and server-rendered coerced search output.
- [x] `redirect-typed-target` / `redirect-typed-target.spec.ts`: a mutation follows a typed
      POST-redirect-GET target with params/search and lands on the expected route.
  - SPEC refs: §6.4 redirect, §9.1 no-JS behavior.
  - Assertions: response status/location; final page semantic content.
  - Evidence: added `tests/integration/fixtures/redirect-typed-target/app.tsx` and
    `tests/integration/specs/redirect-typed-target.spec.ts`; the no-JS POST returns `303 Location:
    /orders/ord-42?source=mutation&tab=receipt` from `redirect('/orders/:id', ...)`, and the final
    route renders the typed params/search content. Proving command: the Slice I Playwright command
    recorded under `query-args-search`.
- [x] `trailing-slash-308` / `trailing-slash-308.spec.ts`: trailing slashes normalize before matching.
  - SPEC refs: §9.5 request shell.
  - Assertions: direct request receives 308; canonical route renders once followed.
  - Evidence: same Playwright command passed on 2026-06-16; `tests/integration/specs/trailing-slash-308.spec.ts`
    asserts direct 308 `Location` and followed canonical route rendering.
- [x] `speculation-rules-opt-in` / `speculation-rules-opt-in.spec.ts`: only routes declaring prefetch
      emit speculation rules, and routes default to no speculation script.
  - SPEC refs: §8 Speculation Rules.
  - Assertions: opted-in page includes one `type="speculationrules"` script; default page does not.
  - Evidence: added `tests/integration/fixtures/speculation-rules-opt-in/app.tsx` and
    `tests/integration/specs/speculation-rules-opt-in.spec.ts`; the default route renders with no
    speculation script, while the opted-in route emits exactly one `type="speculationrules"` tag
    containing the route-owned conservative prerender URLs. Proving command:
    `pnpm --filter @kovojs/integration-tests exec playwright test specs/speculation-rules-opt-in.spec.ts specs/view-transition-names.spec.ts specs/bfcache-hygiene.spec.ts --config playwright.config.ts --workers=1`.
- [x] `view-transition-names` / `view-transition-names.spec.ts`: matching route templates emit stable
      `view-transition-name` props for cross-document transitions.
  - SPEC refs: §8 View Transitions, KV239.
  - Assertions: source/destination pages expose matching names; duplicate static names remain a
    compiler test outside this browser case.
  - Evidence: added `tests/integration/fixtures/view-transition-names/` and
    `tests/integration/specs/view-transition-names.spec.ts`; the catalog and detail route documents
    both emit matching static `view-transition-name` CSS (`product-photo`, `product-title`) through
    the public fixture compiler/render path, and the browser navigation preserves those emitted
    names on both sides of the document load. Proving command: same Playwright command recorded
    under `speculation-rules-opt-in`.
- [ ] `bfcache-hygiene` / `bfcache-hygiene.spec.ts`: navigating away/back does not rely on unload and
      refetch/optimistic state resumes from server truth.
  - SPEC refs: §8 bfcache hygiene, §9.3 refetch.
  - Assertions: `pageshow.persisted` when supported; no stale pending optimism after back.
  - Partial evidence: added `tests/integration/fixtures/bfcache-hygiene/app.tsx` and
    `tests/integration/specs/bfcache-hygiene.spec.ts`; the public inline-loader route path
    registers no `unload`/`beforeunload` listeners during page boot and enhanced mutation fetches
    carry `keepalive: true`, both verified in-browser via init-script instrumentation. Proving
    command: same Playwright command recorded under `speculation-rules-opt-in`.
  - Gap: left unchecked because the public app/render path still ships the minified inline loader
    from `packages/runtime/src/inline-loader.ts`, which does not currently emit the runtime
    package's `pagehide` optimism cleanup or focus/visibility typed-read refetch lifecycle hooks;
    without those browser-path hooks there is no honest integration proof yet for
    `pageshow.persisted` recovery or stale-optimism discard after Back/Forward navigation.

## Auth, guards, sessions, and authorization audits

- [x] `guarded-query-read` / `guarded-query-read.spec.ts`: query guards run on initial page render and
      on every `/_q` typed read.
  - SPEC refs: §6.5 guard failures, §9.4 typed reads, §10.2 queries.
  - Assertions: anonymous `/_q` denies/redirects safely; signed-in read succeeds.
  - Evidence: same Playwright command passed on 2026-06-16; `tests/integration/specs/guarded-query-read.spec.ts`
    asserts anonymous route/`/_q` denial and signed-in route/typed-read success.
- [x] `guarded-mutation` / `guarded-mutation.spec.ts`: mutation guards fail before transaction/write
      execution and return the typed enhanced error path.
  - SPEC refs: §6.5 mutation guard failures, §10.3 request lifecycle.
  - Assertions: anonymous enhanced POST does not change db; signed-in POST does.
  - Evidence: added `tests/integration/fixtures/guarded-mutation/app.tsx` and
    `tests/integration/specs/guarded-mutation.spec.ts`; anonymous enhanced submit returns a
    `data-error-code="UNAUTHORIZED"` fragment and leaves `guarded_counter.count = 0`, while the
    signed-in submit morphs the count and updates server truth to 1. Proving command: the Slice I
    Playwright command recorded under `query-args-search`.
- [x] `forbidden-route` / `forbidden-route.spec.ts`: authenticated-but-unauthorized route access renders
      the configured 403 shell with status 403.
  - SPEC refs: §6.5 route/query guard failures, §9.5 error shells.
  - Assertions: status 403; no protected data; semantic snapshot of shell.
  - Evidence: `packages/server/src/app-document.test.ts` verifies route guard forbidden failures are
    rendered through `createApp({ errorShells.forbidden })` without protected content. Updated
    `tests/integration/fixtures/forbidden-route` and
    `tests/integration/specs/forbidden-route.spec.ts` verify authenticated-but-unauthorized access
    returns status 403 with the configured shell and no `[data-secret]`, while an admin session
    reaches the guarded page. Proving commands: the focused vitest and Playwright commands recorded
    under `custom-document-template`.
- [x] `session-provider-once` / `session-provider-once.spec.ts`: request shell resolves
      `sessionProvider` once before route/query/mutation guards.
  - SPEC refs: §6.5 sessions, §9.5 request shell.
  - Assertions: instrumentation counter per request; route/query/mutation see same session value.
  - Evidence: added `tests/integration/fixtures/session-provider-once/app.tsx` and
    `tests/integration/specs/session-provider-once.spec.ts`; route, query, and mutation requests each
    record exactly one `provider` event before their guarded work, and every guard/handler observes
    the same `user-<case>` session subject. Proving command: the Slice I Playwright command recorded
    under `query-args-search`.
- [x] `session-null-anonymous` / `session-null-anonymous.spec.ts`: a provider returning null/undefined is
      treated as anonymous, not malformed session data.
  - SPEC refs: §6.5 session schema.
  - Assertions: anonymous shell/redirect path; no server 500.
  - Evidence: added `tests/integration/fixtures/session-null-anonymous/app.tsx` and
    `tests/integration/specs/session-null-anonymous.spec.ts`; both null and undefined provider
    results render the public anonymous shell and send guarded route access through the 303 login
    redirect without a server error, while a real session reaches the guarded route. Proving command:
    the Slice I Playwright command recorded under `query-args-search`.
- [x] `unscoped-owner-fixture` / `unscoped-owner-fixture.spec.ts`: an owner-scoped table/query path
      renders only rows tied to `req.session` and rejects cross-user access at request time.
  - SPEC refs: §10.1 owner annotations, §10.3 unscoped audit.
  - Assertions: two sessions see distinct rows; direct query/read cannot fetch another owner.
  - Evidence: added `tests/integration/fixtures/unscoped-owner-fixture/app.tsx` and
    `tests/integration/specs/unscoped-owner-fixture.spec.ts`; anonymous access redirects, session
    `u1` renders only `inv-u1`, cross-owner route access renders a not-found shell without `u2`
    data, and the typed read endpoint returns `{"invoice":null}` for `u1` reading `inv-u2`.
    Proving command:
    `pnpm exec playwright test unscoped-owner-fixture.spec.ts webhook-hmac.spec.ts webhook-idempotency.spec.ts --config tests/integration/playwright.config.ts --workers=1`.

## Data-plane verification edges

- [ ] `touch-graph-runtime-crosscheck` / `touch-graph-runtime-crosscheck.spec.ts`: an executed write's
      observed domains are within the static touch set and the integration harness fails loudly on a
      smuggled write.
  - SPEC refs: §11.1 touch extraction, §11.2 runtime verification.
  - Assertions: positive fixture passes; intentionally bad fixture can be a skipped/expected-fail spec
    if the harness supports failure cases.
  - Gap: public Playwright fixtures attach only `request.db` and `createRequestHandler(app)`; they do
    not accept the `createKovoTestHarness({ touchGraph, verification })` verifier options used by
    `packages/test/src/harness-verifier.test.ts` and `packages/test/src/pglite-harness.test.ts`, so a
    browser fixture cannot honestly assert runtime touch-graph failure yet.
- [ ] `manual-touches-raw-write` / `manual-touches-raw-write.spec.ts`: a statically opaque write with
      declared touches refreshes the right query and remains runtime-verified.
  - SPEC refs: §10.3 manual touches, §11.1 KV406.
  - Assertions: raw write changes db; invalidated query/fragment updates; diagnostics are visible.
  - Gap: integration fixtures can assert raw DB writes and change headers, but cannot currently inject
    static KV406/manual-touch coverage into the request verifier; leave open until the integration
    harness exposes verifier metadata or a compiled touch graph artifact.
- [ ] `table-level-invalidation` / `table-level-invalidation.spec.ts`: non-eq predicates degrade to
      table-level invalidation and refresh all affected query instances.
  - SPEC refs: §11.1 KV409, §10.1 row-level keys.
  - Assertions: multiple instances refresh; explain/diagnostic assertion may be browser-free.
  - Gap: row/table-level degradation is covered in Drizzle extraction units, but the current
    integration runner has no public path from fixture source to a KV409 diagnostic/explain artifact
    for a browser-served fixture.
- [ ] `query-readset-runtime-crosscheck` / `query-readset-runtime-crosscheck.spec.ts`: query loaders'
      observed SELECT/JOIN tables match derived read sets during integration runs.
  - SPEC refs: §10.2 queries, §11.2 runtime verification.
  - Assertions: positive fixture passes; bad raw read fixture fails through harness diagnostics if
    failure-case support exists.
  - Gap: read-side verifier assertions exist in the package-level harness, but fixture dispatch does
    not expose observed SELECT/JOIN readsets or a way to install expected readset metadata for
    Playwright requests.
- [ ] `opaque-projection-schema` / `opaque-projection-schema.spec.ts`: raw/`sql<T>` projections with a
      declared output schema render when observed rows match and fail when runtime shape drifts.
  - SPEC refs: §10.2 KV410, §11.2 runtime shape verification.
  - Assertions: matching projection binds in UI; drift fixture reports KV410 without leaking internals.
  - Gap: query `output` schemas can be exercised through typed-read endpoints, but KV410 is a
    compiler/Drizzle opaque-projection diagnostic and no integration fixture hook currently surfaces
    that artifact for raw/`sql<T>` projection source.
- [ ] `exempt-table-read-fails` / `exempt-table-read-fails.spec.ts`: a query reading an exempt table is
      rejected because exemptions are write-side only.
  - SPEC refs: §10.1 KV411, §11.2 runtime verification.
  - Assertions: served request fails with teaching diagnostic; no stale UI path.
  - Gap: `packages/test/src/verifier.test.ts` proves KV411 in the verifier, but browser fixtures do not
    accept `verification.exemptTables` or expose the verifier failure as a served diagnostic.

## Endpoints, webhooks, files, and streams

- [x] `endpoint-raw-request` / `endpoint-raw-request.spec.ts`: declared `endpoint()` receives raw
      `Request`, handles exact/prefix paths, and is visible apart from route matching.
  - SPEC refs: §9.1 endpoints, §9.5 dispatch order.
  - Assertions: endpoint response wins before route table; cookies/session are not ambient.
  - Evidence: `tests/integration/fixtures/endpoint-raw-request` and
    `tests/integration/specs/endpoint-raw-request.spec.ts` verify raw body/header handling,
    exact/prefix endpoint dispatch, route-table separation, and no ambient endpoint session.
    Proving command:
    `pnpm exec playwright test endpoint-raw-request endpoint-csrf-exempt-audited respond-file respond-stream storage-download-route --config tests/integration/playwright.config.ts --workers=1`.
- [x] `endpoint-csrf-exempt-audited` / `endpoint-csrf-exempt-audited.spec.ts`: a CSRF-exempt endpoint
      requires named justification and does not share browser mutation semantics.
  - SPEC refs: §9.1 endpoints, §11.4 endpoint audit.
  - Assertions: request succeeds only through endpoint auth path; audit snapshot may be
    browser-free but fixture proves dispatch.
  - Evidence: `tests/integration/fixtures/endpoint-csrf-exempt-audited` and
    `tests/integration/specs/endpoint-csrf-exempt-audited.spec.ts` verify CSRF-token-free
    machine-ingress dispatch and assert the public `kovoExplain(..., { endpoints: true })` audit
    line with verifier auth plus the exemption justification. Proving command:
    `pnpm exec playwright test endpoint-raw-request endpoint-csrf-exempt-audited respond-file respond-stream storage-download-route --config tests/integration/playwright.config.ts --workers=1`.
- [x] `webhook-hmac` / `webhook-hmac.spec.ts`: `webhook()` verifies raw bytes with HMAC, parses loose
      input, writes through domain writes, and emits a unified change record.
  - SPEC refs: §9.1 webhook, verifier kit.
  - Assertions: valid signature writes once; invalid signature rejected before parse/write.
  - Evidence: added `tests/integration/fixtures/webhook-hmac/app.tsx` and
    `tests/integration/specs/webhook-hmac.spec.ts`; a signed raw JSON POST writes provider data from
    a loose extra field, returns `Kovo-Idem` plus sanitized `Kovo-Changes`, and a tampered signature
    over invalid JSON returns 401 before parse/write. Proving command:
    `pnpm exec playwright test unscoped-owner-fixture.spec.ts webhook-hmac.spec.ts webhook-idempotency.spec.ts --config tests/integration/playwright.config.ts --workers=1`.
- [x] `webhook-idempotency` / `webhook-idempotency.spec.ts`: repeated provider event ids replay the
      stored webhook response without re-executing the handler.
  - SPEC refs: §9.1 webhook lifecycle.
  - Assertions: duplicate signed request returns same response; db changes once.
  - Evidence: added `tests/integration/fixtures/webhook-idempotency/app.tsx` and
    `tests/integration/specs/webhook-idempotency.spec.ts`; two signed deliveries with the same
    provider event id return the same 200/`Kovo-Idem`/`Kovo-Changes` response while the DB records one
    handler execution. Proving command:
    `pnpm exec playwright test unscoped-owner-fixture.spec.ts webhook-hmac.spec.ts webhook-idempotency.spec.ts --config tests/integration/playwright.config.ts --workers=1`.
- [x] `respond-file` / `respond-file.spec.ts`: a guarded route returns `respond.file()` with required
      content type, attachment disposition default, and ETag/304 support.
  - SPEC refs: §6.4 file outcomes.
  - Assertions: body/header/status semantics; `If-None-Match` returns 304; guard still applies.
  - Evidence: `tests/integration/fixtures/respond-file` and
    `tests/integration/specs/respond-file.spec.ts` verify unauthenticated guard redirect,
    authorized CSV body, attachment disposition, content type, ETag, nosniff, and 304 on
    `If-None-Match`. Proving commands:
    `pnpm exec playwright test endpoint-raw-request endpoint-csrf-exempt-audited respond-file respond-stream storage-download-route --config tests/integration/playwright.config.ts --workers=1`
    and `pnpm exec vitest run packages/server/src/response.test.ts packages/server/src/route-response.test.ts`.
- [x] `respond-stream` / `respond-stream.spec.ts`: a guarded route returns `respond.stream()` with
      declared content type/disposition and can opt into inline display.
  - SPEC refs: §6.4 stream outcomes.
  - Assertions: streamed body arrives; headers match declaration; guard still applies.
  - Evidence: `tests/integration/fixtures/respond-stream` and
    `tests/integration/specs/respond-stream.spec.ts` verify unauthenticated guard redirect plus an
    authorized streamed body with declared inline disposition, content type, and nosniff. Proving
    command:
    `pnpm exec playwright test endpoint-raw-request endpoint-csrf-exempt-audited respond-file respond-stream storage-download-route --config tests/integration/playwright.config.ts --workers=1`.
- [x] `storage-download-route` / `storage-download-route.spec.ts`: file storage capability serves a
      row-authorized object while rejecting path traversal and cross-owner reads.
  - SPEC refs: §13.5 storage capability.
  - Assertions: authorized download succeeds; escaped key/cross-owner request fails safely.
  - Evidence: `tests/integration/fixtures/storage-download-route` and
    `tests/integration/specs/storage-download-route.spec.ts` verify a guarded DB-authorized
    download over `createMemoryStorage`, cross-owner 404 without leaked bytes, and a DB row with an
    escaped storage key failing safely through the storage capability. Proving command:
    `pnpm exec playwright test endpoint-raw-request endpoint-csrf-exempt-audited respond-file respond-stream storage-download-route --config tests/integration/playwright.config.ts --workers=1`.

## Streaming and deferred content

- [ ] `kovo-defer-initial-stream` / `kovo-defer-initial-stream.spec.ts`: `<kovo-defer>` renders a
      fallback, streams the real fragment later in the same response, and morphs it in.
  - SPEC refs: §8 out-of-order streaming, §13.3 streaming details.
  - Assertions: fallback visible first; final content replaces it; query JSON arrives before/with
    consumers.
  - Gap: public `renderDeferredDocument`/`renderDeferredStream` can produce the wire artifact and the
    runtime exposes stream-apply helpers, but the current inline loader does not consume initial
    document stream boundaries in the browser, so the fallback-then-morph integration assertion is
    not yet expressible through the public harness.
- [ ] `deferred-fragment-styles` / `deferred-fragment-styles.spec.ts`: late fragments request or reuse
      required styles without duplicating per-page CSS.
  - SPEC refs: §13.1 CSS, §13.3 streaming details.
  - Assertions: styled deferred content appears correctly; stylesheet hints remain deduped.
- [x] `static-export-l0-l1` / `static-export-l0-l1.spec.ts`: an exportable L0/L1 route replays through
      the same handler and writes HTML plus immutable client modules.
  - SPEC refs: §9.5 static export.
  - Assertions: exported document opens and preserves L0/L1 behavior; no second render path.
  - Evidence: `tests/integration/fixtures/static-export-l0-l1` and
    `tests/integration/specs/static-export-l0-l1.spec.ts` verify `exportStaticApp()` writes three
    route documents plus referenced immutable `/c/` client modules, serves the exported tree through
    a static file server for anchor/form L0/L1 navigation, and proves no second render path by
    checking the route render counter is unchanged after static serving. Proving command:
    `pnpm exec playwright test static-export-l0-l1.spec.ts static-export-rejects-dynamic.spec.ts diagnostic-dev-document.spec.ts diagnostic-warning-nonblocking.spec.ts explain-artifact-smoke.spec.ts --config tests/integration/playwright.config.ts --workers=1`.
- [x] `static-export-rejects-dynamic` / `static-export-rejects-dynamic.spec.ts`: guarded or mutation-only
      routes fail/skip static export loudly according to policy.
  - SPEC refs: §9.5 KV229.
  - Assertions: export command reports KV229; no misleading partial artifact.
  - Evidence: `tests/integration/fixtures/static-export-rejects-dynamic` and
    `tests/integration/specs/static-export-rejects-dynamic.spec.ts` verify guarded and unenumerated
    param routes reject with KV229 and leave no misleading partial HTML artifacts. Proving command:
    `pnpm exec playwright test static-export-l0-l1.spec.ts static-export-rejects-dynamic.spec.ts diagnostic-dev-document.spec.ts diagnostic-warning-nonblocking.spec.ts explain-artifact-smoke.spec.ts --config tests/integration/playwright.config.ts --workers=1`.

## CSS and assets

- [ ] `tailwind-fragment-css` / `tailwind-fragment-css.spec.ts`: utility classes used only in mutation
      fragments/deferred fragments are present in built CSS through the declared source/safelist
      contract.
  - SPEC refs: §13.1 CSS.
  - Assertions: fragment renders with expected computed style; stylesheet asset included once.
  - Partial evidence: `tests/integration/fixtures/tailwind-fragment-css` and
    `tests/integration/specs/tailwind-fragment-css.spec.ts` verify an enhanced mutation fragment can
    carry a deduped late stylesheet link, the linked `/assets/fragment.css` asset is served, and the
    browser applies the fragment-only class styles after morph. Proving command:
    `pnpm exec playwright test specs/tailwind-fragment-css.spec.ts --config
    tests/integration/playwright.config.ts --workers=1`.
  - Gap: left unchecked because this fixture uses a prebuilt CSS asset; it does not prove Tailwind
    source scanning or safelist generation for classes that exist only in mutation/deferred
    fragments.
- [ ] `scoped-component-css` / `scoped-component-css.spec.ts`: co-located component CSS is scoped to the
      derived host leaf, donut-scopes nested islands out, and dedupes in page order.
  - SPEC refs: §4.2 rendered output, §13.1 CSS.
  - Assertions: host style applies; nested island not accidentally styled; only one stylesheet hint.
- [ ] `fragment-style-metadata` / `fragment-style-metadata.spec.ts`: a fragment target rendered after
      initial load can request styles keyed by registry metadata.
  - SPEC refs: §13.1 CSS, §9.1 fragments.
  - Assertions: late component has styles; no duplicate or missing CSS asset.

## Diagnostics surfaced through integration

- [x] `diagnostic-dev-document` / `diagnostic-dev-document.spec.ts`: a dev-mode page depending on a
      module with an error-severity diagnostic returns a server-rendered teaching-error document.
  - SPEC refs: §11.3 diagnostic severity surface.
  - Assertions: HTTP 500; code/message/help visible; no partial app output.
  - Evidence: `tests/integration/fixtures/diagnostic-dev-document` and
    `tests/integration/specs/diagnostic-dev-document.spec.ts` use the public
    `@kovojs/server/app-shell/vite` dev diagnostic ledger/plugin to record a KV225 module error,
    then verify the route returns HTTP 500 with diagnostic code/location/help and no partial app
    body. Proving command:
    `pnpm exec playwright test static-export-l0-l1.spec.ts static-export-rejects-dynamic.spec.ts diagnostic-dev-document.spec.ts diagnostic-warning-nonblocking.spec.ts explain-artifact-smoke.spec.ts --config tests/integration/playwright.config.ts --workers=1`.
- [x] `diagnostic-warning-nonblocking` / `diagnostic-warning-nonblocking.spec.ts`: warn/lint/notice
      diagnostics are surfaced through the non-blocking channel but do not block serving.
  - SPEC refs: §11.3 diagnostic severity surface.
  - Assertions: page renders; diagnostic is observable in captured logs/channel.
  - Evidence: `tests/integration/fixtures/diagnostic-warning-nonblocking` and
    `tests/integration/specs/diagnostic-warning-nonblocking.spec.ts` verify a lint diagnostic
    recorded through the public dev diagnostic ledger does not block serving and remains observable
    through `allDiagnosticsForModuleHref()` / `allDiagnosticsForFile()` without being returned by
    the blocking `diagnosticsForModuleHref()` lookup. Server coverage in
    `packages/server/src/vite-dev.test.ts` verifies the same non-blocking channel and replacement
    semantics when a later error diagnostic supersedes a lint record. Proving commands:
    `pnpm exec vitest run packages/server/src/vite-dev.test.ts
    packages/server/src/vite-diagnostics.test.ts`; `pnpm exec playwright test
    tests/integration/specs/diagnostic-warning-nonblocking.spec.ts --config
    tests/integration/playwright.config.ts --workers=1`.
- [ ] `fixpoint-render-equivalence-fixture` / `fixpoint-render-equivalence-fixture.spec.ts`: a fixture
      that imports emitted/lowered IR renders byte/semantic-equivalent HTML to source TSX.
  - SPEC refs: §5.2 fixpoint + render-equivalence, §4.8 hand-written stamps.
  - Assertions: semantic snapshots match; compiler-only byte equality can remain in unit tests.
- [x] `explain-artifact-smoke` / `explain-artifact-smoke.spec.ts`: a browser-driven behavior has a
      matching stable `kovo explain` graph for component/mutation/query intent.
  - SPEC refs: §5.3 explain, §11.4 verification surface.
  - Assertions: UI behavior passes; explain output snapshot names the same handlers, queries, and
    invalidated consumers.
  - Evidence: `tests/integration/fixtures/explain-artifact-smoke` and
    `tests/integration/specs/explain-artifact-smoke.spec.ts` drive the cart mutation in a browser,
    then assert public `kovoExplain()` component and mutation output names the matching handler,
    query, fragment, page, mutation, and invalidated consumer graph. Proving command:
    `pnpm exec playwright test static-export-l0-l1.spec.ts static-export-rejects-dynamic.spec.ts diagnostic-dev-document.spec.ts diagnostic-warning-nonblocking.spec.ts explain-artifact-smoke.spec.ts --config tests/integration/playwright.config.ts --workers=1`.

## Accessibility states worth proving in this suite

- [x] `a11y-dialog-terminal` / `a11y-dialog-terminal.spec.ts`: dialog/sheet/drawer terminal open state
      is axe-clean and keeps correct role/name/focus semantics.
  - SPEC refs: §12.1 accessibility conformance.
  - Assertions: visible top-layer DOM is checked; semantic snapshot includes role/name/state.
  - Evidence: `tests/integration/fixtures/a11y-dialog-terminal` and
    `tests/integration/specs/a11y-dialog-terminal.spec.ts` verify a native dialog invoker reaches
    terminal open state with an accessible dialog name, focused close control, and semantic snapshot
    coverage of `command`, `commandfor`, `id`, and `open`; `tests/integration/specs/a11y-axe.ts`
    injects `axe-core` and asserts zero violations in the terminal state. Proving command: the
    accessibility Playwright command recorded under `a11y-value-controls-terminal`.
- [x] `a11y-tabs-terminal` / `a11y-tabs-terminal.spec.ts`: tabs selected state is axe-clean after
      interaction and state attrs update.
  - SPEC refs: §12.1 accessibility conformance.
  - Assertions: selected tab/panel semantics; axe terminal check.
  - Evidence: `tests/integration/fixtures/a11y-tabs-terminal` and
    `tests/integration/specs/a11y-tabs-terminal.spec.ts` verify interaction-driven selected tab
    state, focus, panel relationship, `aria-selected`, `data-state`, semantic snapshot coverage,
    and zero axe violations. Proving command: the accessibility Playwright command recorded under
    `a11y-value-controls-terminal`.
- [x] `a11y-menu-terminal` / `a11y-menu-terminal.spec.ts`: menu/command terminal open and item active
      states are axe-clean.
  - SPEC refs: §12.1 accessibility conformance.
  - Assertions: open surface is visible DOM; role/name/aria state snapshot.
  - Evidence: `tests/integration/fixtures/a11y-menu-terminal` and
    `tests/integration/specs/a11y-menu-terminal.spec.ts` verify terminal expanded trigger state,
    visible named menu, focused active menuitem, semantic snapshot coverage, and zero axe
    violations. Proving command: the accessibility Playwright command recorded under
    `a11y-value-controls-terminal`.
- [x] `a11y-form-error-terminal` / `a11y-form-error-terminal.spec.ts`: validation/error state is
      axe-clean after enhanced mutation failure.
  - SPEC refs: §9.2 errors, §12.1 accessibility conformance.
  - Assertions: field references error text; `aria-invalid`/`data-error-path`; axe terminal check.
  - Evidence: `tests/integration/fixtures/a11y-form-error-terminal` and
    `tests/integration/specs/a11y-form-error-terminal.spec.ts` verify an enhanced mutation failure
    morphs a field-scoped error state with `aria-invalid`, `aria-describedby`, `role="alert"`,
    `data-error-code`, `data-error-path`, a semantic snapshot, and zero axe violations. Proving
    command: the accessibility Playwright command recorded under `a11y-value-controls-terminal`.
- [x] `a11y-value-controls-terminal` / `a11y-value-controls-terminal.spec.ts`: slider/number-field/OTP
      value end-states are axe-clean if those primitive fixtures are available.
  - SPEC refs: §12.1 accessibility conformance.
  - Assertions: terminal value semantics; axe terminal check; unsupported primitive families remain
    unimplemented until the package exists.
  - Evidence: `tests/integration/fixtures/a11y-value-controls-terminal` and
    `tests/integration/specs/a11y-value-controls-terminal.spec.ts` verify native slider,
    spinbutton, and OTP-like textbox names/values plus a semantic snapshot of value-control attrs.
    The shared `tests/integration/specs/a11y-axe.ts` helper injects `axe-core` and asserts zero
    violations for every accessibility terminal-state spec. Proving command for all accessibility
    cases:
    `pnpm exec playwright test specs/a11y-dialog-terminal.spec.ts specs/a11y-tabs-terminal.spec.ts
    specs/a11y-menu-terminal.spec.ts specs/a11y-form-error-terminal.spec.ts
    specs/a11y-value-controls-terminal.spec.ts --config tests/integration/playwright.config.ts
    --workers=1`.

## Suggested implementation batches

- [ ] Batch A: finish first-wave gaps from `plans/integration-test-suite.md` I3:
      `query-refetch`, `optimistic-success`, `optimistic-rollback`, `enhanced-submit-controls`, and
      `loader-lifecycle`.
- [ ] Batch B: add update-plan fixtures:
      `binding-text-attr`, `nullable-binding`, `derive-binding`, `stamp-list-insert-remove`,
      `stamp-list-reorder`, and `multi-instance-query`.
- [ ] Batch C: add morph-survival fixtures:
      `morph-focus-caret`, `morph-scroll`, `morph-nested-island-state`, `morph-remove-aborts`, and
      `fragment-append`.
- [ ] Batch D: add route/auth fixtures:
      `typed-link-navigation`, `get-form-search`, `redirect-typed-target`, `guarded-query-read`,
      `guarded-mutation`, and `forbidden-route`.
- [ ] Batch E: add data-plane and wire-hardening fixtures:
      `csrf-required`, `idempotent-mutation`, `post-commit-rerun`,
      `touch-graph-runtime-crosscheck`, `manual-touches-raw-write`, and
      `query-readset-runtime-crosscheck`.
- [ ] Batch F: add endpoints/files/streaming/static-export fixtures once the corresponding public APIs
      are stable enough for browser/server integration coverage.
