# Agent Instructions

## Framework Source of Truth

- Treat `SPEC.md` as the normative source of truth for framework behavior.
- Treat `rules/` as standing agent, release, and conformance rules.
- Use active files under `plans/` as the implementation roadmap and sequencing plan. Completed or
  retired ledgers are listed in `plans/archive.md`; if a plan conflicts with `SPEC.md`, follow
  `SPEC.md` for behavior and update the plan or ask before coding through the conflict.
- Treat `docs/` as explanatory reference material, studies, evidence, and examples unless a rule or
  `SPEC.md` explicitly delegates authority to a docs file.
- When implementing or reviewing framework behavior, cite the relevant `SPEC.md` section in comments, tests, diagnostics, or handoff notes where that context would prevent ambiguity.
- Emit app components as TSX/JSX source. Treat lowered IR, generated stamps, and emitted server/client modules as artifacts to inspect for verification, not as app-authored code to write by hand; `SPEC.md` §5.2 makes hand-authored lowered IR KV235.

## Technical Preview Bias

- Kovo is in technical preview. Do not preserve legacy compatibility at the expense of a cleaner API,
  stronger security default, simpler invariant, or better conformance to `SPEC.md`.
- Prefer unconditional framework behavior changes when they make the model safer or clearer. Avoid
  compatibility modes, opt-in hardening, deprecation windows, or old-client fallbacks unless the user
  explicitly asks for them or `SPEC.md`/rules require them.
- When a plan item or implementation decision offers "compatibility vs stronger default", choose the
  stronger default and update the plan, `SPEC.md`, or tests to make that contract explicit.

## Progress Discipline

- For GitHub Actions workflow edits, follow `rules/github-workflows.md`.
- For compiler behavior edits, follow `rules/compiler-hard-rules.md`.
- For public API surface edits, follow `rules/api-surface.md`.
- For authored public docs under `site/content/**/*.md`, follow `rules/docs-style.md`.
- For accessibility conformance claims, follow `rules/accessibility-conformance.md`.
- For v1 acceptance or launch-readiness claims, follow `rules/v1-acceptance.md` and
  `rules/prelaunch-checklist.md`.
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
- To set up a sub-agent worktree, create a unique branch and sibling directory from the current `HEAD`, for example `git worktree add ../kovo-agent-compiler -b agent/compiler-phase-0 HEAD`. Run package install/setup in that worktree if needed, do the delegated edits there, commit only that slice on the agent branch, then report the worktree path, branch name, commit SHA/range, tests run, and remaining risks back to the main agent. The main agent should merge or cherry-pick from that branch, run integration gates in the primary worktree, and remove the sub-agent worktree only after the work is integrated or abandoned.
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
- Keep plan evidence concise. For each completed checkbox, record at most the shortest proof needed
  to justify the checkmark: usually one focused command or authoritative file/artifact plus the
  behavioral claim it proves. Do not paste command transcripts, fixture inventories, repeated root
  gate lists, or historical slice-by-slice logs into every item. Put shared verification such as
  `tsc`, API gates, or `git diff --check` in one compact "latest verification" section when useful,
  and reference that section from related checkboxes only when it directly supports them.
- When new evidence supersedes old evidence in an active plan, replace or collapse the older record
  instead of appending. If the historical detail is still valuable, move it to an archive or a linked
  handoff note; active plans should preserve decision state and current proof, not forensic history.
- When integrating a branch forked before a plan compaction, do not accept the branch's stale plan
  version wholesale. Keep the compact main-thread ledger, manually port only the new implementation
  evidence needed for the integrated slice, and verify line counts stay reasonable before committing.
- When creating or updating active plan files, express every actionable open item as a GitHub
  task-list checkbox: `- [ ]` for open items and `- [x]` only when the exact item is fully
  verified. Keep evidence nested under the checkbox it proves, and avoid free-form open-item
  bullets that cannot be mechanically scanned.

## Design Context

- The marketing/docs site under `site/` is a **brand-register** surface (the design is the product).
  Its strategic design brief lives in [`site/PRODUCT.md`](site/PRODUCT.md): register, target audience
  (senior engineers / framework evaluators, plus AI-agent builders), brand personality
  (sharp, candid, technical), anti-references, the five design principles, and the WCAG 2.2 AA
  accessibility target. Consult it before changing the site's visual design or marketing copy.
- Authored docs content under `site/content/` should be task-first, proof-backed, and progressively
  disclosed per [`rules/docs-style.md`](rules/docs-style.md): help the reader build or decide first,
  then expose Kovo's proof model, diagnostics, and SPEC links as supporting detail.
- The site's visual system is captured in `site/DESIGN.md` (tokens, typography, components). Treat
  `PRODUCT.md` as the strategic "who/what/why" and `DESIGN.md` as the visual "how it looks".
