# Integration testing (framework-owned)

The integration suite boots a **small Kovo app** on a real Vite-SSR server and drives
it in a real browser (`@playwright/test`), asserting through Kovo's semantic anchors
and semantic-structure snapshots. It exercises framework public APIs end to end —
SSR, queries, mutations, the inline-loader morph, typed errors, and auth — not app
wiring (SPEC §11 keeps app-level browser tests unnecessary; this suite is the
framework's own).

- Harness: `@kovojs/test/integration` (`packages/test/src/integration`).
- Fixtures + specs: `tests/integration/`.
- Run: `pnpm run test:integration` (or `vp run integration`). CI installs Chromium
  first (`vp exec playwright install --with-deps chromium`).

## Write a fixture in ~10 lines

A fixture is one folder under `tests/integration/fixtures/<name>/` whose `app.tsx`
default-exports `defineFixture(...)`. The harness owns PGlite, the Vite SSR server,
per-request `db`, seeding, and teardown.

```tsx
// tests/integration/fixtures/hello/app.tsx
import { createApp, route } from '@kovojs/server';
import { defineFixture } from '@kovojs/test/integration/define';

const app = createApp({
  routes: [
    route('/', {
      page: () => (
        <main>
          <h1>Hello</h1>
        </main>
      ),
    }),
  ],
  renderRoute: (value) => String(value),
});

export default defineFixture({ app });
```

```ts
// tests/integration/specs/hello.spec.ts
import { expect, test } from '@kovojs/test/integration';

test.use({ kovoFixture: 'hello' });

test('greets', async ({ page, kovoApp }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Hello' })).toBeVisible();
  expect(await kovoApp.semantic('main')).toMatchSnapshot('hello.semantic.txt');
});
```

The `kovoApp` fixture provides: `db` (the live per-test PGlite handle — assert against
server truth), `origin`, `login(...)`, and `semantic(selector)`. `baseURL` points at
the live origin, so `page.goto('/x')` just works. The database is **reset and
re-seeded before every test** (an `auto` fixture), so tests are isolated.

### Database + seed

```tsx
export default defineFixture({
  app,
  schema: 'create table todo (id serial primary key, title text)',
  seed: (db) => db.write('todo', { title: 'first' }),
});
```

Handlers read the per-request database off the request: a query loader gets it from
`context.request.db`, a mutation handler from its `request` argument, a route page
from its `request` argument. Type the request as `KovoFixtureRequest`.

### Interactive components (mutation → morph)

See `fixtures/counter` (mutation + fragment morph) and `fixtures/stock` (typed error
fragment). Two rules:

1. **Author components in their own `.tsx` file** (e.g. `count-badge.tsx`) and import
   them into `app.tsx`. The compiler claims any module containing a Kovo component and
   rewrites its exports, so the fixture _entry_ must not declare one.
2. **The compiler matches the component-call token as source text** — keep that token
   out of comments/strings in non-component modules, or the plugin will claim them.

The page renders a component root with `kovo-deps`; the compiler/runtime derive the
live-target descriptors needed by the fragment wire. An enhanced form posts the compiled
mutation action (`<form method="post" action="/_m/<key>" data-mutation="<key>">` in
emitted HTML). The always-present inline-loader runtime applies returned query chunks
or morphs named fragments in place — no navigation. Ordinary success fragments are
selected from the generated live-target registry and re-rendered from server truth.

### Loader coverage split

The document shell always includes the small inline loader. It owns delegated `on:*`
handlers, enhanced form submission, mutation response parsing, fragment morphing, query
chunk event dispatch, and island abort scopes. Heavier production-loader behavior must
be exercised by importing `installKovoLoader(...)` from `@kovojs/browser/client` in the fixture
client module, as `fixtures/query-refetch`, `fixtures/broadcast-channel-sync`, and the
runtime `loader-*` tests do. That installed-loader path owns query-store hydration,
typed-read visible-return refetch, default BroadcastChannel replay, optimistic cleanup,
and loader disposal hooks.

### Auth

`fixtures/auth` shows `sessionProvider` + `guards.authed()` + `context.setCookie`. In a
spec, `kovoApp.login({ fields: { email, password }, submit: 'Sign in' })` submits the
rendered form and establishes the session cookie. Use `csrf: false` on fixture
mutations to skip the CSRF/session dance unless CSRF itself is under test.

## Non-brittle assertions

Prefer, in order:

1. **Web-first locator assertions** — `getByRole`, `toHaveText` (auto-waiting).
2. **Kovo semantic anchors** — `[data-bind="cart.count"]`, `[data-error-code]`,
   `[kovo-deps]`, and emitted `[kovo-fragment-target="…"]` hooks
   (framework-guaranteed output, stable across markup).
3. **`semantic(selector)` snapshots** — a canonical tree of tag + Kovo/behavioral/a11y
   attributes + bound text, with volatile bits (CSRF tokens, hashed ids/asset
   versions, class/style) stripped. The snapshot diffs only when _meaning_ changes.

Update snapshots intentionally with
`pnpm exec playwright test --config tests/integration/playwright.config.ts --update-snapshots`.
