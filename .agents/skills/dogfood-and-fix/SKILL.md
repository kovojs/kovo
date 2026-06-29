---
name: dogfood-and-fix
description: Exhaustively dogfood Kovo, file or triage bugz/papercuts ledgers, then implement the fixes through verified parallel worktree batches. Use when asked to dogfood and fix, handle remaining dogfood reports, continue after bugz/papercuts reports, implement newly found Kovo issues, parallelize dogfood remediation, push fixes, or monitor CI until the reports no longer expose open issues.
---

# Dogfood And Fix

## Overview

Run the complete Kovo feedback loop: exercise real apps against the local framework, classify
confirmed failures into `plans/bugz-*.md` or `plans/papercuts-*.md`, implement the fixes, verify
the exact claims, push coherent batches, and follow CI until the pushed state is known.

This skill composes the repo-local dogfood and implementation disciplines. Use the current
`SPEC.md`, `AGENTS.md`, `rules/`, active `plans/`, and existing `dogfood` / `implement-plan`
skills as governing context when available, but keep this loop focused on closing reports rather
than only writing them.

## Entry Modes

- **Named reports first.** If the user names specific `plans/bugz-*.md` or
  `plans/papercuts-*.md` files, implement those before creating new reports. Treat each unchecked
  task-list item as open until same-session evidence proves it fixed.
- **Dogfood then fix.** If the user asks for a fresh dogfood pass, create the next appropriate
  ledger(s), reproduce and classify issues, then immediately implement the confirmed items unless
  the user explicitly asks for report-only mode.
- **Resume loop.** If prior batches were pushed, inspect `git status`, recent commits, open plan
  checkboxes, and CI before continuing. Do not redo closed work unless a regression reproduces.

## Sources Of Truth

Read enough before editing to judge behavior correctly:

- `SPEC.md` is normative. Cite the relevant section in tests, diagnostics, plan evidence, or handoff
  notes when it prevents ambiguity.
- `AGENTS.md` and `rules/*.md` govern repo discipline, plan evidence, compiler behavior, API
  surface, workflow edits, docs, and release claims.
- Existing `plans/bugz*.md`, `plans/papercuts*.md`, `plans/papercuts-super-*.md`,
  `plans/archive.md`, and the named active reports prevent duplicate findings and stale evidence.
- `packages/create-kovo`, `packages/compiler`, `packages/server`, `packages/browser`,
  `packages/drizzle`, examples, templates, and generated app output identify whether a symptom is a
  framework bug, starter papercut, docs gap, or app-author mistake.

## Dogfood Rules

- Dogfood the local monorepo, not published packages, unless explicitly requested.
- Rebuild scaffold output before create-kovo testing:
  `pnpm --filter create-kovo run build:dist`.
- Scaffold under a stable real path, not `/tmp`, then run
  `node <kovo>/packages/create-kovo/dist/index.mjs <appDir> --sqlite --disable-git`,
  `node <kovo>/scripts/link-local-kovo.mjs <appDir> <kovo>`, and `pnpm install` in the app.
- After multi-app dogfood, run root `pnpm install` in the monorepo to repair link-local workspace
  side effects before trusting repo checks.
- Parse the actual dev URL from `vp dev` / `pnpm run dev` logs; ports can auto-increment and bind
  `localhost`. Kill every server started.
- Exercise the real author workflow: scaffold, install, dev boot, browser/HTTP interactions,
  per-form CSRF submission, HMR or source edits when relevant, `pnpm run check`,
  `pnpm run test`, and `pnpm run build:prod`.
- File security, soundness, provenance, fail-open, and data-corruption defects in `bugz`; file
  rough edges, missing diagnostics, starter friction, docs gaps, and awkward but safe workflows in
  `papercuts`.

## Ledger Discipline

- Use GitHub task-list checkboxes for every actionable item. Avoid free-form open items.
- Mark `[x]` only after the same session verifies the exact claim with a named file, artifact, or
  command. If evidence is weaker than the checkbox, leave it open and note the gap.
- Keep active ledgers compact. Replace stale evidence with current proof; do not append long command
  transcripts or historical logs.
- When integrating a branch forked before ledger cleanup, preserve the compact main-thread ledger
  and port only the new evidence required by the integrated fix.

## Parallel Strategy

Default to a fan-out when reports expose independent ownership boundaries. Keep the main agent on
the integration lane and delegate closure-oriented slices where sub-agent tools are available.

Main agent owns:

- reading sources of truth and sequencing reports;
- creating or selecting ledgers;
- assigning non-overlapping worker scopes;
- reviewing worker commits;
- integrating one branch at a time;
- updating plan evidence after local verification;
- checkpoint commits, pushes, and CI monitoring.

Dogfood fan-out candidates:

- baseline create-kovo starter, check, test, build, dev smoke;
- realistic commerce or CRM browser workflows;
- Drizzle relational queries, aggregates, callbacks, and query-builder extraction;
- compiler lowering, query-shape facts, live-targets, optimistic actions, and generated stamps;
- server/runtime forms, CSRF, headers, cookies, redirects, and error reporting;
- build/export/deploy skew between `vp check`, `kovo build`, and dev.

Implementation fan-out candidates:

- compiler/analyzer fixes and fixtures;
- Drizzle static extraction and helper families;
- server/runtime behavior and conformance tests;
- browser/client transforms and hydration or live-target behavior;
- create-kovo starter/template fixes and generated app gates;
- docs, examples, and plan evidence after production behavior is already proven.

Worker rules:

- Each worker uses its own sibling git worktree and branch from the current integration `HEAD`.
- Assign broad but bounded ownership: package paths, tests, generated artifacts, and report items.
- Do not let workers edit active plan ledgers, push branches, or revert unrelated work.
- Require a scoped commit plus handoff: worktree path, branch, commit SHA/range, changed files,
  tests run, results, and remaining risks.
- Prefer 3-5 workers for broad independent surfaces. Use higher-reasoning models for compiler,
  runtime, security, Drizzle extraction, and high-conflict integration; use cheaper bounded models
  for straightforward fixtures, docs, and narrow template changes.
- If no sub-agent mechanism is available, still parallelize mentally: group by ownership, avoid
  alternating across conflicting files, and commit verified batches as each coherent surface closes.

## Implementation Loop

1. Inspect state with `git status --short --branch`, recent commits, and any CI results for the
   current head. Leave unrelated untracked or modified files alone.
2. Create a goal if goal tools are available. Keep it active until named reports are closed,
   pushed, and CI has been monitored or a real blocker is reached.
3. For substantial plan work, create an integration worktree from current mainline. If the user is
   already operating in a chosen checkout and asks to continue there, protect unrelated changes and
   use the current worktree carefully.
4. Reproduce before fixing when the issue is not already proven by current evidence.
5. Implement the smallest production change that satisfies the `SPEC.md` contract and report
   acceptance criteria. Prefer stronger preview-era defaults over compatibility shims.
6. Add or update focused tests for the touched surface. Broaden checks when crossing package,
   compiler, runtime, or generated-artifact boundaries.
7. Run the narrow verification first, then shared gates such as `vp check`, relevant `vitest`
   suites, `pnpm exec tsc --noEmit`, `git diff --check`, or package-specific scripts.
8. Update report checkboxes only after verification, with concise evidence beside the item.
9. Commit coherent batches. Push after meaningful closure or when CI feedback is needed.
10. Monitor GitHub Actions for the pushed commit. If CI fails, inspect logs, fix the root cause,
    push again, and continue monitoring.

## Completion Criteria

Finish only when all of these are true:

- every named report has no unchecked actionable items;
- any newly created dogfood ledger either has no confirmed issues or all confirmed issues are fixed
  with current evidence;
- relevant local gates passed, or each skipped gate has a concrete reason;
- the branch or local `main` containing the fixes has been pushed when pushing is in scope;
- CI for the pushed commit has been checked, and any failures attributable to the work are handled
  or explicitly reported as remaining risk.

## Handoff

Report the final state succinctly:

- reports closed or created;
- commits pushed and branch/SHA;
- key verification commands;
- CI status;
- known remaining risks or intentionally deferred work.
