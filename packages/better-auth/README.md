# @kovojs/better-auth

Better Auth adapter for Kovo. It provides typed session integration, sign-in,
sign-up, sign-out mutations, auth guards, role checks, and redirect protocol
mounting for apps that use Better Auth.

```sh
pnpm add @kovojs/better-auth better-auth
```

```ts
import { betterAuthSession } from '@kovojs/better-auth';

export const appSessionProvider = betterAuthSession(auth, ({ user }) => ({
  user: {
    email: user.email,
    id: user.id,
    name: user.name,
  },
}));
```

## Reference

- API: `/api/better-auth/`
- Guide: `/guides/auth-better-auth/`
