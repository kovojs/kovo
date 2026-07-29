# Style API v1: opaque handles

Kovo style values are now opaque `StyleHandle` capabilities. `style.create(...)` returns one
handle per namespace, and `style.attrs(...)` accepts only handles created by the same installed
copy of `@kovojs/style`, falsy values, or nested arrays of those values. Object spreads, casts,
legacy `$$css` records, and raw representation tuples no longer cross the runtime provenance
check.

This change removes representation details from packed declarations, prevents application code
from forging compiler-owned styles, and lets the compiler change its extraction metadata without
changing the app contract. A duplicate installed copy of `@kovojs/style` is rejected with an
actionable error instead of being accepted structurally.

The root theme API now has one app story: `defineTheme({ seed, ...options })`. The unrelated
variable-override `createTheme` API and low-level theme helper aliases are removed. Use
`DefineThemeOptions`, `KovoTheme`, and `ThemeTokens` for the supported aggregate contracts.

Before upgrading, run:

```sh
kovo fix api-v1 --check src
```

The migration rewrites the representation-era `StyleRecord` type to `StyleHandle`. It refuses
theme and low-level helper migrations because selecting a seed theme or redesigning a public
type requires application intent. Resolve those anchored refusals, then run
`kovo fix api-v1 --write src`.

Rollback requires a clean worktree: restore the prior Kovo package versions and reverse only the
`StyleRecord` to `StyleHandle` edits reported by the migration result. Do not mechanically
recreate the retired representation fields or raw tuple form.
