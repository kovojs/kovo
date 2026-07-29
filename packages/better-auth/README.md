# @kovojs/better-auth

Better Auth adapter for Kovo. It provides framework-owned SQLite and Postgres bindings with a
sanitized session provider, CSRF-protected sign-in/sign-out mutations, auth guards, role checks,
and an opaque redirect-protocol mount.

```sh
pnpm add @kovojs/better-auth
```

Kovo-generated server assembly imports
`createBetterAuthSqliteBindingsFromEnvironment` or
`createBetterAuthPostgresBindingsFromEnvironment` from
`@kovojs/better-auth/generated/sqlite` or
`@kovojs/better-auth/generated/postgres`. App-authored modules do not import those generated ABIs.
Backend-neutral result and option contracts live at the type-only
`@kovojs/better-auth/generated` entry; keeping the runtime constructors split prevents one import
from booting two database engines. Both backends return the same Kovo-facing `sessionProvider`,
`signIn`, `signOut`, `mountAdapter`, optional `requestPasswordReset`, and `seedDemoUser` shape; the
raw Better Auth object and database capability never leave the constructor. Caller-created
`betterAuth()` objects are intentionally not accepted by the public API (SPEC §6.6).

The opaque `mount('/api/auth', appAuth.mountAdapter)` is redirect-only. Kovo rejects Better Auth
JSON/HTML routes and external or ambiguous redirects, strips every response body and unreviewed
header, and emits only a canonical same-origin `Location`, reviewed callback cookies, and Kovo's
`no-store` cache floor (SPEC §6.6/§9.1).

OAuth mounting is **experimental** in this technical preview. The callback boundary and state-cookie
posture are tested, but generated bindings do not yet expose a supported social-provider
configuration workflow. Do not advertise or depend on production OAuth until that workflow has a
framework-owned configuration door and a real provider round-trip conformance test. Email/password
sign-in, sign-out, sanitized sessions, and guards are the mature workflows in this package.

Password recovery is also **experimental**. The generated binding turns the declaration below into a
CSRF-protected `requestPasswordReset` mutation, and the mail door receives only the recipient and
same-origin reset URL. Kovo does not yet expose a typed, CSRF-protected password-completion mutation,
so this is not an end-to-end supported account-recovery workflow.

```ts
import {
  betterAuthPasswordResetMailDoor,
  type BetterAuthPasswordResetOptions,
} from '@kovojs/better-auth';
import { publicAccess } from '@kovojs/server';

export const passwordReset = {
  access: publicAccess('account recovery form'),
  mail: betterAuthPasswordResetMailDoor(async ({ resetUrl, to }) => {
    await transactionalMail.send({ template: 'password-reset', to, variables: { resetUrl } });
  }),
  resetPath: '/reset-password',
} satisfies BetterAuthPasswordResetOptions;
```

## Reference

- API: `/api/better-auth/`
- Guide: `/guides/auth-better-auth/`
