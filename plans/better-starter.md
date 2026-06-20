# Better Starter Template (`create-kovo`)

Rework `packages/create-kovo/templates` so the scaffolded app is **simple to use, showcases the real
building blocks a CRM/ecommerce app uses, and is concise/readable**. The current template is built
around fiction and reinvention; this ledger replaces it with the idiomatic patterns the
`examples/commerce` and `examples/crm` apps already prove.

- Normative behavior: `SPEC.md` (esp. §5.2 authoring surface, §9.5 app-shell/request path, §10 data
  plane, §11.1/§11.4 compiler-derived graph + `kovo check`/`kovo explain`).
- Reference apps (the model): `examples/commerce/`, `examples/crm/`.
- Authoring rule: app source emits TSX/TS; lowered IR, `/c/` modules, and the graph are **compiler
  artifacts**, never hand-authored (`SPEC.md` §5.2, KV235).

## Locked decisions (from review discussion)

- **Domain:** tiny hybrid — one real entity + one action (one table, one list query, one create
  mutation). Smallest thing that exercises the full data plane. Showcase entity: `contacts` with an
  "add contact" action (swappable; keep it generic/business-flavored).
- **Auth:** spike **real upstream `better-auth`** on the app's Drizzle/PGlite DB first; if the spike
  fails, fall back to **DB-backed auth via the `@kovojs/better-auth` structural adapter** (own
  `users`/`sessions` tables, real password verify + cookie + CSRF + `authed` guard). Either way the
  starter must work on `vp dev` first run.
- **Components:** `@kovojs/ui` via direct subpath imports (`@kovojs/ui/button`, `/card`, `/table`,
  `/field`, …) — no vendoring required.
- **Structure:** single `src/app.tsx` entry (`createApp` + routes + page), like `examples/commerce`.

## What's wrong today (diagnosis / motivation)

- [ ] **The graph is fake.** `templates/scripts/emit-graph.mjs` hand-writes a hardcoded `graph.json`
      describing a `cart` domain, `CartBadge`/`CartPanel`, and `cart/add` — none of which exist in
      the app (`app.tsx` is a static counter). `graph-assertions.mjs` "verifies" the fiction and CI
      runs it. Contradicts `SPEC.md` §11.1 (graph is compiler-derived, `generated/touch-graph.ts —
      DO NOT EDIT`; reproduced via `kovo check`/`kovo explain`).
- [ ] **Reinvented Vite plugin.** `templates/vite.config.ts` (107 lines) hand-rolls
      `starterSharedAppShellDevPlugin` doing an `ssrLoadModule('@kovojs/server')` dance to reach the
      same integration the public `kovo()` plugin already wraps. `examples/crm/vite.config.ts:24`
      uses `kovo({ app })` directly; `kovo()` already loads+applies the compiler plugin
      (`packages/server/src/vite.ts:123-129`).
- [ ] **Hand-authored artifacts.** `templates/src/app.tsx` ships a raw-JS `/c/` client-module string
      and wires `on:click="/c/__v/starter-r7/..."` by hand — lowered IR that `SPEC.md` §5.2 makes a
      KV235 error for app authors. Also uses verbose `{...style.attrs(x)}` (examples use `style={x}`)
      and hardcoded hex in `auth.tsx`.
- [ ] **Wrapper scripts duplicate the CLI.** `scripts/export-static.mjs` (67 lines) mostly just calls
      `kovo export` then renames a diagnostic prefix; `scripts/serve.mjs` reimplements what `vp dev`
      already does.
- [ ] **No real building blocks.** Zero DB, zero Drizzle domains, zero real queries/mutations/
      optimism — the entire point of the template is missing. `Starter*`/`starter*` naming throughout.

## Phase 0 — Auth spike (gate; do first, time-boxed)

- [ ] Spike real `better-auth@^1.6` wired to PGlite via Drizzle. Add the dep, configure
      `betterAuth({ database: drizzleAdapter(db, …), emailAndPassword: { enabled: true }, secret,
      baseURL })`, generate its `user`/`account`/`session`/`verification` tables into the same PGlite
      instance, pass the instance to `@kovojs/better-auth` (`betterAuthSession`,
      `betterAuthSignInEmailMutation`, `betterAuthSignOutMutation`; `mount()` its handler if needed).
      Risk: `better-auth` is not installed in the repo (peer dep `^1.6.0`, absent) and **no repo
      precedent** wires it to PGlite (`examples/commerce/src/domain.ts:119-169` hand-rolls an
      in-memory mock precisely because of this).
- [ ] **Decision gate:** if real `better-auth` runs cleanly on `vp dev`/`vp build`/`vp test` against
      PGlite, adopt it (Phase 4a). If it hits PGlite/dialect/migration/async blockers, record the
      blocker here and fall back to DB-backed structural auth (Phase 4b). Do not ship an unverified
      auth path in the scaffold.

## Phase 1 — Delete the fiction (pure removal)

- [ ] Remove fake-graph apparatus: `scripts/emit-graph.mjs`, `scripts/graph-assertions.mjs`,
      `docs/graph-assertions.md`, the `kovo-check` + `graph-assertions` `run.tasks` in
      `vite.config.ts`, and the two CI steps. Drop `graph.json` from `.gitignore` if unused.
- [ ] Remove static-export plumbing: `scripts/export-static.mjs`, `scripts/preview-static.mjs`, the
      `export` / `preview-static` tasks, and the `static`/`preview:static` npm scripts. (If static
      export is wanted later, it is one line: `kovo export ./src/app.tsx …`.)
- [ ] Remove `scripts/serve.mjs` and the `serve:dev` script; rely on `vp dev`.
- [ ] Update `packages/create-kovo/src/index.ts` `templateFiles` list and `src/index.test.ts`
      expectations for every removed/added file.

## Phase 2 — Use framework primitives

- [ ] Replace `vite.config.ts` with `import { kovo } from '@kovojs/server/vite'` →
      `plugins: [kovo({ app: '/src/app.tsx' })]` plus `build.manifest`/`fmt`/`lint` only (~15 lines).
      Model: `examples/crm/vite.config.ts`.
- [ ] Replace the hand-written `/c/` module + raw `on:click` string with an idiomatic TSX handler the
      compiler lowers (only if an interaction is needed; the data demo may not need one). Verify
      `kovo({app})` alone lowers it (crm uses no separate compiler plugin).
- [ ] Switch component styling to `style={…}` and theme tokens (`@kovojs/style`); drop hardcoded hex.

## Phase 3 — Real data layer + domain (the point)

- [ ] `src/schema.ts`: one Drizzle table (`contacts`) annotated with `kovo({ domain, key })`
      (add `owner` if the entity is principal-owned). Model: `examples/commerce/src/schema.ts`.
- [ ] `src/db.ts`: `createAppDb()` — Drizzle over PGlite (`@electric-sql/pglite`), seeded with a few
      rows. Model: `examples/commerce/src/db.ts`.
- [ ] `src/queries.ts`: one `query('contacts', { load })` reading the table via Drizzle.
- [ ] `src/mutations.ts` (or inline in `app.tsx`): one `mutation('contacts/add', { input: s.object(…),
      csrf, guard: authed(), handler })` that writes a row; ensure the create/optimistic edge is
      explicit (`hand-written` or `await-fragment`) so `kovo check` is clean.
- [ ] `src/app.tsx`: `createApp({ db, queries, mutations, routes })` with one route rendering a
      `@kovojs/ui`-built contacts list + add-contact form (`component()` + `mutationFormAttributes`,
      model: `examples/crm/src/components/contacts.tsx`).

## Phase 4 — Auth integration (branch on Phase 0 outcome)

- [ ] **4a (spike succeeded):** wire real `better-auth` from Phase 0; add a guarded route/mutation and
      a login form using `@kovojs/ui` (`field`/`button`); seed/document a demo credential; keep CSRF
      via the better-auth sign-in mutation.
- [ ] **4b (fallback):** `src/auth.ts` provides an `auth` object whose `api.getSession/signInEmail/
      signOut` run real Drizzle/PGlite queries against own `users`/`sessions` tables (hashed password,
      signed `HttpOnly` cookie), fed to `@kovojs/better-auth`'s adapter. Same guard/CSRF/UI surface as
      4a so the rest of the template is identical.
- [ ] `create-kovo` keeps generating a per-project `KOVO_CSRF_SECRET` into `.env` (preserve existing
      `src/index.ts` secret-gen + `.gitignore` behavior); add `BETTER_AUTH_SECRET`/`baseURL` if 4a.

## Phase 5 — Naming, deps, docs, CI

- [ ] Rename all `Starter*`/`starter*` → `App*`/`app*` (`AppDb`, `appSession`, `createAppAuth`, …).
- [ ] `package.json`: add `@kovojs/ui`, `@kovojs/drizzle`, `drizzle-orm`, `@electric-sql/pglite`
      (+ `better-auth` if 4a) to dependencies; simplify scripts to `dev` (`vp dev`),
      `build`/`build:prod` (`kovo build ./src/app.tsx --preset node`), `start`, `check` (`vp check`),
      `test` (`vp test`).
- [ ] Collapse `docs/` to a single concise `README.md` (fold in deployment essentials from
      `docs/deployment.md`); delete `docs/framework-rules.md`.
- [ ] Decide whether to keep `src/app-shell.test.ts` — replace its app-shell/export assertions with a
      small test covering the real route + the contacts query/mutation.
- [ ] Trim `.github/workflows/ci.yml` to `vp install` → `vp check` → `vp test` → `vp run build`.

## Phase 6 — Framework/CLI changes (only if forced)

- [ ] Default: **no** framework change needed — `@kovojs/server/vite` (`kovo`) and
      `@kovojs/compiler/vite` (`kovoVitePlugin`) are already public exports. Record here only if the
      Phase 0 spike or `@kovojs/ui`/`kovo add` reveals a missing public seam.

## Verification gates

- [ ] From a scaffolded copy (`create-kovo` into a temp dir): `vp install`, `vp check`, `vp test`,
      `vp dev` (renders seeded contacts + working add-contact), `kovo build --preset node` + `node
      dist/server/server.mjs`. Record the commands + outcomes here.
- [ ] `kovo check` clean (real compiler-derived graph; KV310/KV311 covered) and `kovo explain`
      reflects the real `contacts` domain — not a hand-written graph.
- [ ] `packages/create-kovo` package tests (`src/index.test.ts`) updated and green for the new file
      manifest.

## Open risks

- Real `better-auth` + PGlite compatibility is unproven in this repo (Phase 0 gate).
- `@kovojs/ui` components are `component()` definitions consumed via `.definition.render()`/JSX; verify
  they render server-side in the scaffold without extra config (crm does this with only `kovo({app})`).
- Keep the scaffold dependency-light enough to stay "simple"; PGlite (WASM) adds install weight —
  acceptable since it's the data building block both reference apps use.
</content>
</invoke>
