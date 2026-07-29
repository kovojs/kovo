# Public API migration protocol

Kovo is in technical preview, so a cleaner contract can replace a weak one
without a legacy compatibility mode. The removal still has to be operable:
repository users need a deterministic rewrite where intent is knowable and a
precise refusal where it is not.

The checked registry is `api-migrations.json`. The authoritative enforcement
rules are in `rules/api-surface.md`; this page describes how to prepare and land
one batch.

## Batch lifecycle

Use one batch for a coherent user task and one migration executable.

1. **`preparing`** — choose the non-`keep` decision rows, implement the tool,
   and add rewrite and refusal fixtures. The old exports remain public.
2. **`ready`** — both modes, release note, rollback instructions, rules,
   fixtures, and an exercised `--check` result exist. Run the tool across the
   repository, inspect refusals, and migrate authored consumers. The old
   exports still remain public.
3. **`removed`** — the repository, templates, examples, docs, tests, generated
   emitters, and packed consumers use the canonical home. Remove the old
   export, set its decision row to `state: "removed"` with `migrationBatch`,
   and set the batch to `removed` in the same verified checkpoint.

CI rejects a removed decision whose batch is missing, not yet `removed`, or
does not list that exact decision ID.

## Tool contract

Every tool exposes exactly these modes:

- `--check` reads files and emits the result without changing them. A rewrite
  candidate is reported as `rewritten`, even though check mode leaves bytes
  untouched.
- `--write` applies only the rewrites that check mode classified as mechanical.
  It emits the same result shape after writing.

The output uses `kovo-api-migration-result/v1`:

```json
{
  "schema": "kovo-api-migration-result/v1",
  "batch": "core-task-homes",
  "mode": "check",
  "files": [
    {
      "path": "src/app.ts",
      "state": "rewritten"
    },
    {
      "path": "src/security.ts",
      "state": "refused",
      "refusals": [
        {
          "category": "trust-decision",
          "anchor": {
            "start": 418,
            "end": 447
          }
        }
      ]
    }
  ],
  "summary": {
    "rewritten": 1,
    "unchanged": 0,
    "refused": 1
  }
}
```

Paths are canonical and repository-relative. Refusal anchors are source byte
ranges, not line-number guesses. Summary counts must exactly equal the file
records.

## Refuse instead of guessing

Mechanical import renames and unambiguous call-shape changes are rewrite rules.
A tool must refuse when a correct change depends on:

- an ambiguous binding or computed/dynamic import;
- which Kovo app owns the call;
- authentication, CSRF, or deployment posture;
- SQL meaning rather than syntax;
- a new trust or declassification decision.

The stable categories are `ambiguous-binding`, `app-context`, `auth-posture`,
`csrf-posture`, `deployment-posture`, `dynamic-import`, `sql-semantics`, and
`trust-decision`. Each refusal rule explains why a rewrite would guess intent,
and each refusal fixture proves the tool stops at the exact source span.

## Required ledger evidence

A ready or removed batch records:

- sorted decision IDs and a stable owner;
- the executable path, result schema, and exact mode arguments;
- at least one rewrite rule and at least one fail-closed refusal rule;
- non-empty rewrite and refusal fixture lists;
- a release note organized around the user task;
- clean-worktree rollback instructions;
- the command and result schema from an exercised `--check` run.

Run `pnpm run check:api-surface` before committing. After packing, run
`pnpm run check:api-surface:packed` so the new canonical homes and removed old
homes are proven against what users actually install.
