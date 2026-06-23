---
title: From starter to app
description: Extend the create-kovo contact starter into product code without breaking auth, data, or verification.
order: 0.8
---

# From starter to app

The starter is already an authenticated data app. Treat it as a small vertical slice: a database
schema, Better Auth session, typed query, guarded mutation, route layout, styled components, test,
and production build. Extend that slice in place instead of replacing it with an empty shell.

## Start with one domain

Pick one product concept and add it through the same modules the contact book uses.

| Step | File | What changes |
| ---- | ---- | ------------ |
| 1 | `src/schema.ts` | Add the table and Kovo domain/key metadata. |
| 2 | `src/db.ts` | Seed local rows or connect the real storage path. |
| 3 | `src/queries.ts` | Add one typed read for the first screen. |
| 4 | `src/mutations.ts` | Add one guarded write with validation and CSRF. |
| 5 | `src/components/*.tsx` | Render the query and form from TSX. |
| 6 | `src/app.tsx` | Register the query, mutation, route, and stylesheet. |
| 7 | `src/app.test.ts` | Prove the route and mutation path. |

That order keeps the compiler's facts easy to inspect: schema first, reads and writes next,
rendering last.

## Keep auth central

`src/auth.ts` owns session shape, CSRF configuration, Better Auth setup, sign-in, sign-out, and
guards. New product mutations should import the existing CSRF config and guard helpers instead of
declaring their own auth path. The starter's anonymous-login CSRF and session-bound CSRF behavior
matches the server security contract in SPEC section 6.6.

For a public route, render without requiring `request.session`. For a private route, follow the
home route: check `request.session` in `page()` and return a redirect before rendering the
protected component.

## Add routes deliberately

Routes are app facts. Add them near the existing `/` and `/login` route declarations in
`src/app.tsx`, and keep shared frame in `layout()`.

```tsx
route('/projects/:id', {
  layout: AppLayout,
  stylesheets,
  page({ params }, request: AppRequest) {
    if (!request.session) return redirect('/login', {});
    return <ProjectPage id={params.id} request={request} />;
  },
});
```

Use the route module as the place where access rules are obvious. Component files should render UI;
route declarations should say who can see it and which layout/style facts apply.

## Grow verification with the feature

Run the narrow checks before and after the change:

```sh
vp check
vp test
```

When the feature crosses data domains or relies on optimistic behavior, add a graph assertion or a
`kovo explain` check the same way the Commerce, CRM, and StackOverflow examples do. The point is to
make "what updates what" a reviewed artifact instead of a browser-clicking ritual. SPEC section 11.4

## Copy components only when you need ownership

Use direct imports such as `@kovojs/ui/button` when the public styled component is enough. Use
`kovo add button` when product styling or behavior should live in your app. The component guide
explains the import-vs-copy boundary: [Components & copy-in UI](/guides/components/).

## Deploy after replacing local secrets

The generated `.env` is gitignored and local. Set `BETTER_AUTH_SECRET` or `KOVO_CSRF_SECRET` in the
deployment platform, then build with:

```sh
npm run build:prod
npm start
```

If you switch database dialects later, regenerate a scratch starter with the target dialect and
compare `src/db.ts`, `src/schema.ts`, and `src/auth.ts`; those are the dialect-specific files.
