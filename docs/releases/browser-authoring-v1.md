# Browser authoring API v1

Kovo's browser authoring API now makes dependency identity and trust decisions explicit.

- `derive(...)` accepts opaque inputs created by `derive.query(query)`, `derive.state<Value>()`, or
  `derive.clock<Value>()`. Tuple and object-map callbacks infer their value types without raw
  runtime-name strings.
- Raw derive input names remain compiler-owned ABI under `@kovojs/browser/generated`; app-authored
  raw strings are rejected.
- `trustedHtml(...)` and `trustedUrl(...)` require `{ reason, source? }`. The runtime validates a
  non-empty, trimmed, bounded reason and optional source and rejects accessors, unknown fields,
  control characters, string shorthand, and missing metadata.

Run the migration in check mode first:

```sh
node scripts/migrate-browser-authoring-v1.mjs --check src
```

The tool mechanically wraps a non-empty static string reason as `{ reason: ... }`. It refuses
missing, blank, or dynamic trust metadata because inventing a justification would create security
intent. It also refuses raw derive names because only the application can choose the corresponding
query, state, or clock handle. `--write` is batch-atomic: if any file is refused, no file changes.

From a clean worktree, rollback by restoring the previous Kovo package versions and reversing only
the files reported as `rewritten` by the structured `kovo-api-migration-result/v1` result.
