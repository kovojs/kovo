# Agent Instructions

## Framework Source of Truth

- Treat `SPEC.md` as the normative source of truth for how the Jiso framework should behave.
- Use `IMPLEMENT_v1.md` as the implementation roadmap and sequencing plan. If it conflicts with `SPEC.md`, follow `SPEC.md` for behavior and update the implementation plan or ask before coding through the conflict.
- When implementing or reviewing framework behavior, cite the relevant `SPEC.md` section in comments, tests, diagnostics, or handoff notes where that context would prevent ambiguity.

## Progress Discipline

- Make commits at meaningful checkpoints instead of accumulating a large uncommitted diff.
- Run the relevant tests or checks before each checkpoint commit.
- Use the narrowest useful verification for the change just made, then broaden verification when touching shared behavior, package boundaries, or docs/runtime behavior.
- If a check cannot be run, record why in the handoff/final response and do not imply the checkpoint is fully verified.
- Keep commits scoped to coherent progress: scaffold, shared infrastructure, one primitive/component family, docs/demo updates, or test coverage.
