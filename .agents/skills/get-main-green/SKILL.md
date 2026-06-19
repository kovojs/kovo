---
name: get-main-green
description: Restore Kovo's `main` branch to green after the latest pushed commit has failing GitHub Actions checks. Use when asked to inspect the latest GitHub commit, debug failing CI or GitHub Pages runs, repair workflows or code, optionally do the repair in a separate worktree, commit and push the fix, and monitor the next Actions results.
---

# Get Main Green

## Overview

Bring the latest `main` commit back to green on GitHub Actions. Treat the live
GitHub run state as authoritative, reproduce the failing step as narrowly as
possible, land a focused repair, push it, and monitor the replacement runs.

## Sources To Read

Read these before editing:

- `rules/github-workflows.md` for workflow-specific command rules.
- `.github/workflows/ci.yml` and `.github/workflows/pages.yml` when CI or Pages fails.
- `SPEC.md` and the relevant `rules/` file when the failure concerns framework behavior,
  compiler behavior, public API, accessibility, or acceptance claims.
- Any active `plans/*.md` file governing the area being changed. If a plan conflicts with
  `SPEC.md`, follow `SPEC.md` and update or report the conflict.

## Initial Triage

1. Inspect the local state:

   ```bash
   git status --short --branch
   git rev-parse HEAD
   git rev-parse origin/main
   git log --oneline -5
   ```

2. Fetch the latest refs and identify the latest pushed commit on `main`:

   ```bash
   git fetch origin main
   latest="$(git rev-parse origin/main)"
   git show --stat --oneline --decorate "$latest"
   ```

3. Inspect live Actions for that commit, preferring failed or in-progress runs:

   ```bash
   gh run list --branch main --commit "$latest" --limit 20
   gh run view <run-id> --json name,headSha,status,conclusion,createdAt,updatedAt,url
   gh run view <run-id> --log-failed
   ```

4. If multiple workflows failed, prioritize in this order unless the user says otherwise:
   `GitHub Pages`, `CI`, then ancillary workflows. Fix a shared root cause once instead of
   making workflow-specific patches.

Do not assume a stale failure still applies. Always confirm that the failing run belongs to
the latest `origin/main` SHA before editing. If the latest run is still queued or in progress,
monitor it until it reaches a useful result unless logs already expose a deterministic setup
failure.

## Direct Or Worktree Mode

Default to repairing directly in the current checkout when the user did not ask for a worktree.
Preserve unrelated local changes: do not revert or stage files outside the fix.

If the user asks for a worktree, create one from the latest `origin/main`:

```bash
branch="agent/get-main-green-$(date +%Y%m%d-%H%M%S)"
git worktree add "../kovo-get-main-green-${branch##*-}" -b "$branch" origin/main
```

Work only inside that worktree, commit the repair there, push the branch, then merge or
cherry-pick the focused commit back to `main` after verification. Remove the worktree only
after integration or explicit abandonment.

## Diagnose And Fix

Use the failed log line to choose the narrowest local reproduction:

- Workflow setup or package-manager failure: inspect `.github/workflows/*.yml`,
  `package.json`, `pnpm-lock.yaml`, and `rules/github-workflows.md`.
- CI command failure: run the exact `vp ...` command locally first, then any narrower
  package/test command exposed by the log.
- Pages failure: reproduce the failing site step, usually one of:

  ```bash
  vp exec pnpm --filter @kovojs/example-gallery run emit:interactive-gallery
  vp run build
  vp run export
  vp run check-links
  vp exec playwright install --with-deps chromium
  vp run smoke
  ```

  Run site-scoped commands from `site/` when the workflow does.
- Browser failure: make sure the workflow installs the matching Playwright browser before
  running the browser gate. In this repo, use `vp exec playwright install --with-deps ...`.

Repo-specific workflow rules:

- Workflows that use `voidzero-dev/setup-vp` should run package-manager commands as
  `vp exec pnpm ...` unless the workflow also explicitly installs and exposes pnpm.
- Keep Playwright browser installation explicit in workflows before browser-backed gates.
  Use Chromium only for site smoke checks; use chromium, firefox, and webkit for root
  browser matrix gates.
- Keep workflow edits minimal and verify YAML syntax by inspecting the changed workflow and,
  when possible, reproducing the command locally.

## Verify Before Commit

Run the narrowest command that proves the repair. Broaden when touching shared behavior,
package boundaries, workflows, or generated site output. Useful gates include:

```bash
vp check
vp test
vp run build
vp run browser
vp run integration
vp run conformance
vp run kovo-check
```

For skill-only or docs-only edits, run the relevant validator instead of the full repo gates.
Record any skipped check and the reason in the handoff.

## Commit, Push, And Monitor

1. Stage only files that belong to the repair:

   ```bash
   git diff --check
   git diff --name-only
   git add <files>
   git commit -m "<concise fix message>"
   git push
   ```

2. After pushing, identify the new `main` SHA and monitor the next workflow set:

   ```bash
   git fetch origin main
   new_sha="$(git rev-parse origin/main)"
   gh run list --branch main --commit "$new_sha" --limit 20
   gh run watch <run-id> --exit-status
   ```

3. If the follow-up run fails, inspect the failed logs and continue the same loop. Do not
   declare `main` green until the required latest-commit workflows have succeeded or until the
   user explicitly accepts a remaining external failure.

## Handoff

Report:

- Latest fixed commit SHA and pushed branch.
- Failed workflow(s) and root cause.
- Files changed.
- Local verification commands and results.
- Follow-up GitHub Actions run URLs and final conclusions.
