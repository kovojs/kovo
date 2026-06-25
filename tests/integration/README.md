# Integration Test Rules

Framework-owned integration specs should drive public app APIs by default. `@kovojs/test/internal/integration`
is the Playwright harness for these framework tests; other `@kovojs/*/internal` or
`@kovojs/*/generated` imports are allowed in `tests/integration/specs/**` only when the spec is directly
about a generated/internal ABI and is listed with a reason in
`tests/integration-import-boundary.meta.test.ts`.

Fixture app-source migration is tracked separately by `plans/better-testing.md`: app-authored fixtures
should move toward TSX/public imports, while lowered-IR or package-internal fixture imports remain legacy
debt until the corresponding fixture is migrated.
