# Deployment Notes

Jiso v1 keeps the application server stateless. Mutation responses are ordinary HTML fragments and `<fw-query>` payloads; the server answers each request from its inputs instead of retaining a session of what is currently on screen.

Per SPEC.md section 9.3, v1 liveness is intentionally limited to client-owned behaviors:

- BroadcastChannel rebroadcast shares a mutation's query response with the user's other open tabs.
- Refetch-on-focus/visibility re-runs stale queries when a backgrounded tab becomes active again.

No SSE or live bus ships in v1. SSE-backed `<fw-live>` subscriptions and live-bus infrastructure are v2 features, using the same fragment/query vocabulary as an additive transport.

Client handler modules are immutable URLs under `/c/*?v=...`. Keep old versioned client module artifacts published across deploys until documents that reference them have aged out; never rewrite a versioned `/c/` URL to the latest module.

The generated `src/app-shell.ts` module exports the same `app` for `vp dev`, `vp run serve`, and static export, matching SPEC.md section 9.5's single request-shell path for route dispatch, document assembly, and static export replay. `vp dev` and the serve commands use the public app-shell Vite dev plugin's default adapter for that exported app instead of a starter-specific Node handler. `vp run serve`, `npm run serve`, and `npm start` run `scripts/serve.mjs`, which starts the generated Vite middleware stack behind Node HTTP so document and `/c/` requests keep using the app-shell handler while source assets keep using Vite. `vp run export` and `npm run static` run `scripts/export-static.mjs`, which builds Vite assets first, loads `src/app-shell.ts` through Vite SSR with the built stylesheet href, then delegates route replay and manifest asset copying to the public app-shell Vite export bridge before writing static files to `dist`.
