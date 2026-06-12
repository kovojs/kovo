# Deployment Notes

Jiso v1 keeps the application server stateless. Mutation responses are ordinary HTML fragments and `<fw-query>` payloads; the server answers each request from its inputs instead of retaining a session of what is currently on screen.

Per SPEC.md section 9.3, v1 liveness is intentionally limited to client-owned behaviors:

- BroadcastChannel rebroadcast shares a mutation's query response with the user's other open tabs.
- Refetch-on-focus/visibility re-runs stale queries when a backgrounded tab becomes active again.

No SSE or live bus ships in v1. SSE-backed `<fw-live>` subscriptions and live-bus infrastructure are v2 features, using the same fragment/query vocabulary as an additive transport.

Client handler modules are immutable URLs under `/c/*?v=...`. Keep old versioned client module artifacts published across deploys until documents that reference them have aged out; never rewrite a versioned `/c/` URL to the latest module.

The generated `src/app-shell.ts` module exports the same `app` for `vp dev` and `fw export ./src/app-shell.ts --out dist`, matching SPEC.md section 9.5's single request-shell path for route dispatch, document assembly, and static export replay.
