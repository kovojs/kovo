# Better Starter Template (`create-kovo`)

Reworked `packages/create-kovo/templates` so the scaffolded app is **simple to use, showcases the
real building blocks a CRM/ecommerce app uses, and is concise/readable**. The old template was built
around fiction and reinvention; this replaces it with the idiomatic patterns the `examples/commerce`
and `examples/crm` apps already prove. **Status: complete and verified (see Verification).**

- Normative behavior: `SPEC.md` (§5.2 authoring surface, §9.5 app-shell/request path, §10 data plane,
  §11.1/§11.4 compiler-derived graph + `kovo check`/`kovo explain`, §6.6 CSRF).
- Reference apps (the model): `examples/commerce/`, `examples/crm/`.
- Authoring rule: app source emits TSX/TS; lowered IR, `/c/` modules, and the graph are **compiler
  artifacts**, never hand-authored (`SPEC.md` §5.2, KV235).

## Locked decisions

- **Domain:** tiny hybrid — one entity (`contacts`) + one action (`addContact`).
- **Auth:** real upstream `better-auth` on the app's Drizzle/PGlite DB (Phase 0 spike succeeded → 4a).
- **Components:** `@kovojs/ui` via direct subpath imports (`@kovojs/ui/button`, `/card`, `/badge`).
- **Structure:** single `src/app.tsx` entry.

## Phase 0 — Auth spike (gate) ✅

- [x] Spiked real `better-auth@1.6.17` + `drizzleAdapter({ provider: 'pg' })` over `@electric-sql/pglite`.
      **Works.** Recipe: introspect schema via `getAuthTables(auth.options)`, hand-author DDL for
      `user`/`session`/`account`/`verification` (quoted camelCase columns) + matching `pg-core`
      pgTables, `betterAuth({ baseURL, secret, emailAndPassword:{enabled:true}, database:
drizzleAdapter(db,{provider:'pg',schema}) })`. Evidence: scratch spike ran signUp→signIn→
      getSession (returned the real user)→signOut, all HTTP 200.
- [x] **Decision gate → adopted 4a.** No fallback needed. (Repo's other `betterAuth` call sites use
      `memoryAdapter`; the Drizzle/PGlite path had no precedent but the spike + full e2e prove it.)

## Phase 1 — Delete the fiction ✅

- [x] Removed the fake-graph apparatus (`scripts/emit-graph.mjs`, `scripts/graph-assertions.mjs`,
      `docs/graph-assertions.md`), the static-export wrappers (`scripts/export-static.mjs`,
      `scripts/preview-static.mjs`, `scripts/serve.mjs`), `docs/`, `src/client.ts`, `index.html`, the
      old `app-shell.ts`/`app-shell.test.ts`/`auth.tsx`, the related `run.tasks`/scripts, and
      `graph.json` from `.gitignore`. CI trimmed to `vp install`→`vp check`→`vp test`→`kovo build`.

## Phase 2 — Use framework primitives ✅

- [x] `vite.config.ts` now uses `import { kovo } from '@kovojs/server/vite'` →
      `plugins: [kovo({ app: '/src/app.tsx' })]` (the plugin already applies the compiler). No
      hand-authored `/c/` module or `on:click` strings; styling is `style={…}` + theme tokens only.

## Phase 3 — Real data layer + domain ✅

- [x] `src/schema.ts` (`contacts` with `kovo({ domain, key })` + the four auth tables), `src/db.ts`
      (`createAppDb()` Drizzle/PGlite, seeded, plus the running `appDb` singleton), `src/queries.ts`
      (`contactsQuery`), `src/mutations.ts` (`addContact`: CSRF + `authed` guard + input schema +
      optimistic transform + `QueryRegistry`/`InvalidationSets`), `src/components/contacts.tsx`
      (`@kovojs/ui` list + add form).

## Phase 4 — Auth integration (4a) ✅

- [x] `src/auth.ts`: real `betterAuth` over `appDb`, wired via `@kovojs/better-auth`
      (`betterAuthSession`, sign-in/out mutations as module constants, `authed` guard). `src/app.tsx`
      guards `/` (redirect to `/login` when anonymous) and seeds a demo account
      (demo@example.com / password123). Anonymous CSRF binds to a stable id so the login form is
      stamped (mirrors commerce; SPEC §6.6). `.env` keeps the generated `KOVO_CSRF_SECRET`; `auth.ts`
      loads `.env` via `process.loadEnvFile()` and fails closed if the secret is missing.

## Phase 5 — Naming, deps, docs, CI ✅

- [x] All `Starter*`/`starter*` → `App*`/`app*`. `package.json` adds `@kovojs/ui`/`@kovojs/drizzle`/
      `drizzle-orm`/`@electric-sql/pglite`/`better-auth`; scripts trimmed to
      `dev`/`build:prod`/`start`/`serve`/`check`/`test`. Single concise `README.md` (deployment folded
      in). `packages/create-kovo/src/index.ts` manifest (16 template + 3 generated = 19 files) and
      `src/index.test.ts` rewritten.

## Phase 6 — Framework/CLI changes

- [x] None required — `@kovojs/server/vite` (`kovo`) and `@kovojs/compiler/vite` (`kovoVitePlugin`)
      are already public; `kovo()` applies the compiler internally (`packages/server/src/vite.ts`).

## Verification (scaffolded copy)

- [x] `packages/create-kovo` suite green: **10/10** (`vitest --run packages/create-kovo`) — scaffold
      manifest, `tsc --strict` typecheck of all template src, in-app `vitest`, `vp dev` (login render +
      anonymous redirect + **full sign-in e2e** rendering the authed contacts page), CLI cases.
- [x] `vp check` on a scaffold: formatting + lint + **types/compile incl. Kovo coverage checks** pass
      (12 files, no warnings).
- [x] `kovo build ./src/app.tsx` → `dist/server/server.mjs`; the production node server boots and
      serves `/login` + redirects `/`→`/login` (PGlite + better-auth bundled).
- [x] `vp check` on `packages/create-kovo/src/{index.ts,index.test.ts}`: clean.

## Notes / residual

- Auth uses the real `better-auth` library; the in-process PGlite DB is ephemeral per process (demo),
  so the seeded user is recreated on boot — consistent with the seeded `contacts` demo data.
- `better-auth`/`drizzle-orm`/`@electric-sql/pglite` are pinned to versions already in the repo store
  (1.6.17 / 0.45.2 / ^0.5.1); the template isn't a workspace member so the lockfile is unaffected.
