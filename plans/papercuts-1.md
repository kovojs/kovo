# Papercuts 1

Created 2026-06-27. Source of truth remains `SPEC.md`; this ledger captures
small but user-visible framework/template papercuts found while scaffolding and
running `/Users/mini/kovo-example-app` from local `create-kovo`.

## Scope

These items cover the post-scaffold auth and mutation workflow issues observed
after the CLI/package fixes. They are not yet framework fixes; each checkbox
stays open until a same-session implementation verifies the cited behavior.

## Issues

- [x] **Auth mutation forms can swallow successful redirects when enhanced.**
  - Observed behavior: submitting the generated login form to `/_m/auth/sign-in`
    returned a successful empty response / redirect response, but the browser
    stayed on `/login?next=%2F` when the client loader intercepted the form as an
    enhanced mutation.
  - Why it matters: auth mutations are ordinary SPEC §6.3 mutation forms, but
    successful sign-in/sign-out primarily communicate by redirect. An enhanced
    submit path that treats that as a fragment response leaves the user logged in
    but visually stuck on the auth page.
  - Repro evidence: in `/Users/mini/kovo-example-app`, Playwright clicked the
    login button on `http://100.108.214.117:5177/login?next=%2F`; the network
    request to `/_m/auth/sign-in` succeeded, while `page.url()` remained the
    login URL. A page-local `fetch(..., { redirect: 'manual' })` proved the same
    credentials set `better-auth.session_token`.
  - Acceptance: add a focused browser/runtime test where an enhanced auth
    mutation returns `303 Location: /`; the client must navigate to `/` or the
    template must intentionally render auth forms as non-enhanced while retaining
    framework-stamped CSRF/idempotency fields.
  - Evidence: `pnpm exec vitest run packages/browser/src/mutation-submit.test.ts packages/browser/src/inline-loader-enhanced-submit.test.ts` covers modular and inline enhanced auth redirects for `303 Location: /` and followed `/login` redirects; `pnpm --filter @kovojs/browser run check:inline-loader` verifies generated inline loader parity.

- [ ] **Vite dev HMR can leave duplicate generated live-target renderers after edits.**
  - Observed behavior: after editing the todo component/mutations, add-todo
    requests hit a `500` and the dev log reported a duplicate generated live
    target renderer for `components/todos/todos-region`.
  - Why it matters: this is a dev-only failure mode, but it makes a fresh starter
    app look broken while iterating. Restarting the dev server cleared the stale
    generated registry state, which suggests invalidation/HMR cleanup is too
    coarse or non-idempotent.
  - Repro evidence: `/Users/mini/kovo-example-app` returned `500` on add todo
    after component edits until the server on `0.0.0.0:5177` was restarted.
  - Acceptance: add a dev-server/HMR regression that edits or reloads a
    query-backed component module and asserts the live-target renderer registry
    contains one renderer per target/component identity, with no mutation `500`
    after HMR.

- [ ] **Enhanced mutation refresh can return an empty fragment when query reads and mutation touches are only inferred.**
  - Observed behavior: the generated todo query used Drizzle reads and the
    mutations wrote the same table, but enhanced `addTodo` initially returned
    `200 text/vnd.kovo.fragment+html` with `kovo-changes: []` or later a change
    header and an empty body.
  - Why it matters: SPEC §11.1 expects mutation refresh selection to know which
    visible query-backed regions are affected. If the starter relies on Drizzle
    extraction but runtime selection still needs explicit `reads`/`registry`
    declarations, the scaffold teaches an incomplete pattern.
  - Repro evidence: in `/Users/mini/kovo-example-app`, enhanced add posted
    `Kovo-Targets: todos-region=todos` and
    `Kovo-Live-Targets: todos-region#components/todos/todos-region@...:{}`,
    but returned an empty body until the app explicitly added `todoDomain`,
    `reads: [todoDomain]`, and
    `registry: { queries: [todosQuery], touches: [todoDomain] }`.
  - Acceptance: either make Drizzle/static extraction feed the runtime refresh
    registry for this starter shape, or update `create-kovo` templates to emit
    explicit domain/read/touch wiring. Verify with a browser test that enhanced
    add returns a non-empty fragment for the generated starter app.

- [ ] **After an enhanced fragment swap, the replacement component can lose live-target stamps.**
  - Observed behavior: once `addTodo` returned a full fragment, the new todo row
    appeared. The subsequent enhanced `toggleTodo` request sent
    `Kovo-Targets: ""` and `Kovo-Live-Targets: ""`, then returned an empty
    fragment body even though the mutation succeeded.
  - Why it matters: SPEC §9.1's stateless mutation response model depends on the
    live DOM preserving `kovo-deps`, `kovo-fragment-target`, and live-target
    descriptors after every swap. If a refreshed component root loses those
    stamps, the next mutation cannot request a refresh target.
  - Repro evidence: before add, the DOM contained a `todos-region` root with
    `kovo-c`, `kovo-deps`, `kovo-fragment-target`, `kovo-live-component`, and
    `kovo-live-token`. After the add fragment was applied, Playwright found no
    `[kovo-deps]`, `[kovo-fragment-target]`, or `[kovo-c]` elements, and toggle
    sent empty target headers.
  - Acceptance: add a browser response-apply regression where a query-backed
    component fragment is applied and the resulting DOM still advertises the
    same refresh target/deps/live descriptor needed for the next enhanced
    mutation.

## Latest Verification

- `pnpm exec vp check --fix` in `/Users/mini/kovo-example-app`: passed after the
  example workaround.
- `pnpm run test` in `/Users/mini/kovo-example-app`: 2 files, 5 tests passed
  after the example workaround.
- `pnpm run build:prod` in `/Users/mini/kovo-example-app`: passed before the
  final auth-form workaround; rerun when converting these papercuts into a
  framework/template fix.
