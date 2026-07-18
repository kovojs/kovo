---
name: dogfood-and-fix
description: Exhaustively dogfood Kovo, file or triage bugz/papercuts ledgers, then implement the fixes through verified parallel worktree batches. Use when asked to dogfood and fix, handle remaining dogfood reports, continue after bugz/papercuts reports, implement newly found Kovo issues, parallelize dogfood remediation, push fixes, keep going until no new dogfood issues remain, or monitor CI until the reports no longer expose open issues.
---

# Dogfood And Fix

## Overview

Run the complete Kovo feedback loop: exercise real apps against the local framework, classify
confirmed failures into `plans/bugz-*.md` or `plans/papercuts-*.md`, implement the fixes, verify
the exact claims, push coherent batches, follow CI until the pushed state is known, then continue
with the next dogfood or report-closure pass until no confirmed issues remain or the user stops.

This skill composes the repo-local dogfood and implementation disciplines. Use the current
`SPEC.md`, `AGENTS.md`, `rules/`, active `plans/`, and existing `dogfood` / `implement-plan`
skills as governing context when available, but keep this loop focused on closing reports rather
than only writing them.

## Entry Modes

- **Named reports first.** If the user names specific `plans/bugz-*.md` or
  `plans/papercuts-*.md` files, implement those before creating new reports. Treat each unchecked
  task-list item as open until same-session evidence proves it fixed. If a named current report is
  not registered, enroll it before treating it as an active transient ledger.
- **Dogfood then fix.** If the user asks for a fresh dogfood pass, create the next appropriate
  ledger(s), reproduce and classify issues, then immediately implement the confirmed items unless
  the user explicitly asks for report-only mode.
- **Resume loop.** If prior batches were pushed, inspect `git status`, recent commits, open plan
  checkboxes, and CI before continuing. Do not redo closed work unless a regression reproduces.
- **Keep going.** If the user says to keep going until there are no bugs or papercuts, alternate
  report closure, fresh dogfood, focused verification, and CI repair until the current evidence has
  no open dogfood-derived items. Respect any explicit deferrals, such as postponing a performance
  optimization, and record the deferral instead of silently doing that work.

## Sources Of Truth

Read enough before editing to judge behavior correctly:

- `SPEC.md` is normative. Cite the relevant section in tests, diagnostics, plan evidence, or handoff
  notes when it prevents ambiguity.
- `AGENTS.md` and `rules/*.md` govern repo discipline, plan evidence, compiler behavior, API
  surface, workflow edits, docs, and release claims.
- `plans/security-ledger-index.json` and `plans/security-ledger-index.md` define active roadmaps,
  transient reports, historical dedup roots, and the closure/publication/archive lifecycle. Do not
  infer active reports from filename patterns or checkbox counts.
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
- **Close at the bug's own layer, not an adjacent proxy.** The closing evidence MUST be the ledger
  item's own `Acceptance:`/`Repro` clause, executed at the layer where the bug is observable. A
  passing unit test that asserts build-graph/renderer internals does NOT close an item whose symptom
  is in the deployed artifact (a `kovo build` output served by `node dist/server/server.mjs`). For
  any item observable end-to-end (mutation success body, island deploy/hydrate, response headers,
  static-export output, streaming), the close-out must run the relevant split starter e2e
  (`packages/create-kovo/src/index.build.prod-artifact.test.ts`,
  `packages/create-kovo/src/index.build.runtime.test.ts`, or
  `packages/create-kovo/src/index.build.scaffold.test.ts`, and the CI `starter` job) GREEN — and add the
  item's repro there as a new `it()` when it is not already covered. Do not merge or push a batch while that
  e2e is red.
- Keep active ledgers compact. Replace stale evidence with current proof; do not append long command
  transcripts or historical logs.
- When integrating a branch forked before ledger cleanup, preserve the compact main-thread ledger
  and port only the new evidence required by the integrated fix.
- Keep every current report explicitly registered with the transient content marker and a deadline
  no more than 30 days after opening. Multiple transient reports are valid.
- When all items close, record exact evidence, `closedOn`, and `closed-pending-publication`. After the
  closing commit reaches the intended remote ref and required CI is known, record publication proof
  and use `published-pending-archive`. Before `archiveBy`, replace the transient marker with
  `<!-- kovo-security-ledger: archived -->`, move the report to its declared `plans/history/` path,
  and remove its transient entry; preserve one compact series summary for future deduplication.
- Run `pnpm run check:security-ledger-index` after every lifecycle transition.

## Parallel Strategy

Default to a fan-out when reports expose independent ownership boundaries. Keep the main agent on
the integration lane and delegate closure-oriented slices where sub-agent tools are available. Do
not wait for the user to ask how to parallelize if the active ledgers already expose disjoint
compiler, runtime, browser, Drizzle, starter, docs, or verification surfaces.

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
- Integrate one worker branch at a time. Review the diff, run the worker's focused verification in
  the integration worktree, port only concise plan evidence, then checkpoint before taking the next
  branch when the integration risk is material.
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
8. Update report checkboxes only after verification, with concise evidence beside the item. Move a
   fully closed transient report to `closed-pending-publication` in the registry.
9. Commit coherent batches. Push after meaningful closure or when CI feedback is needed.
10. Monitor GitHub Actions for the pushed commit. If CI fails, inspect logs, fix the root cause,
    push again, and continue monitoring.
11. Record verified publication, then archive the report before its registered deadline.
12. After named reports close, run at least one fresh dogfood or targeted regression pass that
    exercises the just-fixed surfaces. If it finds new confirmed issues, create or update the next
    compact registered ledger and loop back through implementation.

## Completion Criteria

Finish only when all of these are true:

- every named report has no unchecked actionable items;
- any newly created dogfood ledger either has no confirmed issues or all confirmed issues are fixed
  with current evidence;
- explicit deferrals are listed as deferred, not silently counted as complete;
- no transient ledger is overdue or missing its marker/registry entry;
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
