# World-class DevEx — contract-independent API batches

Status: **active child ledger**

Charter: `plans/worldclass-devex.md` Track 5a. Dependencies: cleaned Track 2 inventory and the
Track 5 migration protocol. Gates: G17-G22. Every batch updates the owning SPEC section, manifest,
exports/build entries, reference, examples/templates, compiler identities, snapshot, codemod,
ratchet segment, and release note in one checkpoint.

## Style

- [x] Replace public style representation records and raw tuples with runtime-validated opaque
      handles.
  - Evidence: `packages/style/src/engine.test.ts` and `public-types.test.ts` prove fieldless,
    same-instance WeakMap handles and the recursive handle-only `StyleInput`.
- [x] Decide the vars-override `createTheme` user story and rename or remove it while retaining
      seed-based `defineTheme`.
  - Evidence: `packages/style/src/index.test.ts` pins `defineTheme` as the sole theme constructor;
    `spec/04-component-model.md` §13.1 records the clean-break decision.
- [x] Remove `$$css`, `data-style-src`, `__rules`, `__styleKey`, and raw tuples from packed public
      declarations.
  - Evidence: `packages/style/src/packed-api.test.ts` inspects the built declaration graph and exact
    14-name root.
- [x] Reject literal/cast forgeries at runtime and prove extracted CSS/source maps/artifacts remain
      equivalent.
  - Evidence: `packages/style/src/packed-api.test.ts` loads two independent built copies, rejects a
    foreign handle, and compares CSS, rule artifacts, attrs, and nonempty source maps.
- [x] Pass the copied-UI source consumer against only the declared public dependencies.
  - Evidence: `packages/ui/src/copy-in.test.ts` typechecks copied components against the public
    package set; the four-file Style contract suite passes 43 tests.
- [ ] Pass the canonical packed starter consumer after the final release manifest is resealed.
  - Current gap: this requires the integration-owned authenticated tarball set; no package-local
    source or Style contract failure remains.

## UI, headless, and icons

- [x] Extend the owning UI/headless manifests with parts, slots, IDs, state inputs, enhancement
      tier, roles, and keyboard behavior.
  - Evidence: `node packages/ui/scripts/build-registry.mjs` validates all 44 entries and
    regenerates `packages/ui/catalog.json` plus `packages/ui/registry.json` from the owning
    manifest.

- [x] Resolve Card anatomy consistently across source, registry, README, API generation, and
      copy-in output.
  - Evidence: `packages/ui/src/card-contract.test.ts` and
    `packages/cli/src/index.kovo-add.test.ts` assert the same six-part Card contract.

- [x] Move CLI discovery off the empty UI root and remove or deliberately reclassify that root.
  - Evidence: `scripts/public-packages.test.mjs` and the CLI add tests prove discovery through a
    real component subpath and the absence of `@kovojs/ui` root exports.

- [x] Reconcile the orphan transition ABI count and remove only zero-reachable public types.
  - Evidence: `packages/headless-ui/transition-abi-audit.json` records 225 implementation
    declarations and zero names reachable through public or generated facades.

- [x] Audit the 38 weak-evidence runtime helpers.
  - Evidence: `packages/headless-ui/runtime-helper-audit.json` classifies exactly 29 as internal
    and nine as generated-only; `public-api-reachability.test.ts` proves the public facades.

- [x] Replace broad `IconRenderResult = object` with the canonical render contract.
  - Evidence: the icon generator and all 1,737 glyph sources return
    `@kovojs/core#ComponentRenderResult`; the old alias is absent from package exports.

- [x] Pass deterministic all-glyph generation, all-glyph TypeScript checking, and icon timing.
  - Evidence: `build:icons -- --check` and `tsc --noEmit -p packages/icons/tsconfig.json` cover
    1,737 glyphs; `check:timing` completes in 16.1 ms against the 5,000 ms budget.
- [x] Keep the 44-component manifest and copied-source API contract green before packing.
  - Evidence: the focused UI/headless/icon/migration suite passes 20 tests, including exact
    44-entry metadata, generator round-trip, copy-in compilation, and public-facade reachability.
- [ ] Pass the canonical packed 44-component gate after the final release manifest is resealed.
  - Current gap: the source contracts are green; the final authenticated tarball set is
    integration-owned.

## Verifier

- [x] Add runtime-independent packed API and CLI fixtures plus README/reference/examples.
  - Evidence: the canonical packed acceptance and docs/API-reference suites pass against the
    attested standalone tarball.
- [x] Make verifier help/version exit 0 on stdout and accept documented flag orderings.
  - Evidence: the packed acceptance exercises all 24 documented flag orders and every
    help/version path.
- [x] Enforce 0 verified, 1 findings, and 2 usage/I/O/parse-indeterminate exits.
  - Evidence: the packed acceptance observes all three exit classes.
- [x] Prove versioned JSON and human output carry identical findings.
  - Evidence: the 92-test verifier suite proves exact ordered
    `{ obligation, code, message }` parity under `kovo.verify-report/v1`.
- [x] Prove the tarball has no Kovo runtime dependency.
  - Evidence: the packed consumer reports 11 public declarations and zero Kovo runtime
    dependencies.

## Browser

- [x] Implement one experimental custom-shell installer returning `ready` and async `dispose`.
  - Evidence: `packages/browser/src/client-installer.test.ts` and the packed
    `scripts/check-packed-browser-client-consumer.mjs` exercise the single three-export client
    facade and its asynchronous lifecycle.
- [x] Define drain/abort disposal and sanctioned session-transition reset semantics.
  - Evidence: `packages/browser/src/client-installer.test.ts` proves drain, abort, idempotent
    disposal, pending-work settlement, and query/session reset.
- [x] Internalize store, root, plans, default transport, allowlist, snapshots, and mutable cache.
  - Evidence: `scripts/check-packed-browser-client-consumer.mjs` pins the packed client root to
    `installKovoClient`, `InstallKovoClientOptions`, and `KovoClient` and rejects all 17 retired
    assembly exports.
- [x] Keep framework ownership of security-bearing Request/init under custom fetch observation.
  - Evidence: `packages/browser/src/client-installer.test.ts` proves the observer receives the
    framework-created `Request`, must call `next()` exactly once, and must return its exact
    `Response`.
- [x] Enforce compiler/document module allowlists for default and custom dynamic imports.
  - Evidence: `packages/browser/src/client-installer.test.ts` rejects arbitrary, redirected, and
    unregistered client-module URLs for both default and custom import hooks.
- [x] Cover arbitrary URLs, redirects, credentials, upload/stream/error hooks, custom root,
      recovery, and repeated install/dispose adversarially.
  - Evidence: the focused installer/index suite passes 19 tests across
    `client-installer.test.ts`, `index-exports.test.ts`, `index.test.ts`, and the packed-consumer
    contract.
- [x] Make manual `derive` inputs handle-backed and fully inferred while preserving authorable IR.
  - Evidence: `packages/browser/src/derive.test.ts`, `generated-exports.test.ts`, and
    `packages/compiler/src/query-coverage.test.ts` prove opaque same-instance inputs, tuple/object
    inference, query-name lowering, raw-string rejection at the public root, and generated ABI
    fixpoint support.
- [x] Require structured non-empty review metadata for trusted HTML/URL constructors.
  - Evidence: `packages/browser/src/security-output.test.ts`, compiler provenance/posture tests,
    the 368-test Drizzle explain suite, and `scripts/migrate-browser-authoring-v1.test.mjs` prove
    exact `{ reason, source? }` metadata, adversarial rejection, explain visibility, and a
    fail-closed atomic migration.
- [x] Pass generated-bootstrap parity and the ratified loader budget.
  - Evidence: `inline-loader-parser-parity.test.ts`, `inline-loader-artifact-minifier.test.ts`,
    `generated-exports.test.ts`, and `pnpm --filter @kovojs/browser run check:inline-loader` pass;
    the packed client/authoring consumer also reports zero Node builtins.

## Core

- [x] Resolve the audited 39 remove and 30 borderline families through the decision ledger.
  - Evidence: `node scripts/api-decision-ledger.mjs` validates every current Core declaration;
    `core-task-topology-v1` is a removed-state checked migration and the Core root is 33 names.
- [x] Narrow S3 and HMAC surfaces so implementation inspection/request records are not recursively
      public.
  - Evidence: `storage-public.test.ts` and `verifier.test.ts` keep provider operations, signing
    material, and resolved inspection records behind opaque internal state.
- [x] Move human registry augmentation out of public API and retain refs only with a real
      rename-safe library/client example.
  - Evidence: `index.test.ts`, `exported-symbols.test.mjs`, and the Core migration suite reject the
    retired registry/ref families while preserving value-inferred query and route contracts.
- [x] Add door-specific validated declassification constructors and internalize destructive audit
      drains.
  - Evidence: `secret.test.ts` proves the five exact-door constructors and imports the bounded
    destructive audit drain only from `@kovojs/core/internal/security`.
- [x] Reject blank/shorthand reasons, forged policies, wrong-door policies, and unproven compiler
      identities across type/runtime/explain tests.
  - Evidence: focused Core, compiler capability-closure, Drizzle reveal-audit, and CLI explain
    tests pass 142 assertions covering type/runtime admission, exact compiler identity, and printed
    policy parity.
- [x] Land component-inference removals with `Component<Props>`.
  - Evidence: `index.test.ts` proves opaque runtime membership plus exact render-derived call-site
    inference; the migration suite refuses every retired `AnyFunction`/`Checked*`/`ComponentCall*`
    and render-slot helper.

## Exit

- [ ] Each 5a batch passes its per-batch standing checklist and records a zero-regression
      ratchet segment.

## Latest verification

- `pnpm run check:api-surface`
- Focused UI, gallery, headless reachability, component-catalog, icon, and packed-policy tests
- Actual `pnpm pack --config.ignore-scripts=true` inspection for `@kovojs/ui` and
  `@kovojs/icons`
- Browser focused suites: 119 derive/compiler tests, 105 trusted-output/compiler tests, 368
  Drizzle explain tests, and the packed client/authoring consumer.
- `node scripts/packed-public-any-gate.mjs --tarball-dir .release/tarballs` reports zero Browser
  `any`; only the separately owned Core and Server exception ledgers remain.
- Current Track 5 closure slice: Core/API tests 129, declassification identity/explain tests 13,
  Style tests 43, UI/headless/icon tests 20, and deterministic 1,737-glyph generation/typecheck.
