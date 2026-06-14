# Agent Instructions

## Framework Source of Truth

- Treat `SPEC.md` as the normative source of truth for how the Jiso framework should behave.
- Use active files under `plans/` as the implementation roadmap and sequencing plan. The v1
  closeout roadmap is archived; `plans/v1-cleanup.md` is the active v1 follow-up ledger. If a plan
  conflicts with `SPEC.md`, follow `SPEC.md` for behavior and update the plan or ask before coding
  through the conflict.
- When implementing or reviewing framework behavior, cite the relevant `SPEC.md` section in comments, tests, diagnostics, or handoff notes where that context would prevent ambiguity.
- Emit app components as TSX/JSX source. Treat lowered IR, generated stamps, and emitted server/client modules as artifacts to inspect for verification, not as app-authored code to write by hand; `SPEC.md` §5.2 makes hand-authored lowered IR FW235.

## Progress Discipline

- For GitHub Actions workflow edits, follow `rules/github-workflows.md`.
- Make commits at meaningful checkpoints instead of accumulating a large uncommitted diff.
- Default to a parallel fan-out when the open plans expose multiple independent, non-overlapping implementation, audit, or verification slices that can move the active plan ledger forward concurrently. Keep one immediate critical-path task in the main worktree, and delegate bounded sidecar slices to up to five sub-agents at a time unless the work is tightly coupled.
- Prefer large, closure-oriented sub-agent slices that push an open plan item materially toward completion over tiny incremental edits. A delegated slice should usually own a coherent module, primitive family, runtime path, conformance gap, or plan phase and should include the production changes, tests, and evidence needed to integrate that slice.
- Match model choice to task risk when assigning main-thread or sub-agent work. Use `gpt-5.5`
  with medium reasoning for harder tasks: high-conflict implementation, cross-package behavior
  changes, compiler/runtime/server/Drizzle extraction, broad conformance work, and any slice where
  architectural judgment or integration risk is significant. Use `gpt-5.4` with medium reasoning
  for straightforward bounded tasks: focused fixture refreshes, narrow test additions, simple
  docs/plan cleanup, mechanical export assertions, and other low-risk changes with clear ownership
  and expected output.
- Each implementation sub-agent should work in its own git worktree and branch, with explicit file/module ownership and instructions not to revert others' work. Sub-agents should hand off the branch, commit range, verification results, and any integration notes to the main agent; the main agent remains responsible for merging worktrees back, resolving conflicts, running final gates, and creating checkpoint commits unless the delegation explicitly says otherwise.
- To set up a sub-agent worktree, create a unique branch and sibling directory from the current `HEAD`, for example `git worktree add ../jiso-agent-compiler -b agent/compiler-phase-0 HEAD`. Run package install/setup in that worktree if needed, do the delegated edits there, commit only that slice on the agent branch, then report the worktree path, branch name, commit SHA/range, tests run, and remaining risks back to the main agent. The main agent should merge or cherry-pick from that branch, run integration gates in the primary worktree, and remove the sub-agent worktree only after the work is integrated or abandoned.
- Run the relevant tests or checks before each checkpoint commit.
- Use the narrowest useful verification for the change just made, then broaden verification when touching shared behavior, package boundaries, or docs/runtime behavior.
- If a check cannot be run, record why in the handoff/final response and do not imply the checkpoint is fully verified.
- Keep commits scoped to coherent progress: scaffold, shared infrastructure, one primitive/component family, docs/demo updates, or test coverage.
- Only mark plan or roadmap checkboxes complete when the same session verifies cited file, test,
  command, or generated-artifact evidence for the exact claim. Evidence lines must name the
  verifying test/command or the authoritative file/artifact inspected; if evidence is missing,
  indirect, or weaker than the checkbox text, leave the item open and record the gap.
- Treat active plan files as compact current-state ledgers, not append-only audit logs. Keep them
  focused on the checklist, open work, current risks, and latest proving commands; summarize or
  archive repetitive historical evidence instead of growing long transcripts of partial slices.
- When integrating a branch forked before a plan compaction, do not accept the branch's stale plan
  version wholesale. Keep the compact main-thread ledger, manually port only the new implementation
  evidence needed for the integrated slice, and verify line counts stay reasonable before committing.
- When creating or updating active plan files, express every actionable open item as a GitHub
  task-list checkbox: `- [ ]` for open items and `- [x]` only when the exact item is fully
  verified. Keep evidence nested under the checkbox it proves, and avoid free-form open-item
  bullets that cannot be mechanically scanned.
