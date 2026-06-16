# Framework Rules

`SPEC.md` is the source of truth for how Kovo works. Keep local conventions in this project aligned with the spec instead of inventing app-only behavior.

The v1 implementation depends on these hard rules:

- Generated output must remain authorable Kovo source, and the fixpoint test must stay in CI.
- Handler references, fragment targets, form fields, query bindings, guards, invalidations, and optimistic coverage are checked by TypeScript static checking plus `kovo check`.
- `data-bind` paths must exist in declared query result shapes; column renames should fail static checks instead of becoming stale DOM.
- Use Tailwind as the default app styling path. Keep class names statically discoverable or safelisted with `@source inline("...")` so SSR pages, mutation fragments, and deferred streams never reference missing CSS.
- Route writes through domain functions. Direct database access in mutation handlers is a framework lint because invalidation and verification depend on the domain graph.
- The v1 server is stateless. Liveness comes from BroadcastChannel rebroadcast and refetch-on-focus/visibility, not Redis, SSE, or a live bus.
- Unguarded mutation review should use `kovo explain --unguarded graph.json` as the stable audit path.
- Enhanced mutations must preserve the SPEC.md section 9.1 wire contract: `Kovo-Idem` replay for duplicate submissions, readable `Kovo-Fragment`/`Kovo-Targets` headers, and HTML/`<kovo-query>` responses in the Network panel.
- Every mutation/query pair should have an explicit optimistic status: `hand-written` or `await-fragment`; `UNHANDLED` is a temporary development state that fails `kovo check`.
