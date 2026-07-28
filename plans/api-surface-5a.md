# World-class DevEx — contract-independent API batches

Status: **active child ledger**

Charter: `plans/worldclass-devex.md` Track 5a. Dependencies: cleaned Track 2 inventory and the
Track 5 migration protocol. Gates: G17-G22. Every batch updates the owning SPEC section, manifest,
exports/build entries, reference, examples/templates, compiler identities, snapshot, codemod,
ratchet segment, and release note in one checkpoint.

## Style

- [ ] Replace public style representation records and raw tuples with runtime-validated opaque
      handles.
- [ ] Decide the vars-override `createTheme` user story and rename or remove it while retaining
      seed-based `defineTheme`.
- [ ] Remove `$$css`, `data-style-src`, `__rules`, `__styleKey`, and raw tuples from packed public
      declarations.
- [ ] Reject literal/cast forgeries at runtime and prove extracted CSS/source maps/artifacts remain
      equivalent.
- [ ] Pass packed starter and copied-UI consumers.

## UI, headless, and icons

- [ ] Extend the owning UI/headless manifests with parts, slots, IDs, state inputs, enhancement
      tier, roles, and keyboard behavior.
- [ ] Resolve Card anatomy consistently across source, registry, README, API generation, and
      copy-in output.
- [ ] Move CLI discovery off the empty UI root and remove or deliberately reclassify that root.
- [ ] Reconcile the orphan transition ABI count and remove only zero-reachable public types.
- [ ] Audit the 38 weak-evidence runtime helpers.
- [ ] Replace broad `IconRenderResult = object` with the canonical render contract.
- [ ] Pass all-glyph generation/typecheck, icon timing, and packed 44-component gates.

## Verifier

- [ ] Add runtime-independent packed API and CLI fixtures plus README/reference/examples.
- [ ] Make verifier help/version exit 0 on stdout and accept documented flag orderings.
- [ ] Enforce 0 verified, 1 findings, and 2 usage/I/O/parse-indeterminate exits.
- [ ] Prove versioned JSON and human output carry identical findings.
- [ ] Prove the tarball has no Kovo runtime dependency.

## Browser

- [ ] Implement one experimental custom-shell installer returning `ready` and async `dispose`.
- [ ] Define drain/abort disposal and sanctioned session-transition reset semantics.
- [ ] Internalize store, root, plans, default transport, allowlist, snapshots, and mutable cache.
- [ ] Keep framework ownership of security-bearing Request/init under custom fetch observation.
- [ ] Enforce compiler/document module allowlists for default and custom dynamic imports.
- [ ] Cover arbitrary URLs, redirects, credentials, upload/stream/error hooks, custom root,
      recovery, and repeated install/dispose adversarially.
- [ ] Make manual `derive` inputs handle-backed and fully inferred while preserving authorable IR.
- [ ] Require structured non-empty review metadata for trusted HTML/URL constructors.
- [ ] Pass generated-bootstrap parity and the ratified loader budget.

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

No implementation checkbox has been closed in this ledger yet.
