# {{name}}

A Kovo starter: a small contact book that exercises the building blocks a real
CRM/ecommerce app needs — a typed database, queries, a guarded mutation with
optimistic UI, real authentication, and styled UI components — in as little code
as possible.

This app was scaffolded with the opt-in SQLite dialect. Postgres is the default
starter dialect; rerun `create-kovo` without `--dialect sqlite` for the PGlite
variant.

SQLite is a single-principal local-development scaffold. It does not provide
Kovo authorization/confidentiality guarantees because SQLite has no engine role,
RLS, or column-privilege layer. `kovo dev`, `kovo check`, and `kovo build` surface
KV447 for every owner-annotated SQLite table: those annotations remain useful audit
metadata, but they are not engine-enforced access control. Use the default
Postgres/PGlite starter for multi-principal applications.

```sh
pnpm run dev         # kovo dev — bootstrap trust roots, then start Vite
pnpm run check       # type/lint + sound-subset + current-source proof; no deploy artifacts
pnpm run build:prod  # kovo build ./src/app.tsx → {{deployment_target}} preset output
pnpm run test        # app-inferred harness; verifies the completed build graph first
{{production_start_command}}
```

For local development, sign in at `/login` with `demo@example.com` and the
random `KOVO_DEMO_PASSWORD` value in your generated, gitignored `.env` file.
`kovo dev` gives Better Auth the exact loopback Local URL after the server binds, so local
development does not need `BETTER_AUTH_URL`.

## What's here

| File                   | Building block                                                                                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/schema.ts`        | Drizzle SQLite tables. `contacts` carries a typed `kovo((columns) => ({ ... }))` annotation so the compiler can prove invalidation and authorization posture; the five Better Auth tables sit alongside it. |
| `src/db.ts`            | The app database type. Raw SQLite construction and seeding stay in `_kovo`; `defineKovo({ db })` infers the read/write context available to each receiver-bound factory.                                    |
| `src/kovo.ts`          | One `defineKovo()` contract that infers session, database, CSRF, client-module, replay, and revocation context for the app.                                                                                 |
| `src/queries.ts`       | `app.query({ ... })` declares `contactsQuery`; its loader receives an inferred read-only database context and the compiler extracts the Drizzle read.                                                       |
| `src/mutations.ts`     | `app.mutation({ ... })` declares `addContact`; the authenticated request and transaction-scoped write database are inferred without manual context types.                                                   |
| `src/auth.ts`          | Real [Better Auth](https://better-auth.com), obtained through the purpose-closed `@kovojs/better-auth/sqlite` app-binding door rather than a raw auth/database object.                                      |
| `src/components/*.tsx` | `@kovojs/ui` components (`Card`, `Button`, `Badge`) composing the contact list, add-contact form, and auth forms.                                                                                           |
| `src/app.tsx`          | Receiver-bound layouts, routes, and endpoints, followed by one explicit `app.assemble({ ... })` inventory. Vite and `kovo build` load its opaque default app token.                                         |
| `src/theme.ts`         | `defineTheme` — change the seed/custom colors to retheme everything.                                                                                                                                        |

## Supported development hosts

Kovo technical preview policy-tests this scaffold on Linux and macOS. Native Windows and WSL are
not currently supported development hosts. Generated deployment behavior is governed separately by
the selected `{{deployment_target}}` preset.

SQLite caveats: booleans are Drizzle `integer(..., { mode: 'boolean' })` columns,
Better Auth timestamps are `integer(..., { mode: 'timestamp_ms' })` columns, and
JSON should use `text(..., { mode: 'json' })` when you add JSON fields. Those
mappings are the blessed SQLite subset described by the data-layer policy.

`kovo dev` bootstraps Kovo before loading the Vite config. `kovo check` and `kovo test` retain the
`kovo()` config integration while the framework owns the pinned formatter, linter, TypeScript,
compiler, and test-runner phases. The source-backed check derives the security graph from current
app source, needs no deployment-retention declaration, and writes no deploy artifact. There is no
hand-maintained graph file. Run `build:prod` before `test`: the public harness rejects missing,
partial, wrong-app, or stale artifacts before it sends a request.

`pnpm run check` also enforces the SPEC.md §6.6 sound TypeScript subset for app
source: strict TypeScript plus local bans on `any`, non-null assertions, and
unchecked `as` casts. Keep deliberate escapes outside starter app code until
they have a framework-owned audit path.

`pnpm run check:endpoint-posture` exercises the emitted production server, so run it only after a
successful `pnpm run build:prod`. The generated CI workflow keeps that deployment-backed probe
separate from the source-only quick loop.

## Dependency install scripts

Dependency lifecycle scripts are denied by default. The only reviewed build exceptions are the exact
direct `@node-rs/argon2@2.0.2` and `better-sqlite3@12.11.1` pins; `esbuild`'s install hook is
explicitly ignored because its platform package supplies the binary without that hook. pnpm
runs in `strict-dep-builds` mode, so a new dependency with an unreviewed `preinstall`, `install`, or
`postinstall` script makes installation fail instead of merely printing a warning.
CI installs with `--ignore-scripts`, authenticates the declarative policy with
`kovo check lifecycle`, and only then runs `pnpm rebuild`. Update the pin and reviewed allowlist
together after a security review. Matching pnpm overrides prevent transitive copies of either
allowed package name from resolving to unreviewed versions.

This policy bounds dependency install hooks, not application scripts or code imported at build or
runtime. Command-line, environment, or machine-global pnpm overrides remain operator-controlled and
must not weaken the checked-in project policy.

## Deploying

This scaffold selected the `{{deployment_target}}` preset with retention posture
`{{retention_posture}}`.

`kovo build ./src/app.tsx` reruns the same source proof, then checks the selected
deployment preset and deploy-skew retention before it
emits the selected preset output using `kovo.config.ts`. Set
`BETTER_AUTH_URL` to the app's canonical public HTTPS origin for every non-loopback deployment (for
example, `https://app.example.com`). When the generated standalone Node server
runs behind TLS termination, also set `KOVO_NODE_ORIGIN` to that exact origin.
This fixed posture ignores forwarded authority. As an alternative, set
`KOVO_NODE_TRUSTED_PROXY=1` only when the immediate trusted proxy replaces
`X-Forwarded-Proto` and preserves the external `Host`; never set both variables.
Set `KOVO_CSRF_SECRET`/`BETTER_AUTH_SECRET`
to strong values in the target environment (a fresh `KOVO_CSRF_SECRET` is generated into `.env` at scaffold time
and is gitignored). If you add client islands, configure the `retention` option in
`kovo.config.ts` once your deploy keeps prior `/c/__v/...` modules and prior-token
`/_q` reads available for at least 24 hours; otherwise `build:prod` fails KV417
instead of shipping a skew-prone artifact. The server is stateless; liveness comes from BroadcastChannel
plus refetch-on-focus, not a live bus (SPEC.md §9.3).
