# Better docs - approachable, dual human/agent docs site

Status: **substantially complete** (2026-06-13). Goal 1 (positioning) and Goal 2 (guides/tutorial/
API refs + agent layer) shipped on `main`; site build + link-check + `@example` gate green. Two
items remain by choice: the public-surface audit (deferred — would break pinned export tests) and a
dedicated canonical-patterns page (stretch; substantially served by the 50 API examples + llms-full).

Scope: `site/content/{docs,guides,tutorial}`, `site/gen/api`, `site/scripts/api-ref.mjs`, the
package-source JSDoc that feeds it, and a new agent-facing layer (`llms.txt`, diagnostics catalog).
Behavior source of truth stays `SPEC.md`; this plan changes docs and source JSDoc, not framework
behavior. Keep this file compact: checklist, open work, risks, proving commands.

## Goals

1. Explain why to use Jiso, the trade-offs, and how it differs from other frameworks. Today this
   exists only in `SPEC.md §1-3` (implementer-facing) and a landing tagline — no docs-site page.
2. Detailed guides/examples/API references that both AI agents and humans can use to write Jiso
   proficiently.

## Locked Decisions

- Positioning is **honest & direct**: name Next/Remix/htmx/Qwik/Astro head-to-head, state concrete
  trade-offs and where Jiso loses (no offline-first, not for Figma-class apps, no client router,
  Chromium-led enhancements degrade gracefully — `SPEC §1.3`, `§3.1`). Model on Astro's "Why Astro?".
- Agent layer is **dedicated**, not an afterthought: `llms.txt` / `llms-full.txt`, a
  diagnostics→fix catalog, canonical copy-paste examples, and a per-page collapsible
  "Spec & diagnostics" footer. One source feeds both human pages and the agent bundle.

## Voice Rules

The current docs read as a spec annotated for insiders. Diagnosed tells: inline `SPEC §x`/`FW###`
citation litter in teaching prose; aphoristic section headers ("The wire is the documentation");
abstraction-first/example-second openers; the "not X, but Y"/triad rhythm as the default sentence;
reference-grade precision injected mid-lesson; self-congratulation. Rewrite rules:

- Lead with a task or scenario, not a definition. Show code before explaining it.
- Plain task-shaped headings ("Add a click handler"), not theses.
- Second person; one idea per sentence.
- Move every `SPEC §`/`FW###` out of prose into a collapsible footer or reference table.
- Ban the triad as the default sentence shape; cut self-praise.

## Checklist

### Positioning & concept pages (Goal 1)

- [x] Write `docs/why-jiso.md`: problem, who it's for, honest trade-offs + "when not to use it",
      head-to-head comparison table (Next/Remix/htmx/Qwik/Astro), landing "break it" cascade as
      prose. (Committed `271ceb86`; build + link-check green.)
- [x] Add a `docs/quickstart.md`: fastest path to a running page; status note demoted to a callout.
      Sharpened `installation.md` to prerequisites + scaffold + strict-TS rationale (reordered).
- [x] Reframe `docs/mental-model.md` → "Thinking in Jiso": built through the cart-badge example;
      AUTHORING→IR→RUNTIME diagram demoted to a "What the compiler emits" subsection.

### Voice rewrite (guides + tutorial)

- [x] Establish the voice template by rewriting `guides/queries.md` per the Voice Rules (scenario
      opener, plain headings, second person, citations in a `<details>` footer). It is the exemplar
      the rewrite lanes copy.
- [x] Rewrite remaining guides to lead with a goal and footer the citations: `mutations`,
      `optimistic`, `styling`, `deployment`, `testing`, `fw-explain`, `streaming`,
      `compiler-internals`. Integrated `8ab1dabc`; all code/captures preserved, build + link-check green.
- [x] De-preach the 8 tutorial chapters: kept the tested extracted snippets (all `{{snippet}}`
      markers byte-identical), stripped aphoristic headers/triads, citations to per-chapter footers.
      Integrated `79e5cd9e`; build resolves all snippets, link-check green.

### API reference (Goal 2)

The generator (`site/scripts/api-ref.mjs`) already exists, reads JSDoc, emits real type signatures,
refuses to emit on parse errors, and reruns in the build. "227 exports, 0 documented" means the
package sources have no JSDoc — the fix is upstream, not in the markdown.

- [x] Author verified JSDoc (purpose + `@param`/`@returns` + a real `@example`) at the package
      sources for the app-facing export tier; one-liners for supporting types. Documented exports
      1 → 201 (core 59, server 98, runtime 21, test 18, drizzle 5); comment-only, export-pin tests
      stayed green. Integrated `8c02e44f`.
- [ ] Audit the public surface: demote/remove truly-internal exports from `packages/*/src/index.ts`.
      **Deferred — risky:** the acceptance suite pins exact public export sets, so removing exports
      breaks `packages/server/src/api/app.test.ts` and others. Undocumented internals stay flagged
      `*Undocumented.*` by the generator (never omitted). Revisit as its own slice if desired.
- [x] Upgrade `api-ref.mjs`: render `@param`/`@returns` as tables and `@example` as fenced
      sections. Integrated `e5734296`; generator tests cover the new rendering.
- [x] Typecheck `@example` snippets so the refs cannot lie: `site/scripts/api-examples-check.mjs`
      extracts every `@example` block and compiles them — 50/50 pass; wired as `site` `api:check`.

### Agent layer (dedicated)

- [x] Generate `llms.txt` + `llms-full.txt` from the same sources during `build.mjs` (index +
      ~399KB full corpus with snippets/captures substituted, SPEC appended). Integrated `447d9613`.
- [x] Build a diagnostics→fix catalog: `site/gen/reference/diagnostics.md` generated from
      `diagnosticDefinitions`, all 35 `FW###` codes, in a new Reference section + top nav.
- [x] Add a per-page collapsible "Spec & diagnostics" footer carrying the precision moved out of
      prose. (Done inline in every rewritten page via `<details>`; lanes replicate it.)
- [ ] Ship a canonical copy-paste examples set agents can pattern-match against. (Partially served
      by `llms-full.txt` + the example-bearing API refs + guides; a dedicated patterns page is the
      remaining stretch item.)

### Gates / no-drift

- [x] Ratchet API-ref doc coverage: enforced via per-package coverage-floor assertions in
      `site/scripts/api-ref.test.mjs` (documented counts can't drop below the floor), plus the
      `@example` typecheck gate. Lives in the site test rather than `fw-check`, but the
      no-regression intent holds.
- [x] Keep the site link-check and build green: `node site/scripts/build.mjs` (81 pages, 5 sections)
      and `node site/scripts/check-links.mjs` (16,557 internal links) both EXIT 0 after the full wave.

## Suggested Sequence

`why-jiso` + `Thinking in Jiso` first (closes Goal 1, highest leverage) → rewrite `queries.md` as
the voice template → fan out remaining guide/tutorial rewrites (parallelizable) → API JSDoc +
generator upgrade + agent layer.

## Proving Commands

- `node site/tutorial/run-steps.mjs` — typecheck/compile/test every tutorial step (keeps snippets honest).
- `node site/scripts/api-ref.mjs` — regenerate `site/gen/api/*.md`; reports `documented`/`exports`.
- `node site/scripts/check-links.mjs` — internal link integrity.
- `node site/scripts/build.mjs` — full site build.
- `pnpm run check:fw` — framework semantic checks (target home for the API-ref coverage ratchet).
