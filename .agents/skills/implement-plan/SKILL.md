---
name: implement-plan
description: Complete a specified Kovo active plan end to end in a new git worktree, track the effort with a Codex goal, coordinate sub-agent workers for disjoint implementation slices, integrate and verify worker commits in the main agent worktree, push batches, and monitor CI. Use when asked to "implement this plan", "finish plans/foo.md", "complete the roadmap item", or otherwise execute an active `plans/*.md` implementation ledger rather than merely review or update it.
---

# Implement Plan

## Overview

Execute a specified active plan as a complete implementation loop. Work in an isolated integration
branch and worktree, keep the main checkout stable, delegate independent implementation slices to
worker-owned worktrees, prove each completed checkbox with current evidence, then push integrated
batches to `main` and monitor CI. Once fan-out begins, keep the main agent focused on integration,
verification, push, and CI follow-through rather than owning broad production slices directly.

## Start The Goal

1. Identify the plan path from the user request. If the plan is ambiguous, inspect `plans/`
   and ask only when there is no safe inference.
2. Create a Codex goal when goal tools are available:

   ```text
   Complete <plan path> in a new git worktree, coordinate worker slices, verify and push integrated batches to main, monitor CI, and report the final state.
   ```

3. Keep the goal active until the implementation is pushed to `main`, CI has been monitored for
   the pushed batch, and the requested verification has been run, or until the same blocker has
   repeated for the required blocked threshold. Mark the goal complete only after integration is
   actually done.

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

## Prepare The Integration Worktree

Protect unrelated local changes in the current checkout.

1. Inspect state:

   ```bash
   git status --short --branch
   git fetch origin main
   git rev-parse --abbrev-ref HEAD
   git rev-parse HEAD
   git rev-parse origin/main
   ```

2. Create a unique sibling integration worktree from the latest mainline source:

   ```bash
   slug="$(basename <plan-path> .md | tr -cs '[:alnum:]' '-' | tr '[:upper:]' '[:lower:]' | sed 's/^-//;s/-$//')"
   stamp="$(date +%Y%m%d-%H%M%S)"
   branch="agent/implement-${slug}-${stamp}"
   git worktree add "../kovo-${slug}-${stamp}" -b "$branch" origin/main
   ```

3. Keep this worktree as the main-agent integration lane. The main agent reviews and integrates
   worker commits here, resolves conflicts here, updates active-plan evidence here, runs broader
   verification here, pushes batches from here, and monitors CI from here.
4. Do not modify, stage, or revert unrelated files in the original checkout.

If `origin/main` is unavailable, use the local `main` branch after confirming its exact SHA. If
the requested plan depends on uncommitted user changes in the original checkout, ask before
copying or porting those changes into the worktree.

## Main Agent And Worker Split

Default to an integration-led strategy when the plan has multiple independent open items:

- Keep the main agent in the plan integration worktree. The main agent owns roadmap sequencing,
  worker prompt design, worker commit review, conflict resolution, plan evidence, final gates,
  batch commits, pushes to `main`, and CI monitoring.
- Treat the main agent/worktree as the integration lane. It should avoid implementing active worker
  slices and should make production edits only for integration fixes, conflict resolution,
  verification fallout, or a deliberately serialized slice that would collide with workers.
- Spawn 3-5 workers at once when there are enough disjoint open items. Give each worker a coherent
  production slice, explicit file/module ownership, and instructions to create its own sibling
  worktree and branch from the current integration `HEAD`.
- For security or hardening plans, good concurrent worker slices are independent areas such as
  runtime sink event drain, inline sanitizer parity or parity gates, endpoint posture starter/CI
  gates, static export symlink/race handling, pack security gates, and egress hardening. Treat this
  as a pattern for slice sizing, not as a fixed checklist.
- Assign large closure-oriented slices, not tiny research tasks. Each worker should own production
  changes, focused tests, `git diff --check`, `check:vp`, and a scoped commit in its branch.
- Tell workers they are not alone in the codebase, must not edit active plan ledgers, must not
  push, and must not revert or overwrite other workers' changes.
- Keep worker write sets disjoint. If two plan items would touch the same files or generated
  artifacts, serialize them or keep one in the main agent worktree.
- When assigning workers, name the intended ownership boundary directly: files, packages,
  generated artifacts, and tests they may edit. The boundary should be broad enough for a complete
  production slice and narrow enough to avoid merge conflicts with other workers.
- Use `gpt-5.5` with medium reasoning for high-risk compiler/runtime/server/security slices. Use
  `gpt-5.4` with medium reasoning for straightforward fixtures, docs, or narrow tests.
- Worker prompts should include the expected handoff: worktree path, branch name, commit SHA or
  range, files changed, verification commands and results, remaining risks, and any conflicts they
  intentionally avoided.
- While workers run, the main agent should review completed commits, run integration checks, fix
  GitHub auth, push, or CI issues, or prepare the next non-overlapping integration step. Do not
  duplicate active worker implementation.
- Integrate worker branches one at a time with review. Cherry-pick or merge into the integration
  worktree, resolve conflicts, run the focused verification for that slice, update plan evidence
  only after verification, and commit the integrated result.
- Push after a coherent batch of 2-3 integrated slices, or sooner when CI feedback is needed to
  unblock confidence. Monitor GitHub checks after every push and repair CI failures in the main
  integration worktree.
- Close worker agents and remove worker worktrees only after their commits are integrated or
  explicitly abandoned.

Temporarily skip nonessential broad gates inside worker slices unless their change requires them.
The default worker gate is focused tests plus:

```bash
git diff --check
pnpm run check:vp
```

Run `pnpm run check:api-surface` only when public types, exports, package manifests, or public
subpaths changed. Run broader verification from the main integration worktree after a batch of 2-3
integrated slices, after shared runtime/compiler/package behavior changes, and before marking the
plan complete. Fix GitHub auth, credential helpers, push failures, and delayed CI feedback as a
separate integration concern; do not make workers wait on remote push access when they can continue
producing local verified slices.

## Implement The Plan

Work from the active plan's unchecked task list.

- Choose coherent slices that materially advance or complete the plan.
- Prefer worker sub-agents for independent, non-overlapping plan slices, following the main/worker
  split above and the repository's AGENTS.md worktree and branch rules.
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

Workers make scoped commits for their own slices after focused verification. The main agent makes
checkpoint commits for coherent integrated batches after reviewing worker commits, resolving
conflicts, updating evidence, and running the narrowest useful post-integration verification.

## Verify Before Integration

Run targeted checks first, then broaden after integrating 2-3 worker slices or whenever the change
touches shared behavior, package boundaries, compiler/runtime contracts, workflows, public API, or
user-facing docs. In worker slices, prefer focused tests plus `git diff --check` and `check:vp`;
run `check:api-surface` only when public types, exports, package manifests, or public subpaths
change. Useful gates:

```bash
git diff --check
pnpm run check:vp
pnpm run check:api-surface
vp check
vp test
vp run build
vp run browser
vp run integration
vp run conformance
vp run kovo-check
```

Use the plan's requested verification when it is more specific. If a command cannot run, record
the exact reason in the plan or handoff and do not mark claims fully verified.

## Merge Back To Main

Integrate continuously in the plan integration worktree as worker commits finish. Merge or
cherry-pick worker branches into the integration branch one at a time, review the resulting diff,
and run focused post-integration checks before taking the next branch. Merge back to the
repository's `main` branch, or push directly to `main` when that is the established flow for the
task, after each coherent verified batch.

1. In each worker worktree, require a clean committed branch and a handoff before integration:

   ```bash
   git status --short
   git log --oneline <worker-base>..HEAD
   ```

2. In the plan integration worktree, merge or cherry-pick the worker branch and preserve the compact
   current active-plan ledger:

   ```bash
   git merge --no-ff <worker-branch>
   ```

   Use cherry-pick when only part of a worker branch is accepted. Do not accept stale plan versions
   from worker branches; workers should not edit active plans, and any accidental plan edits should
   be manually reviewed before inclusion.

3. In the plan integration worktree, ensure a clean committed branch before pushing or merging to
   `main`:

   ```bash
   git status --short
   git log --oneline origin/main..HEAD
   ```

4. In the main checkout, protect local state:

   ```bash
   git status --short --branch
   ```

   If main has unrelated local changes, use a separate clean integration worktree or ask before
   proceeding. Do not overwrite user work.

5. Update main and merge the implementation branch when using a separate local main checkout:

   ```bash
   git checkout main
   git fetch origin main
   git merge --ff-only origin/main || git merge origin/main
   git merge --no-ff <branch>
   ```

6. Resolve conflicts by preserving the compact current plan ledger and porting only new,
   verified implementation evidence from the branch.
7. Run the relevant post-merge verification in `main`.
8. Commit conflict resolutions if the merge required them. Push verified batches when the user
   requested push/CI follow-through or the repository workflow for the task requires it.
9. Remove temporary worker and integration worktrees only after their commits are integrated or
   explicitly abandoned:

   ```bash
   git worktree remove <worktree-path>
   ```

## Push And Monitor CI

After each pushed batch:

- Poll GitHub checks for the pushed SHA.
- Treat aggregator jobs as secondary; inspect the underlying failing shard first.
- Pull logs with `gh run view` or the Actions job log API when the workflow is still running.
- Repair CI failures in the main integration worktree, run the focused local reproduction, commit,
  push again, and continue monitoring.
- If push or `gh` access fails because auth is missing or stale, fix `GH_TOKEN`, credential helper,
  or GitHub CLI auth separately in the main integration lane. Keep local verified batches committed
  and record that CI feedback is delayed until push access is restored.
- Keep local progress moving while CI runs only when it does not conflict with diagnosing or
  repairing the current pushed batch.
- Record CI status and any delayed external checks in the handoff.

## Handoff

Report:

- Plan completed or remaining open items.
- Integration worktree path, branch name, worker branches integrated, and commit ranges.
- Files changed, grouped by purpose.
- Verification commands and results, including focused worker checks, integration gates, skipped
  checks, and CI status.
- Main branch merge commit or final pushed SHA.
- Push status, CI failures repaired or still pending, and any follow-up needed.
