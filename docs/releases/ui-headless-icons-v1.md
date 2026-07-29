# UI, headless, and icons API v1

Kovo's styled components now use direct `@kovojs/ui/<component>` imports only. The empty
`@kovojs/ui` package root has been removed, so imports state the component task and continue to
tree-shake predictably. `kovo add` discovers the installed UI package through a real component
subpath and still copies the same authored TSX.

Card now has one anatomy everywhere: `Card`, `CardHeader`, `CardTitle`, `CardDescription`,
`CardContent`, and `CardFooter`. The package registry, copy-in source, gallery fixture, API
reference, and catalog all derive or test that contract.

The headless public facades no longer expose 38 runtime projections that have no human-facing
assembly task. Application code should use the public `*Attributes` builders rather than assembling
the primitive state machine. Nine compiler-only helpers remain available only through Kovo's finite
generated ABI. A generated audit proves that primitive transition carriers are unreachable from
public and generated facades.

Every icon glyph now returns `ComponentRenderResult` from `@kovojs/core`; the redundant
`IconRenderResult` alias is removed. Before upgrading, run:

```sh
node scripts/migrate-ui-headless-icons-v1.mjs --check src
```

The tool rewrites `IconRenderResult` imports to the canonical core type. It refuses empty UI-root
imports because selecting component subpaths requires knowing each binding's component home, and it
refuses internal headless helpers because choosing the correct public attribute builder depends on
the application's rendered anatomy. Resolve the anchored refusals, then run the tool with
`--write`.

Rollback requires a clean worktree: restore the prior Kovo package versions and reverse only the
import edits named by the migration result. Do not recreate the removed UI root, copy transition
types into app code, or re-export internal headless runtime projections.
