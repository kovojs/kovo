# Better Auth generated assembly v1

Kovo's human-facing Better Auth entrypoint now contains guards, CSRF/environment configuration,
mounting, and mature authentication workflows. Generated database assembly has one backend-neutral
type entry and separate Postgres and SQLite runtime entries:

```ts
import type { BetterAuthGeneratedRequest } from '@kovojs/better-auth/generated';
import { createBetterAuthPostgresBindingsFromEnvironment } from '@kovojs/better-auth/generated/postgres';
import { createBetterAuthSqliteBindingsFromEnvironment } from '@kovojs/better-auth/generated/sqlite';
```

Previously, those constructors and backend-specific contracts were exported by
`@kovojs/better-auth`. This is a clean technical-preview cut: there is no compatibility barrel.
Run the checked migration first, review every refusal, and then write the mechanical changes:

```sh
node scripts/migrate-better-auth-api-v1.mjs --check src
node scripts/migrate-better-auth-api-v1.mjs --write src
```

The tool preserves direct named import aliases, splits mixed imports and re-exports, and renames the
retired `BetterAuthBindingRequest` carrier to `BetterAuthGeneratedRequest`. It refuses namespace,
default, dynamic, CommonJS, wildcard, attributed, and import-type-query access because a tool cannot
prove which backend or application-owned replacement those shapes intend. It also refuses
`BetterAuthCredentialMutationValue`; generated bindings infer their credential result, while an
app-authored use needs an explicit local result contract.

The generated Postgres and SQLite constructors now return the same backend-neutral Kovo binding
shape. Their validated secrets and runtime constructors remain backend-specific so importing one
backend never initializes the other database engine. Generated app assembly obtains a
framework-minted, operation-scoped database capability; application code cannot construct or unwrap
that authority.

OAuth mounting and password recovery remain explicitly experimental. OAuth does not yet have a
framework-owned social-provider configuration door and real provider round-trip proof. Password
recovery does not yet include a typed, CSRF-protected password-completion mutation. Email/password
sign-in, sign-out, sanitized sessions, guards, and role checks remain the mature workflows.

Rollback from a clean worktree by restoring the prior Kovo package versions and reversing only the
files reported as rewritten in the structured migration result.
