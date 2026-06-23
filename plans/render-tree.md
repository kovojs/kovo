# RenderTree: registry-bounded dynamic rendering

Server-side rendering of LLM/DB-authored rich text that embeds a closed set of pre-approved
components as well-formed XML tags (e.g. `<kovo-chart title="Q3">…</kovo-chart>`). Safe by
construction and lazy by default; the dynamic *shape* of the tree is data-driven while the
*set* of renderable components stays statically declared and auditable.

## Design (normative: `SPEC.md` §4.10; cites §4.5 composition, §4.8 output safety, §6.3 schemas)

- Untrusted XML is parsed into a plain JSON AST — never reconstituted into HTML. The trust
  boundary is right after parse; validate-on-write (store the AST) is the recommended posture.
- A **closed registry** (`renderRegistry`) maps tag → `{ component, props }`. A tag with no entry
  cannot render a component — the pre-approval guarantee is structural.
- `renderTree` walks the AST server-side and dispatches each element through the existing server
  JSX runtime (`jsx`, `packages/server/src/jsx-runtime.ts`). This is framework-internal dynamic
  dispatch: the compiler's static-wiring ban (§4.5, KV230) governs *app-authored* TSX, not a
  framework runtime walker, so **no new compiler lowering pass is required** for the core feature.
- Security invariants:
  - Text nodes are escaped by the walker (`escapeText`) — raw `jsx` inserts children unescaped
    (jsx-runtime.ts:30-36, :473), so the walker owns this.
  - Only schema-declared props reach a component (`s.object` drops unknown keys); there is no
    `{...attrs}` passthrough of arbitrary LLM attributes.
  - Attribute/URL emission still routes through `escapeAttribute`/`safeUrlAttribute` and the
    `on*`/`srcdoc` refusal in `jsx` (defense in depth).
  - The walker never produces `trustedHtml`/`trustedUrl`, so the whole XSS review reduces to a
    single grep-able invariant.
- Fail-soft posture (agreed): invalid attrs → strip offending keys and re-parse (drop/default);
  unknown tag → render its children/text and drop the wrapper.

## Latest verification (worktree `agent/render-tree`)

- `pnpm exec vitest --run packages/server/src/render-tree.test.tsx` → 13 passed.
- `tsc -p tsconfig.json --noEmit` → no errors touching `render-tree.ts`/`rendering.ts` (one
  pre-existing unrelated `packages/icons` TS6307).
- `node scripts/api-surface-gate.mjs` → exit 0, baseline unchanged (0 new violations).
- `node scripts/import-boundary.mjs` and `exported-symbols.mjs --duplicates --check` → exit 0.
- `git diff --check` → clean.

## Checklist

- [x] AST + well-formed XML parser (`parseComponentXml`) — elements, attributes (quoted + boolean),
      text, self-closing, comments/PI/CDATA, entity decode; strict (throws `ComponentXmlError` on
      malformed input). Evidence: `parseComponentXml` tests (mixed/nested, entities, CDATA, malformed).
- [x] `renderRegistry(map)` — closed, branded registry; accepts `Component` or `{ component, props }`.
      Evidence: `render-tree.ts:renderRegistry`; exercised across renderTree tests.
- [x] `renderTree(registry, nodes, options?)` — recursive server walker; text-escape, schema-validate
      (fail-soft strip), recurse children, dispatch via `jsx`. Evidence: renderTree tests.
- [x] XSS conformance: text/attr `<script>` neutralized; `href="javascript:"` → `#`; `on*`/extra
      attrs not passed; unknown tag drops wrapper. Evidence: `render-tree.test.tsx` XSS cases.
- [x] Public API wired through `@kovojs/server` (`api/rendering.ts`) with TSDoc citing §4.10; no NEW
      `api-surface-baseline.json` violations. Evidence: api-surface gate exit 0, baseline unchanged.
- [x] `SPEC.md` §4.10 added (normative) and consistent with §4.5/§4.8/§4.9.
- [x] Integrated to `main`: `agent/render-tree` merged (merge commit `c0f0a322`); render-tree
      tests re-run green on integrated `main` (13 passed).

## Deferred (follow-ups, not v1)

- [ ] Compiler hardening: lint that `renderRegistry` values are static refs and registered
      components are non-isomorphic (server-renderable) — currently a documented contract, not a
      compile-time diagnostic.
- [ ] Streaming/incremental parse for token-by-token LLM output (v1 assumes complete, well-formed XML).
- [ ] Client-side refresh of the dynamic tree after a mutation (today it is server-rendered once,
      per §4.5; refreshing the *shape* would require the static wiring the design deliberately avoids).
