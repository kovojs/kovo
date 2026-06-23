---
name: implement-plan
description: Complete a specified Kovo active plan end to end in a new git worktree, track the effort with a Codex goal, implement and verify the plan's open checklist items, commit scoped progress, then merge the completed work back to main. Use when asked to "implement this plan", "finish plans/foo.md", "complete the roadmap item", or otherwise execute an active `plans/*.md` implementation ledger rather than merely review or update it.
---

# Implement Plan

## Overview

Execute a specified active plan as a complete implementation loop. Work in an isolated branch
and worktree, keep the main checkout stable, prove each completed checkbox with current evidence,
then integrate the finished branch back to `main`.

## Start The Goal

1. Identify the plan path from the user request. If the plan is ambiguous, inspect `plans/`
   and ask only when there is no safe inference.
2. Create a Codex goal when goal tools are available:

   ```text
   Complete <plan path> in a new git worktree, verify the completed plan items, merge the result to main, and report the final state.
   ```

3. Keep the goal active until the implementation is merged to `main` and the requested
   verification has been run, or until the same blocker has repeated for the required blocked
   threshold. Mark the goal complete only after integration is actually done.

## Read The Governing Sources

Before editing, read enough source material to understand the plan's authority and constraints:

- `SPEC.md`, especially sections cited by the plan or touched packages.
- The requested `plans/*.md` file.
- `plans/archive.md` when the active plan points to retired context.
- Relevant `rules/*.md`, including:
  - `rules/compiler-hard-rules.md` for compiler behavior.
  - `rules/api-surface.md` for public exports.
  - `rules/github-workflows.md` for workflow edits.
  - `rules/accessibility-conformance.md`, `rules/v1-acceptance.md`, or
    `rules/prelaunch-checklist.md` when the plan makes those claims.
- Local package, test, fixture, docs, and generated artifact files named by the plan.

Treat `SPEC.md` as normative. If the plan conflicts with `SPEC.md`, follow `SPEC.md` and
update the plan or stop for user direction if the conflict changes the requested scope.

## Prepare The Worktree

Protect unrelated local changes in the current checkout.

1. Inspect state:

   ```bash
   git status --short --branch
   git fetch origin main
   git rev-parse --abbrev-ref HEAD
   git rev-parse HEAD
   git rev-parse origin/main
   ```

2. Create a unique sibling worktree from the latest mainline source:

   ```bash
   slug="$(basename <plan-path> .md | tr -cs '[:alnum:]' '-' | tr '[:upper:]' '[:lower:]' | sed 's/^-//;s/-$//')"
   stamp="$(date +%Y%m%d-%H%M%S)"
   branch="agent/implement-${slug}-${stamp}"
   git worktree add "../kovo-${slug}-${stamp}" -b "$branch" origin/main
   ```

3. Do all implementation, plan updates, tests, and commits inside the new worktree.
4. Do not modify, stage, or revert unrelated files in the original checkout.

If `origin/main` is unavailable, use the local `main` branch after confirming its exact SHA. If
the requested plan depends on uncommitted user changes in the original checkout, ask before
copying or porting those changes into the worktree.

## Implement The Plan

Work from the active plan's unchecked task list.

- Choose the smallest coherent slice that materially advances or completes the plan.
- Use sub-agents when available for independent, non-overlapping plan slices, following the
  repository's AGENTS.md worktree and branch rules.
- Keep implementation aligned with existing package boundaries, helpers, emitted-artifact rules,
  and framework behavior in `SPEC.md`.
- Emit app components as TSX/JSX source. Inspect lowered IR, stamps, and generated server/client
  modules as artifacts only.
- Update active plan checkboxes only when the exact claim is verified in this session.
- Keep plan evidence concise: one focused command or authoritative file/artifact per completed
  checkbox is usually enough.
- Replace stale plan evidence with current proof instead of appending transcripts.
- Leave a checkbox open when evidence is indirect, missing, weaker than the claim, or only
  partially proves the item.

Make checkpoint commits for coherent progress after running the narrowest useful verification
for that slice.

## Verify Before Integration

Run targeted checks first, then broaden if the change touches shared behavior, package
boundaries, compiler/runtime contracts, workflows, public API, or user-facing docs. Useful gates:

```bash
git diff --check
vp check
vp test
vp run build
vp run browser
vp run integration
vp run conformance
vp run kovo-check
pnpm run check:api-surface
```

Use the plan's requested verification when it is more specific. If a command cannot run, record
the exact reason in the plan or handoff and do not mark claims fully verified.

## Merge Back To Main

Integrate only after the plan's requested scope is complete or the user explicitly accepts a
partial result.

1. In the plan worktree, ensure a clean committed branch:

   ```bash
   git status --short
   git log --oneline origin/main..HEAD
   ```

2. In the main checkout, protect local state:

   ```bash
   git status --short --branch
   ```

   If main has unrelated local changes, use a separate clean integration worktree or ask before
   proceeding. Do not overwrite user work.

3. Update main and merge the implementation branch:

   ```bash
   git checkout main
   git fetch origin main
   git merge --ff-only origin/main || git merge origin/main
   git merge --no-ff <branch>
   ```

4. Resolve conflicts by preserving the compact current plan ledger and porting only new,
   verified implementation evidence from the branch.
5. Run the relevant post-merge verification in `main`.
6. Commit conflict resolutions if the merge required them. Push only when the user requested a
   push or the repository workflow for the task requires it.
7. Remove the temporary worktree only after integration succeeds or the branch is explicitly
   abandoned:

   ```bash
   git worktree remove <worktree-path>
   ```

## Handoff

Report:

- Plan completed or remaining open items.
- Worktree path, branch name, and commit range merged.
- Files changed, grouped by purpose.
- Verification commands and results, including any skipped checks.
- Main branch merge commit or final SHA.
- Push status and any follow-up needed.
