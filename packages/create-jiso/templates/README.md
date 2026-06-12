# Jiso Starter

This starter uses Vite+ as the single project entrypoint:

```sh
vp check
vp test
vp run build
vp run emit-graph
vp run fw-check
vp run graph-assertions
```

Tailwind is the default app styling path. Keep class names in templates as static strings so the generated CSS contains every class that can appear in SSR pages, mutation fragments, and deferred streams. Safelist classes explicitly with `@source inline("...")` in `src/styles.css` when a fragment must emit a class that cannot be discovered statically.

`src/auth.tsx` is the starter auth recipe. Pass your Better Auth server instance to `createStarterAuth(auth)` and register the returned `sessionProvider`, `signIn`, and `signOut` with your app shell. The rendered login/logout forms post directly to Jiso mutation endpoints, so they keep the no-JS POST path and only use `enhance` as a progressive upgrade.
