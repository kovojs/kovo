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
- [ ] Pass packed starter and copied-UI consumers.
  - Current evidence: the focused Style suite passes 43 tests; the repository-wide packed journey
    is blocked before consumers by pre-existing pack-security hash drift in Better Auth, CLI,
    compiler, core, and server artifacts. No Style artifact drift was reported.

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

- [ ] Pass all-glyph generation/typecheck, icon timing, and packed 44-component gates.
  - Current evidence: icon generation check, icon `tsc --noEmit`, and the 5-second timing gate
    pass; the packed journey test covers the 44-component copy-in/catalog contract. The full
    release-manifest packed consumer remains an integration gate.

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

- [ ] Resolve the audited 39 remove and 30 borderline families through the decision ledger.
- [ ] Narrow S3 and HMAC surfaces so implementation inspection/request records are not recursively
      public.
- [ ] Move human registry augmentation out of public API and retain refs only with a real
      rename-safe library/client example.
- [ ] Add door-specific validated declassification constructors and internalize destructive audit
      drains.
- [ ] Reject blank/shorthand reasons, forged policies, wrong-door policies, and unproven compiler
      identities across type/runtime/explain tests.
- [ ] Land component-inference removals with `Component<Props>`.

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
