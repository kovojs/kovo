# React interop — `@kovojs/react` (workstream R)

Status: **tentative** — design directions agreed with Will 2026-06-12 (read side: tiered; write side: typed submit bridge; first paint: Kovo-authored fallback only; gating: lint + justification). **SPEC.md is intentionally untouched**; every normative change this plan needs is collected in "Deferred SPEC changes" below and lands only after this plan is approved.
Scope: a `packages/react` package (published `@kovojs/react`) that mounts real React component trees inside Kovo islands via the existing execution-trigger machinery (SPEC §4.7), with a tiered data bridge (static props → opt-in live query subscription) and a typed mutation bridge. Plus the small framework seams it requires: a React-TSX compilation boundary, a structured-props channel, morph opacity for React-owned subtrees, and new lint/diagnostic codes.

## Why

The framework's ecosystem-zero problem (no charts, editors, date pickers, kanban libraries) is the single biggest adoption blocker for React-fluent teams. The trigger system already permits mounting anything inside an island; this plan makes that path _sanctioned, typed, budgeted, and torn down correctly_ instead of hand-rolled. Framing: a **widget embassy with declared diplomatic channels** — React owns the inside of its host element and nothing else; everything crossing the boundary is serializable, declared, and visible in markup.

## Design decisions (agreed 2026-06-12)

1. **Read side — tiered.** Default: props cross **once at mount**, serialized (`JsonValue`). Opt-in: `useKovoQuery` subscribes to the client query store and re-renders the React tree on query change (the React analog of `isomorphic: true`). The live tier is separately lint-gated with its own justification.
2. **Write side — typed submit bridge.** `useKovoMutation(addToCart)` wraps the existing `ctx.submit` machinery: CSRF, `Kovo-Idem`, optimistic transforms, the exhaustive typed error union. Mutations keep originating from the Kovo mutation registry; React is just another call site. Optimistic transforms still live in mutation files, so KV310 coverage is unaffected.
3. **First paint — Kovo-authored fallback only.** The island server-renders ordinary Kovo markup (skeleton or read-only preview); React replaces it client-side when the trigger fires. No `react-dom/server`, no hydration, anywhere. `ssr: true` (renderToString + hydrateRoot) is explicitly **out of scope for R1–R4** and recorded as a possible later extension.
4. **Gating — lint + justification.** Every `reactIsland()` requires a justification comment (KV302-style). All triggers allowed; `on:load` stacks with KV211. `grep` is the app's React budget; `kovo explain` lists every React mount with its trigger and declared queries.

## Authoring surface

```tsx
// kanban.tsx — Kovo TSX
import { reactIsland } from '@kovojs/react';
import { skeleton } from './kanban-skeleton.js';

// KV340: kanban needs dnd-kit drag physics; no plan-grammar equivalent.
export const Kanban = reactIsland('kanban', {
  component: () => import('./kanban-board.react.js'), // React module, lazy by construction
  props: (p: { projectId: string }) => ({ projectId: p.projectId }), // JsonValue-constrained
  queries: { board: boardQuery.args((p) => ({ projectId: p.projectId })) }, // live tier (KV341 gate)
  trigger: 'visible', // 'visible' | 'idle' | 'interaction' (default) | 'load' (stacks KV211)
  fallback: (props) => <div class="board-skeleton" />, // Kovo TSX, server-rendered
});
```

```tsx
// kanban-board.react.tsx — React TSX (separate compilation, see boundary below)
import { useKovoQuery, useKovoMutation } from '@kovojs/react';
import { moveCard } from './board.mutations.js';

export default function KanbanBoard({ projectId }: { projectId: string }) {
  const board = useKovoQuery('board'); // must be declared on the island — KV341
  const move = useKovoMutation(moveCard); // typed input, typed error union, optimism fires
  // … dnd-kit, anything — React owns this subtree entirely
}
```

### Lowered IR / wire (no new trigger machinery)

```html
<kovo-react-kanban
  kovo-c="react:kanban"
  kovo-deps="board:proj_1"
  on:visible="/c/kanban.client.js#Kanban$mount"
>
  <script type="application/json" kovo-props>
    { "projectId": "proj_1" }
  </script>
  <div class="board-skeleton"><!-- server-rendered fallback --></div>
</kovo-react-kanban>
```

```js
// kanban.client.js — GENERATED, authorable, fixpoint holds
import { mountReact } from '@kovojs/react/runtime';
export const Kanban$mount = mountReact(() => import('./kanban-board.react.js'), {
  queries: ['board'],
});
```

`mountReact` returns an ordinary handler: read `kovo-props` JSON → `createRoot(host)` → render with props (+ a context provider carrying the query-store/submit bridge) → `ctx.signal.addEventListener('abort', () => root.unmount())`. Teardown is the existing lifecycle primitive; navigations and morph-removal already abort it.

## Boundary contract (the parts that need real design)

- **Compilation boundary.** `*.react.tsx` files compile with React's JSX runtime and are excluded from the Kovo compiler (no lowering, no KV diagnostics inside). The Vite plugin routes by extension. Importing a `.react.tsx` module anywhere except a `reactIsland().component` thunk is a compile error; importing Kovo components from a `.react.tsx` file likewise. The boundary is a file boundary so it's greppable and unambiguous.
- **Props channel.** Structured props ship as one `<script type="application/json" kovo-props>` child (mirrors `kovo-query` — legible, no attribute-string coercion). `JsonValue`-constrained at the type level; KV201-style teaching error on violation.
- **Live tier.** `useKovoQuery` may only read queries **declared on the island** (`queries:`), so `kovo-deps` stays static and `Kovo-Targets`/refetch machinery see the island like any other. Undeclared use is KV341: type-checked where TS can see it, dev-runtime-asserted regardless (the compiler cannot see into React code — that asymmetry is stated, not hidden). The loader exposes a narrow `subscribe(instanceKey, cb)` on the query store; the React side wraps it in `useSyncExternalStore`. Optimistic applies flow through the same subscription, so a `useKovoMutation` transform updates the React view instantly — the closed loop is the point of choosing both tiers.
- **Mutation bridge.** `useKovoMutation` accepts the imported mutation value only (the `form(addToCart)` value-spelling rule — no string keys, since the registry types can't reach into `.react.tsx` reliably). Returns `{ submit, pending, error }`; `submit` runs the full §10.3 client path (CSRF token from the page, `Kovo-Idem`, snapshot/transform/rebase, `<kovo-query>` reconcile). `kovo-pending` + `aria-busy` are applied to the island host.
- **Morph opacity.** After mount, the host's children are React-owned. The morph layer treats a mounted React island as a **leaf**: host attributes morph, children are never touched (extends the existing nested-island survival contract, §9.1). A `reactIsland` statically inside a `fragmentTarget` subtree is a compile error (KV342) — a server re-render would clobber React's DOM.
- **Update-coverage status.** Query-dependent positions inside React are opaque to KV311; the island's declared queries get a new §4.9 status (`react` — instant, costs React runtime + render module; requires KV340 justification). Tier-1 islands (no `queries:`) are `renderOnce`-equivalent and ship no `kovo-deps`.
- **Non-goals (R1–R4):** SSR/hydration of React content; Kovo components rendered _inside_ React trees; nested Kovo islands under a React host; React portals targeting nodes outside the host (documented hazard — see open questions); Preact aliasing; supporting multiple React majors simultaneously.

## Tentative diagnostic codes

> The implementation's diagnostic registry already diverges from SPEC §11.3 (KV302 collision noted 2026-06-12); these numbers are placeholders to be assigned during registry reconciliation, not claims.

| Code  | Severity | Meaning                                                                                        |
| ----- | -------- | ---------------------------------------------------------------------------------------------- |
| KV340 | lint     | React island — justification comment required (the React budget)                               |
| KV341 | error    | `useKovoQuery` reads a query not declared on the island (dev-runtime-asserted too)             |
| KV342 | error    | React island inside a `fragmentTarget` subtree — server re-render would clobber React DOM      |
| KV343 | lint     | Live-tier (`queries:` on a React island) — second justification (the SPA-creep gate for reads) |

## Progress checklist

- [ ] **R0 — design freeze.** Resolve open questions below; draft the deferred SPEC changes as a reviewable PR (not merged); confirm diagnostic numbers against the reconciled registry. Evidence: SPEC PR link + this plan updated with final decisions.
- [ ] **R1 — mount path.** `packages/react`: `reactIsland()`, `mountReact` runtime, `*.react.tsx` Vite compilation boundary, `kovo-props` JSON channel, fallback server-render, `ctx.signal` unmount, KV340 lint, `kovo explain` listing React mounts. Demo: one tier-1 widget (chart or counter) in `examples/`. Evidence: vitest for lowering/IR fixpoint over generated mount handlers; browser test proving mount-on-visible, props delivery, and unmount-on-island-removal (no React warnings, no leaked roots).
- [ ] **R2 — read bridge.** Query-store `subscribe()` seam in the loader; `useKovoQuery` via `useSyncExternalStore`; `kovo-deps` emission from declared `queries:`; KV341 (static + dev-runtime); KV343 gate; `react` coverage status wired into `kovo check coverage`. Evidence: browser test — mutation elsewhere on the page patches `<kovo-query>` and the React tree re-renders; coverage report golden showing `react ✓` status.
- [ ] **R3 — write bridge.** `useKovoMutation` over the `ctx.submit` machinery (CSRF, `Kovo-Idem`, snapshot/transform/rebase, typed error union, host `kovo-pending`). Evidence: browser test — submit from React fires the optimistic transform, a subscribed `useKovoQuery` view updates instantly, server reconcile is a near-no-op on correct prediction and a visible correction on wrong prediction; error-path test receives the exhaustive union.
- [ ] **R4 — hardening + docs.** Morph-opacity tests (fragment patch around a mounted island leaves React DOM untouched; KV342 golden); bundle accounting (React+ReactDOM cost reported in `kovo explain page`, measured not estimated); gallery entry; "React → Kovo" mapping doc (useOptimistic ≈ transforms, server actions ≈ mutations, …) as the migration on-ramp. Evidence: named browser suite green; docs page in repo.

## Deferred SPEC changes (do not apply until approved)

1. §4.7 or new §4.10: the React-island mount contract (trigger reuse, `kovo-props`, teardown via `ctx.signal`, morph opacity as an extension of the §9.1 nested-island rule).
2. §4.9 table: add the `react` status row.
3. §11.3: KV340–KV343 — pending the KV302 registry reconciliation, which should be fixed first and independently.
4. §15 risks table: one row — React-island creep (mitigation: KV340/KV343 budgets, `kovo explain` listing).
5. §1.3 phrasing check: "Kovo islands can host rich widgets" becomes a normative pointer to this package.

## Open questions (for R0)

1. **React portals.** Many React libs portal modals to `document.body`, escaping the host. Teardown is safe (`root.unmount()` removes portal content), but portaled nodes live outside Kovo's morph/island accounting. Options: document-as-hazard (recommended — banning kills the modal-library ecosystem this exists to import), dev-mode warning on observed escape, or hard ban.
2. **React version floor.** `peerDependencies: react ^18.2 || ^19`? `createRoot` needs 18; nothing here needs 19. Wider floor = bigger ecosystem; 19-only = simpler test matrix.
3. **Tier-1 staleness.** Static props are a snapshot; after a mutation invalidates the underlying data, a tier-1 island is silently stale (it declared no deps — `renderOnce`-equivalent, consistent with §4.9, but worth an explicit doc warning or a dev-mode hint suggesting the live tier).
4. **`emit()` from React.** Should the typed event channel (§7) cross the boundary (`useKovoEmit`)? Cheap to add, but a third bridge channel — defer unless a demo needs it?
5. **Multiple islands, one React.** Two React islands on a page share the module graph (fine) but get separate roots (intended). Any need for cross-island React state is answered "no — use Kovo coordination (§7)"; confirm we're comfortable stating that flatly.
