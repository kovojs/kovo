---
name: dogfood
description: Dogfood Kovo by scaffolding or running a real app from the local framework, exercising ordinary user workflows, diagnosing framework and starter-template papercuts, and writing the next plans/papercuts-N.md ledger. Use when asked to "dogfood" Kovo, try create-kovo end to end, reproduce rough edges from app usage, or document papercuts without immediately fixing them.
---

# Dogfood

## Overview

Exercise Kovo the way an app author would: scaffold or run a small real app, use it through the
browser and terminal, separate app mistakes from framework/starter defects, and record the confirmed
rough edges in the next `plans/papercuts-<N>.md` ledger.

This skill finds and documents papercuts. Do not fix production code unless the user explicitly asks
for a follow-up fix pass.

## Sources Of Truth

Read these before judging behavior:

- `SPEC.md` for normative framework behavior. Cite relevant sections when a papercut violates or
  strains the framework contract.
- `AGENTS.md` and `rules/*.md` for repo discipline.
- Existing `plans/papercuts*.md`, `plans/bugz*.md`, and active plans for prior findings and current
  implementation state. New papercuts should be distinct or clearly marked as a regression/variant.
- `packages/create-kovo`, `packages/server`, `packages/browser`, `packages/drizzle`, and the app's
  generated source as needed to identify whether the rough edge belongs to the starter, runtime,
  compiler, browser loader, or app code.

## Choose The Ledger

Create the next numbered ledger under `plans/`:

```bash
next=$(
  ls plans 2>/dev/null \
    | grep -E '^papercuts(-[0-9]+)?\.md$' \
    | sed -E 's/papercuts-?([0-9]*)\.md/\1/' \
    | awk '{print ($1==""?1:$1)}' \
    | sort -n \
    | tail -1
)
echo "plans/papercuts-$(( ${next:-0} + 1 )).md"
```

If the user names an existing papercuts file, update that file instead.

## Dogfood Workflow

1. **Start from local bits.** Use the local package or packed tarball path the user wants tested. If
   exercising `create-kovo`, prefer a fresh throwaway app outside the repo such as
   `/tmp/kovo-dogfood-<date>` or the user-specified app path.
2. **Run the real workflow.** Install dependencies, start the dev server bound to the requested host
   when applicable, and use browser automation or direct HTTP calls to cover the ordinary path:
   scaffold, boot, auth, forms/mutations, query-backed regions, HMR edits, tests, and production
   build when relevant.
3. **Capture symptoms with evidence.** For every rough edge, record the exact command, URL, status
   code, response header/body shape, DOM state, terminal error, generated file, or test output that
   proves the symptom.
4. **Find the real root cause.** Read framework source and generated app code. Distinguish:
   framework bug, starter-template bug, app-author mistake, missing docs, dev-only tooling issue, or
   expected behavior with poor diagnostics.
5. **Use subagents for disputed root causes.** For broad or ambiguous failures, fan out bounded
   workers in separate git worktrees. Give each worker one question, the observed evidence, and a
   strict "diagnose, do not fix" instruction. Ask for file/line root cause, independent repro/proof,
   and confidence. The main agent owns synthesis.
6. **Minimize workaround bias.** Workarounds can help prove causality, but the ledger should describe
   the framework/starter failure and acceptance criteria, not just the workaround.
7. **Keep the main tree clean except the ledger.** Do not commit example-app experiments unless the
   user asked for a fix. Remove throwaway apps/worktrees when they are no longer needed, unless they
   are part of the requested artifact.

## Ledger Format

Write a compact task-list ledger:

```markdown
# Papercuts N

Created YYYY-MM-DD. Source of truth remains `SPEC.md`; this ledger captures
small but user-visible framework/template papercuts found while dogfooding
<app/tool/path>.

## Scope

<what was exercised, from which local package/commit, and what is intentionally out of scope>

## Issues

- [ ] **<short title>.**
  - Observed behavior: <precise symptom from the dogfood run>
  - Root cause: <exact failing mechanism, with file/function references when known>
  - Why it matters: <user-facing effect and SPEC/starter contract connection>
  - Repro evidence: <short command/browser/network/DOM/source proof>
  - Acceptance: <what a fix must prove, ideally naming a focused test or workflow>

## Refuted / Not Carried Forward

- <candidate rough edge and why it was app error, already fixed, duplicate, expected behavior, or
  insufficiently reproduced>

## Latest Verification

- `<command>`: <result and what it proves>
```

All issue checkboxes start open. Mark a checkbox complete only if this same session also implements
and verifies the fix, and include the exact evidence under that checkbox.

## Quality Bar

- Every issue has a reproduced symptom and a concrete acceptance condition.
- Root cause language names the failing component and mechanism. Avoid vague labels like "HMR issue"
  or "Drizzle extraction failed" without explaining why.
- Severity is practical rather than dramatic: papercuts are app-author friction, misleading starter
  behavior, poor diagnostics, dev loop failures, or small contract gaps. Escalate security/soundness
  defects into a `bugz` ledger instead.
- Prefer framework fixes over starter workarounds when the framework can reasonably infer, preserve,
  validate, or diagnose the behavior.
- Keep the ledger current-state focused. Do not paste long logs, transcripts, or historical debates.
