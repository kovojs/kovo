# Better docs - approachable, dual human/agent docs site

Status: active. Last compacted on 2026-06-13.

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

- [ ] Write `docs/why-jiso.md`: problem, who it's for, honest trade-offs + "when not to use it",
      head-to-head comparison table (Next/Remix/htmx/Qwik/Astro). Pull the landing "break it"
      cascade (rename a column → typed errors across DB/query/binding/route) in as prose.
- [ ] Add a `docs/quickstart.md`: fastest path to a running page; lead with a visible win. Sharpen
      the deflating "pre-v1, clone the repo" framing in `installation.md`.
- [ ] Reframe `docs/mental-model.md` → "Thinking in Jiso": build the model through one worked
      example; demote the AUTHORING→IR→RUNTIME artifact diagram to a "what the compiler emits"
      subsection.

### Voice rewrite (guides + tutorial)

- [ ] Establish the voice template by rewriting 2-3 guides, starting with `guides/queries.md`, per
      the Voice Rules above.
- [ ] Rewrite remaining guides to lead with a goal and footer the citations: `mutations`,
      `optimistic`, `styling`, `deployment`, `testing`, `fw-explain`, `streaming`,
      `compiler-internals`.
- [ ] De-preach the 8 tutorial chapters: keep the tested extracted snippets, strip aphoristic
      headers and triads. (Snippets stay sourced from `site/tutorial/steps/` via `run-steps.mjs`.)

### API reference (Goal 2)

The generator (`site/scripts/api-ref.mjs`) already exists, reads JSDoc, emits real type signatures,
refuses to emit on parse errors, and reruns in the build. "227 exports, 0 documented" means the
package sources have no JSDoc — the fix is upstream, not in the markdown.

- [ ] Author verified JSDoc (purpose + `@param`/`@returns` + a real `@example`) at the package
      sources for the app-facing export tier (`component`, `query`, `mutation`, `form`, `route`,
      `domain`, guards, `respond`, …); one-liners for supporting types. Drafted from implementation + `SPEC §`, committed as source of truth — not LLM-hallucinated and committed blind.
- [ ] Audit the public surface: demote/remove truly-internal exports from `packages/*/src/index.ts`
      (server alone exports 227); shrink the documented surface to what app authors call.
- [ ] Upgrade `api-ref.mjs`: render `@param`/`@returns` as tables and `@example` as fenced
      sections (today `renderEntry` dumps the whole JSDoc as one blob + signature).
- [ ] Typecheck `@example` snippets in CI so the refs cannot lie (extract-and-compile, mirroring
      the tutorial's `run-steps.mjs`/`extract-snippets.mjs`).

### Agent layer (dedicated)

- [ ] Generate `llms.txt` + `llms-full.txt` from the same sources (human pages + agent bundle from
      one source, including the now-documented API markdown).
- [ ] Build a diagnostics→fix catalog: the `FW###` registry as an indexed reference page.
- [ ] Add a per-page collapsible "Spec & diagnostics" footer carrying the precision moved out of
      prose.
- [ ] Ship a canonical copy-paste examples set agents can pattern-match against.

### Gates / no-drift

- [ ] Ratchet API-ref doc coverage in `fw-check`: app-facing exports must be documented and
      coverage cannot regress (generator already counts `documented`; today it only prints it).
- [ ] Keep the site link-check and build green as part of existing site gates.

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
