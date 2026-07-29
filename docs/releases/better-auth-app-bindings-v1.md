# Better Auth app-binding task entries

Kovo now exposes one human-public Better Auth construction door per supported database runtime:

```ts
import { createBetterAuthPostgresAppBindings } from '@kovojs/better-auth/postgres';
import { createBetterAuthSqliteAppBindings } from '@kovojs/better-auth/sqlite';
```

Each function accepts only the corresponding framework-minted app runtime and a small shared
configuration object. Kovo owns the system database capability, deployment origin and secret,
principal-epoch store, and authenticated sign-out access decision. The result contains only the
sanitized session provider, credential mutations, opaque mount adapter, and development seeder.

This removes generated-ABI imports from copied starter source while preserving the backend split:
importing the Postgres task does not boot SQLite, and importing the SQLite task does not boot
Postgres. The `@kovojs/better-auth/generated*` entries remain reserved for compiler-emitted modules.

There is no compatibility migration. This is additive technical-preview API; existing
compiler-emitted imports remain valid, while app and copied starter source should use the public
task entries.
