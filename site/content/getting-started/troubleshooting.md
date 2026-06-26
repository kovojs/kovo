---
title: Troubleshooting & upgrading
description: Fix the common starter setup failures and check what to revisit when you pull a newer Kovo scaffold.
order: 8.5
---

# Troubleshooting & upgrading

Most starter problems are local setup drift, not framework bugs. Use this page when the scaffold
does not boot, auth fails before you can sign in, or a repo pull leaves your starter docs behind the
current template.

## Get the starter booting again

Run the narrow checks in the same order the scaffold expects:

```sh
pnpm install
vp check
vp test
vp dev
```

If `vp check` fails, fix that before chasing browser behavior. The starter pushes most wiring
mistakes into the typed compile path.

## Fix missing or placeholder secrets

`create-kovo` writes a real local `KOVO_CSRF_SECRET` into `.env` and leaves placeholders in
`.env.example`. If you copied `.env.example` over `.env`, or deleted the local file, auth and
mutations will fail closed.

Use a real secret locally:

```sh
openssl rand -base64 32
```

Then set `BETTER_AUTH_SECRET` or `KOVO_CSRF_SECRET` in `.env`. Leave `KOVO_DEMO_PASSWORD` set only
for local demo sign-in.

## Fix sign-in problems

The starter signs in with `demo@example.com` plus the generated `KOVO_DEMO_PASSWORD` from `.env`.
If login fails:

1. Check that `.env` still contains `KOVO_DEMO_PASSWORD`.
2. Restart `vp dev` after changing env vars.
3. Delete the local data file or database volume only if you want to reseed from scratch.

For production, remove the demo password and create real users through your own onboarding path.

## Fix docs drift after pulling a newer repo

The scaffold is the source of truth for onboarding examples. When docs and starter output disagree,
compare against:

- `packages/create-kovo/templates/src/app.tsx`
- `packages/create-kovo/templates/src/auth.ts`
- `packages/create-kovo/templates/README.md`

Do not rely on old notes about `kovo update-docs`; there is no supported scaffold command that
rewrites local docs into an existing app.

## Upgrade a starter carefully

When you pull a newer Kovo version, re-check the app-owned files first:

1. `src/app.tsx` for route, session, and endpoint registration changes.
2. `src/auth.ts` for auth, CSRF, and Better Auth adapter changes.
3. `vite.config.ts` and `package.json` for toolchain command changes.
4. `src/components/*.tsx` only where you intentionally own copied UI.

Keep your product schema, queries, and mutations. Rebase the scaffold shape around them instead of
recreating the app from zero.

## Next

- [Project structure](/getting-started/project-structure/) - compare your app against the current
  scaffold layout.
- [Better Auth integration](/guides/auth-better-auth/) - verify the auth/session path in detail.

<details>
<summary>Spec & diagnostics</summary>

Fail-closed CSRF/session rules: SPEC §6.6. Starter deploy/runtime shape: SPEC §9.5. Explain and
audit output for deeper graph checks: SPEC §11.4.

</details>
