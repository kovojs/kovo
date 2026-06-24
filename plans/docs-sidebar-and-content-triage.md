# Docs sidebar and content triage

## Goal

Reduce public-docs navigation noise while keeping the framework proof material discoverable from the
guides where it answers an evaluator's question.

## Completed

- [x] Collapse inactive left-sidebar groups by default.
  - Evidence: `site/src/components/chrome.tsx` renders each docs group as a `<details>` disclosure
    and sets `open` only when the current page URL is inside that group.
- [x] Remove Evidence & Design Notes from the public docs route set.
  - Evidence: `site/src/content.ts` no longer includes `content/evidence` in `SECTIONS`, so those
    notes do not receive generated pages, sidebar entries, or search entries.

## Proposal

- [ ] Merge `site/content/guides/diagnostics.md` into generated Reference.
  - Rationale: it is a lookup table, not a guide. Keep `/reference/` as the hub for API reference,
    diagnostics, and the spec; move the KV-code prose into `gen/reference` generation or link to the
    SPEC §11.3 registry from the hub.
- [ ] Merge the three example walkthroughs into the live example pages.
  - Candidates: `example-commerce.md`, `example-crm.md`, `example-stackoverflow.md`.
  - Rationale: the source and runnable app already live under `/examples/*/`; a separate guide page
    forces readers to bounce between explanation and artifact. Add a "Read the source" / "Why this
    example matters" section to each example page instead.
- [ ] Merge the two app-pattern guides into those example pages or a single "App patterns" guide.
  - Candidates: `app-pattern-dashboard-crm.md`, `app-pattern-forum-qa.md`.
  - Rationale: each pattern currently points to a matching walkthrough, so the split creates four
    pages for two ideas. Keep patterns inline with the example when they are example-specific; keep a
    single guide only if it compares patterns across examples.
- [ ] Merge `starter-to-app.md` into Quickstart.
  - Rationale: it is the next step after installation and quickstart, not a deep subsystem guide.
    Keeping it in Getting Started makes the first-run path shorter and reduces guide count.
- [ ] Merge `package-imports.md` into Components and Stability.
  - Rationale: UI/headless/icon import advice belongs in Components; public/private package boundary
    advice belongs in Stability. A standalone import-surfaces guide is mostly a cross-reference page.
- [ ] Move useful evidence notes into their owning guides and keep the rest repository-only.
  - `data-layer-dialects.md` belongs in `data-layer.md`.
  - `static-export.md` belongs in `static-export.md`.
  - `integration-testing.md` belongs in `testing.md`.
  - `worked-add-to-cart.md` belongs across `queries.md`, `mutations.md`, and `optimistic.md`, or as
    one anchored walkthrough inside the tutorial verification chapter.
  - `risk-register.md` should stay in repository docs/plans, not public docs.

## Open Verification

- [x] Run the site content/build/link gates after the route change.
  - Evidence: `mise exec node@22.23.1 -- pnpm --filter @kovojs/site test` passed 15 files/70
    tests; `mise exec node@22.23.1 -- pnpm --filter @kovojs/site build` exported 115 HTML pages with
    zero diagnostics; `mise exec node@22.23.1 -- pnpm --filter @kovojs/site check:links` passed
    25,292 internal links.
