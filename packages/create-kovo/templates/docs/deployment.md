# Deployment Notes

Kovo v1 keeps the application server stateless. Mutation responses are ordinary HTML fragments and `<kovo-query>` payloads; the server answers each request from its inputs instead of retaining a session of what is currently on screen.

Per SPEC.md section 9.3, v1 liveness is intentionally limited to client-owned behaviors:

- BroadcastChannel rebroadcast shares a mutation's query response with the user's other open tabs.
- Refetch-on-focus/visibility re-runs stale queries when a backgrounded tab becomes active again.

No SSE or live bus ships in v1. SSE-backed `<kovo-live>` subscriptions and live-bus infrastructure are v2 features, using the same fragment/query vocabulary as an additive transport.

Client handler modules are immutable URLs under `/c/__v/<version>/*`. Keep old versioned client module artifacts published across deploys until documents that reference them have aged out; never rewrite a versioned `/c/` URL to the latest module.

Kovo-owned deployment environment variables are limited to `PORT`, `HOST`, `NODE_ENV`, and `DATABASE_URL`. The Node preset reads `PORT` and `HOST` when it starts, generated container output sets `NODE_ENV=production`, and `kovo build` declares `DATABASE_URL` to presets when the bundled request handler references it. App-specific secrets remain ordinary platform environment variables and are not named by Kovo.

The generated `src/app-shell.ts` module exports the same `app` for `vp dev`, `kovo build`, and static export, matching SPEC.md section 9.5's single request-shell path for route dispatch, document assembly, and static export replay.

Production starts with the app-author build command:

```sh
npm run build:prod
```

The template `kovo.config.ts` selects `node()` by default, so the command emits a self-contained Node preset under `dist/server/`. Run it locally with:

```sh
node dist/server/server.mjs
```

For a VPS or container host, build an image from the generated preset directory:

```sh
docker build -t kovo-app dist/server
docker run -e PORT=3000 -p 3000:3000 kovo-app
```

For Vercel, switch the config preset to `vercel()` or set `KOVO_PRESET=vercel`, then run `kovo build ./src/app-shell.ts --out .` and deploy the generated Build Output API directory with `vercel deploy --prebuilt`.

For Cloudflare Workers, switch the config preset to `cloudflare()` or set `KOVO_PRESET=cloudflare`, then run `kovo build ./src/app-shell.ts`, `cd dist/cloudflare`, and deploy with `wrangler deploy`.

`vp dev` and `npm run serve:dev` use the public app-shell Vite dev plugin's adapter for local source-serving checks. Those commands are not the production serve path. `vp run export` and `npm run static` run `scripts/export-static.mjs`, which builds Vite assets first, then delegates Vite SSR app loading, built stylesheet binding, route replay, `/c/` copying, and manifest asset copying to `kovo export --vite` before writing static files to `dist`. `vp run preview-static` runs `scripts/preview-static.mjs` against only the exported `dist` tree, so local static-host checks cannot accidentally fall back to Vite source assets.
