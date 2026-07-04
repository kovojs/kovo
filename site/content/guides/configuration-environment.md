---
title: Configuration & environment
description: Validate env at boot, understand production posture, and keep the app-facing KOVO variables straight.
order: 4.8
---

# Configuration & environment

Use this page when you are wiring a new app, moving from local PGlite to deployed Postgres, or
trying to answer "which env var does this surface actually read?" The smallest path is to validate
your own required env at boot and let the framework refuse early.

## Validate your env at boot

Start with the app-owned vars you actually need:

```ts
import { createApp, s } from '@kovojs/server';

export const app = createApp({
  env: s.object({
    STRIPE_SECRET_KEY: s.string().min(1),
    SENTRY_DSN: s.string().url().optional(),
  }),
});
```

That check happens at boot, not on the first live request. In production, invalid env blocks app
assembly. In development, the framework warns instead of bricking localhost.

## Run it

You can see the same failure mode with a missing framework secret by starting the app in production
without a real CSRF secret:

```sh
NODE_ENV=production pnpm dev
```

The boot path reports a typed `CreateAppBootError` instead of failing later from inside a route or
mutation.

## Understand the production shape

Boot mode comes from `NODE_ENV` unless an adapter overrides it. The practical differences are:

- Production refuses weak or missing framework secrets.
- Development warns about advisory issues instead of throwing.
- The default outbound egress floor is stricter in production.

The secret floor applies to the framework-owned signing material you wire through `createApp`, not
every random string in your process env.

## Use the app-facing variables

These are the env vars you will usually touch in app code, deploy config, or CI.

| Variable                       | Used by                                                      | What it does                                                                                   |
| ------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `KOVO_CSRF_SECRET`             | `createApp({ csrf })`, starter auth                          | Framework signing secret for browser mutation CSRF when you wire it through app config.        |
| `KOVO_DATABASE_URL`            | runtime DB, `kovo db check`, egress bootstrap                | Least-privilege runtime database URL. Production Postgres posture hangs off this.              |
| `KOVO_RUNTIME_DATABASE_URL`    | `kovo db provision` / `kovo db migrate`                      | Explicit runtime login for posture checks and grants when it differs from `KOVO_DATABASE_URL`. |
| `KOVO_ADMIN_DATABASE_URL`      | `kovo db provision` / `kovo db migrate` / `kovo db generate` | Privileged setup URL. Keep it out of normal app boot.                                          |
| `KOVO_DB_DRIVER`               | Postgres/PGlite runtime and `kovo db`                        | Chooses `pglite`, `pg`, or `node-postgres`.                                                    |
| `KOVO_DATA_DIR`                | PGlite runtime and starter template                          | Overrides the local PGlite directory.                                                          |
| `KOVO_DB_READER_ROLE`          | Postgres provision/check                                     | Reader role name. Defaults to `kovo_reader`.                                                   |
| `KOVO_DB_WRITER_ROLE`          | Postgres provision/check, durable tasks                      | Writer role name. Defaults to `kovo_writer`.                                                   |
| `KOVO_DB_ADMIN_ROLE`           | audited `crossOwnerRead(...)` posture                        | Admin role for the narrower cross-owner read path.                                             |
| `KOVO_PRESET`                  | `kovo build`                                                 | Forces `node`, `vercel`, or `cloudflare` instead of host autodetection.                        |
| `KOVO_PARANOID`                | build/dev diagnostics                                        | Turns on advisory extra security auditing.                                                     |
| `KOVO_SQL_GUARD`               | raw SQL migration escape hatch                               | Temporary fail-open escape for unmanaged raw SQL sinks.                                        |
| `KOVO_DEVTOOL_BASE`            | devtool mount                                                | Prefixes emitted devtool URLs when you serve it under a subpath.                               |
| `KOVO_VERIFY_ENDPOINT_POSTURE` | endpoint posture verification                                | Forces runtime endpoint posture checks in tests and verification flows.                        |
| `KOVO_EXPERIMENTAL_SQLITE`     | `create-kovo`                                                | Required to scaffold the experimental SQLite starter.                                          |

Two more names matter even though they are not `KOVO_*`:

- `NODE_ENV` controls boot posture.
- `BETTER_AUTH_SECRET` is the common auth-layer secret the starter also accepts in place of
  `KOVO_CSRF_SECRET`.

## Handle failure

There are three common failure classes:

- Your app env schema rejects a missing or malformed app-owned variable.
- Production boot rejects a weak framework signing secret.
- `kovo db` reads the wrong URL or driver and reports posture problems against the wrong database.

When that happens, fix the source env or the app wiring. Do not paper over it by catching the boot
error and continuing anyway.

## Next

- [Database lifecycle](/guides/database-lifecycle/) — wire the DB URLs and roles into real migrations.
- [Deployment](/guides/deployment/) — turn the same config into a production artifact.

<details>
<summary>Spec & diagnostics</summary>

Boot validation and `CreateAppBootError`: `packages/server/src/env.ts` and `packages/server/src/app.ts`.
DB/runtime env resolution: `packages/server/src/postgres-runtime.ts`, `packages/cli/src/commands/db.ts`,
and `packages/create-kovo/src/index.ts`. Build preset override and paranoid mode:
`packages/cli/src/commands/build-export.ts` and `packages/server/src/vite.ts`. CSP report endpoint:
`packages/server/src/csp.ts`. The main boot refusal path surfaces through `CreateAppBootError`; the
database posture family is the same KV433 set surfaced by `kovo db check`.

</details>
