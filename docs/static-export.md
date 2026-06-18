# Static Export

Static export remains a framework capability, but the interactive Commerce, CRM,
and StackOverflow examples are intentionally served as dynamic app-shell demos.
Those examples should teach ordinary routes, queries, mutations, forms, and
fragment refresh rather than maintaining static-only app variants.

Regression coverage for static export lives outside those interactive examples:

- `packages/conformance-fixtures/src/kovo-export-fixtures.test.ts` exercises the
  reusable red/green static-export fixture mechanics.
- `packages/server/src/static-export-route-guards.test.ts` and
  `packages/server/src/static-export-endpoints.test.ts` cover server boundary
  behavior.
- `examples/reference/src/app-shell.test.ts` and
  `examples/gallery/src/interactive-gallery.static-export.test.ts` cover shipped
  static-output examples.
