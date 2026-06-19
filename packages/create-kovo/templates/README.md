# Kovo Starter

This starter uses Vite+ for local dev/test workflows and `kovo build` for production artifacts:

```sh
vp check
vp test
npm run build:prod
vp run export
vp run preview-static
npm run serve
npm run serve:dev
vp run emit-graph
vp run kovo-check
vp run graph-assertions
```

`src/app-shell.ts` exports the Kovo app used by `vp dev`, `kovo build`, and static export. The root `index.html` is only a Vite asset-build entry; route documents come from the app shell per SPEC.md section 9.5. `npm run build:prod` emits the node preset into `dist/server`, and `npm start` runs the generated `dist/server/server.mjs` production server without Vite in the request path. `npm run serve` rebuilds first, then starts that generated server for a local production check. `npm run serve:dev` keeps the old Vite-backed middleware stack for local source-serving checks and prints `starter-serve/v1` with the local origin. `vp run export` and `npm run static` first build the Vite assets, then call `kovo export --vite` so the command loads the app shell with the built CSS href, replays the route document, copies the `/c/` module, and copies manifest assets into `dist`; `vp run preview-static` serves only those exported `dist` files and prints `starter-static-preview/v1` for local static-host checks. If a route becomes non-exportable, the task prints stable `starter-export/v1` diagnostics and exits nonzero instead of writing a misleading static build.

`@kovojs/style` is the default app styling path. Define typed style objects with `style.create(...)`, apply them with `style.attrs(...)`, and keep raw global document defaults in `src/styles.css`. Change the seed and custom colors in `src/theme.ts` to retheme the starter; the app shell inlines the generated theme variables with the initial StyleX-compatible atomic CSS while preserving the linked stylesheet identity required by SPEC.md section 13.1.

Compiler fixpoint and render-equivalence checks are Kovo framework CI coverage. Starter apps should keep their own confidence loop on `vp check`, `vp test`, `vp run kovo-check`, and static export/preview checks.

`src/auth.tsx` is the starter auth recipe. Pass your Better Auth server instance to `createStarterAuth(auth)` and register the returned `sessionProvider`, `signIn`, and `signOut` with your app shell. The rendered login/logout forms post directly to Kovo mutation endpoints, so they keep the no-JS POST path and only use `enhance` as a progressive upgrade.
