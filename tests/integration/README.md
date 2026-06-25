# Integration Test Rules

Framework-owned integration specs should drive public app APIs by default. `@kovojs/test/internal/integration`
is the Playwright harness for these framework tests; other `@kovojs/*/internal` or
`@kovojs/*/generated` imports are allowed in `tests/integration/specs/**` only when the spec is directly
about a generated/internal ABI and is listed with a reason in
`tests/integration-import-boundary.meta.test.ts`.

Fixture app-source migration is tracked separately by `plans/better-testing.md`: app-authored fixtures
should move toward TSX/public imports, while lowered-IR or package-internal fixture imports remain legacy
debt until the corresponding fixture is migrated.

## Assertion Tiers

Tier 1 assertions are semantic user-visible checks through the Playwright page and `@kovojs/test`
integration helpers: roles, text, focus, form state, navigation, and semantic HTML snapshots when DOM
shape is the behavior.

Tier 2 assertions are protocol and header checks for framework wire contracts: mutation/query headers,
cookies, cache posture, content types, redirects, and fragment response vocabulary. Prefer shared helpers
from `@kovojs/test/headers` for these checks.

Tier 3 assertions inspect generated artifacts or internal ABI only when public behavior cannot expose the
contract. These specs must be narrow and allowlisted in the import-boundary meta-test when they import
non-harness internal/generated subpaths.
