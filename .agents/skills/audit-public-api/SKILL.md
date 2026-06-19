---
name: audit-public-api
description: Audit Kovo's manifest-declared public API surface from a conservative JavaScript framework-author perspective. Use when asked to scrutinize public exports, decide whether APIs should remain public, narrow/remove exposed symbols or subpaths, compare API shape against SPEC.md and repo examples, or generate a dated public API audit report under plans/.
---

# Audit Public API

## Overview

Produce a dated audit report at `./plans/audit-api-$date-time.md` that reviews every
manifest-declared public API and ranks each public symbol or coherent symbol family as:
`Should keep`, `Borderline`, or `Definitely remove`.

Adopt the lens of a senior JavaScript framework author who has led public API design for
Next.js, TanStack, and Vite: less API is more, compatibility is expensive, internals leak
forever, and a conservative public contract is preferable to a convenient but unclear one.

## Sources Of Truth

Read these before judging API shape:

- `SPEC.md`: normative framework behavior and goals. Prioritize §§1-3 and any section
  directly governing the package under review.
- `rules/api-surface.md`: public/generated/internal/private boundary rules.
- `STABILITY.md`: stability and deprecation policy.
- `public-packages.json`: authoritative package/subpath visibility map.
- Active `plans/*.md`: current roadmap and known decisions. If a plan conflicts with
  `SPEC.md`, follow `SPEC.md` and report the conflict.
- `site/gen/api/*.md`: generated API reference, useful for the public docs view.
- `examples/`, `site/`, and package tests: usage evidence. Example usage is stronger
  evidence than internal package-to-package imports.

Generated ABI subpaths and internal subpaths are not app-facing public API. Include them only
when they leak into public signatures, look misclassified, or explain why a symbol must remain
published for compiler-emitted code.

## Inventory

Start from the manifest, not from memory or a barrel search.

Run the bundled inventory helper from the repo root:

```bash
node .codex/skills/audit-public-api/scripts/inventory-public-api.mjs --json scratch/public-api-inventory.json --markdown scratch/public-api-inventory.md
```

The helper lists manifest-public package subpaths, exported symbols, declaration locations,
JSDoc summaries/tags, generated API reference slugs, and named-import evidence from
`examples/`, `site/`, `packages/`, `tests/`, and `conformance/`. Treat its output as an
index, not as the audit itself; still inspect source and representative call sites for every
non-obvious decision.

Also run:

```bash
pnpm run check:api-surface
```

If a command fails, record the failure and continue with the best available evidence. Do not
claim complete coverage without an inventory and source review.

## Parallel Package Audit

Use sub-agents aggressively when sub-agent tooling is available. Split the audit by manifest
package/subpath ownership, not by finding type. Each sub-agent should inspect source, generated
API docs, examples/site usage, relevant SPEC sections, and the inventory rows for its assigned
package group, then return package-scoped findings in the report format below. The main agent
must synthesize the final report, normalize rankings, resolve duplicate/cross-package findings,
and verify the coverage ledger.

Prefer up to five concurrent slices:

- `core` + `style`: authoring primitives, validators, diagnostics, styling APIs.
- `server` + `better-auth`: request lifecycle, schemas, guards, auth/session integration.
- `runtime` + `compiler` + `cli` + `create-kovo`: app-authored runtime, generated ABI leaks,
  build/tooling entrypoints, command/import boundaries.
- `drizzle` + `test`: data-layer adapters, verifier/test harness public surface.
- `headless-ui` + `ui`: primitive families, copy-in/story around starter components, broad
  helper/type exposure.

Give each sub-agent these constraints:

- Do not edit files or plans; produce audit findings only.
- Rank every assigned public symbol or coherent symbol family as `Should keep`, `Borderline`,
  or `Definitely remove`.
- Ground every `Borderline` or `Definitely remove` finding in source location plus one of
  SPEC/rules/example usage/generated API docs.
- Report reviewed package/subpaths and export counts so the main agent can prove coverage.
- Call out public signatures that reference another package's questionable type, even if the
  other package is outside the assigned slice.

## Review Method

For each manifest-public package/subpath:

1. Compare the public docs (`site/gen/api/*.md`) to the declaration source.
2. Inspect example/site imports and at least one representative call site for each used API.
3. Check whether the symbol is directly grounded in `SPEC.md`, a no-JS/platform behavior,
   authoring ergonomics that cannot be moved to starter code, or a stable build/tooling
   contract.
4. Check whether the same capability can be exposed more narrowly: smaller type, fewer
   options, callback instead of object graph, starter/copy-in code instead of package API,
   `@internal`, generated ABI, private fixture package, or no export.
5. Prefer families where appropriate. Do not list hundreds of mechanically identical helper
   types one by one if they share the same rationale and recommendation. The coverage ledger
   must still prove that every package/subpath was reviewed.

## Ranking Rubric

Use exactly these ranks:

- `Should keep`: The API is app-facing, SPEC-grounded, hard to replace with local code, narrow
  enough for its job, documented, and supported by examples or a stable framework contract.
  This should be uncontroversial.
- `Borderline`: The API may be useful but has weak example evidence, duplicates another path,
  exposes too much vocabulary, has an over-broad options/type shape, is mostly convenience,
  seems premature for v1, or needs an `experimental_`/`@experimental` marker.
- `Definitely remove`: The API is internal/test/compiler machinery on an app-facing subpath,
  violates a SPEC non-goal, leaks IR or generated implementation details to humans, has no
  credible external consumer, exists only because of barrel convenience, or can be replaced by
  starter/copy-in code without reducing framework capability.

When uncertain, choose `Borderline`, not `Should keep`.

## Report Format

Create the report path with local time:

```bash
date_time="$(date +%Y%m%d-%H%M%S)"
report="./plans/audit-api-${date_time}.md"
```

Use this structure:

```markdown
# Public API Audit - YYYY-MM-DD HH:MM local

**Scope:** Manifest-public package subpaths from `public-packages.json`.
**Lens:** Conservative JS framework API review; less public API is more.
**Sources:** `SPEC.md`, `rules/api-surface.md`, `STABILITY.md`,
`public-packages.json`, `site/gen/api/*.md`, examples/site usage, source declarations.
**Commands:** inventory command, `pnpm run check:api-surface`, and any focused commands.
**Git:** current branch and commit.

## Executive Summary

- `Should keep`: N symbols/families
- `Borderline`: N symbols/families
- `Definitely remove`: N symbols/families
- Highest-leverage removals/narrowings:

## Coverage Ledger

| Package | Public subpath | Exports reviewed | Primary evidence | Coverage notes |
| --- | --- | ---: | --- | --- |

## Definitely Remove

### `package/subpath#symbol-or-family`

**Current exposure:** ...
**Evidence:** SPEC section(s), source location(s), docs/generated page, usage count or examples.
**Assessment:** ...
**Recommendation:** Remove, move to internal/generated, narrow, or replace with starter code.
**Migration note:** Keep this short and conservative.

## Borderline

Same finding shape.

## Should Keep

Same finding shape, but concise; group obvious stable primitives.

## Cross-Cutting Recommendations

Short, actionable policy or sequencing notes.

## Gaps And Follow-Up

Only include real gaps: failed commands, incomplete source review, unresolved SPEC conflicts,
or APIs that need product-owner judgment.
```

## Quality Bar

- Ground every `Definitely remove` and `Borderline` finding in at least two forms of evidence,
  usually source location plus SPEC/rule/example usage.
- Do not use "not used internally" alone as removal evidence; framework APIs can be externally
  valuable. Prefer "not used in examples and not SPEC-grounded and over-broad because ...".
- Treat tests as weaker public-demand evidence than examples, docs, and starter templates.
- Do not make API edits during an audit unless the user explicitly asks for implementation.
- Keep active plan files compact if updating them; this skill's default output is a new audit
  report, not plan checkbox churn.
