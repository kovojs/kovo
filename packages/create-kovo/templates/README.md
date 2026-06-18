# Kovo Starter

This starter uses Vite+ as the single project entrypoint:

```sh
vp check
vp test
vp run build
vp run export
vp run preview-static
vp run serve
vp run emit-graph
vp run kovo-check
vp run graph-assertions
```

`src/app-shell.ts` exports the Kovo app used by `vp dev`, `vp run serve`, and static export. The Vite+ dev and serve paths load that app through the public app-shell dev plugin, so routed document requests for `/` and versioned `/c/` module requests are adapted from the same `Request -> Response` shell while Vite keeps serving source assets such as `/src/styles.css`. The root `index.html` is only a Vite asset-build entry; route documents come from the app shell per SPEC.md section 9.5. `vp run serve`, `npm run serve`, and `npm start` start the same Vite-backed middleware stack behind a Node HTTP server and print `starter-serve/v1` with the local origin. `vp run export` and `npm run static` first build the Vite assets, then load the app shell through Vite SSR with the built CSS href so `dist/index.html` points at the emitted `/assets/*.css` file. The public app-shell Vite export bridge replays the route document, copies the `/c/` module, and copies the manifest stylesheet into `dist`; `vp run preview-static` serves only those exported `dist` files and prints `starter-static-preview/v1` for local static-host checks. If a route becomes non-exportable, the task prints stable `starter-export/v1` diagnostics and exits nonzero instead of writing a misleading static build.

`@kovojs/style` is the default app styling path. Define typed style objects with `style.create(...)`, apply them with `style.attrs(...)`, and keep raw global document defaults in `src/styles.css`. The starter inlines its initial StyleX-compatible atomic CSS as critical CSS while preserving the linked stylesheet identity required by SPEC.md section 13.1.

Compiler fixpoint and render-equivalence checks are Kovo framework CI coverage. Starter apps should keep their own confidence loop on `vp check`, `vp test`, `kovo check graph.json`, and static export/preview checks.

`src/auth.tsx` is the starter auth recipe. Pass your Better Auth server instance to `createStarterAuth(auth)` and register the returned `sessionProvider`, `signIn`, and `signOut` with your app shell. The rendered login/logout forms post directly to Kovo mutation endpoints, so they keep the no-JS POST path and only use `enhance` as a progressive upgrade.
