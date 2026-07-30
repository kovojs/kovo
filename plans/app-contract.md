# World-class DevEx — declare app context once

Status: **active child ledger**

Charter: `plans/worldclass-devex.md` D1 and Track 4. Gates: G22-G24. The decision spike precedes
product implementation; the smallest owning normative modules change before or with behavior.

## D1 decision

- [x] Record pre-judgment numeric baselines for cold/warm TypeScript, completion latency,
      declaration size, and localized diagnostic size.
  - Evidence: `conformance/app-contract-spike/raw-evidence-v6.json` contains the registered
    baseline and both-arm timing, completion, declaration, and diagnostic measurements.
- [x] Exercise Arm A receiver provenance across local import, re-export, alias, destructure,
      wrapper, dynamic construction, shared-package, and duplicate-package fixtures.
  - Evidence: `conformance/app-contract-spike/results-v6.json` records Arm A's matrix,
    ownership/binding, diagnostics, and public-forgery gates green.
- [x] Exercise Arm B generated app-scoped free functions across the same matrix.
  - Evidence: `conformance/app-contract-spike/results-v6.json` records the same gates green for
    Arm B.
- [x] Prove both arms lower through existing authorable IR and fail closed where identity cannot be
      established.
  - Evidence: both arms' `compilerAndGraph` and `matrix` gates are green in
    `conformance/app-contract-spike/results-v6.json`.
- [x] Select an arm through the registered criteria or invoke the written fallback; record the
      decision in the charter.
  - Evidence: `plans/worldclass-devex.md` D1 and
    `conformance/app-contract-spike/results-v6.json` record the preregistered Arm A decision.

## Normative contract

- [x] Resolve the UUIDv4 app identity contract in `spec/09-wire-protocol.md`.
  - Evidence: `spec/09-wire-protocol.md` §9.1 requires one creator-generated canonical UUIDv4 per
    app and separates it from deploy-skew identity.
- [x] Specify the closed aggregate, lazy provider binding, and deterministic membership/HMR
      teardown in the owning app-shell contract.
  - Evidence: `spec/06-type-system.md` §6.2.1 defines provider inertness, one closed assembly, exact
    membership, and generation-scoped HMR replacement.
- [x] Specify factory identity, config-secret/egress install point, capability census, and
      duplicate-package failure under the soundness boundary.
  - Evidence: `spec/06-type-system.md` §6.2.1 and §6.6 define exact receiver/package provenance,
    private ownership, assembly-time capability closure, and fail-closed duplicate copies.
- [x] Specify query/mutation/request/session/DB/env/error/result inference without weakening
      default-deny posture.
  - Evidence: `spec/06-type-system.md` §6.2.1 and `spec/10-data-plane.md` §10.2-§10.3 own the
    inferred contexts and explicit access/CSRF/endpoint postures.
- [x] Specify assembly completeness and the deterministic orphan-declaration diagnostic/fix.
  - Evidence: `spec/06-type-system.md` §6.2.1 requires exact single-assembly membership and an
    idempotent source edit for each orphan.
- [x] Specify parameterized guard composition, ownership selectors, rate limits, role refinement,
      and one decision per surface.
  - Evidence: `spec/06-type-system.md` §6.2.1 and `spec/10-data-plane.md` §10.2 define
    `authenticated`/`role`/`rateLimit`/`owns`/`all` and KV436's exclusive decision.
- [x] Specify keyed optimism, import-cycle handling, exact status coverage, and pure-transform
      semantics.
  - Evidence: `spec/10-data-plane.md` §10.4 defines keyed selectors, cycle refusal, exact
    invalidation coverage, and pure deterministic transforms.
- [x] Specify named declaration-emittable handle interfaces and bounded property-local errors.
  - Evidence: `spec/06-type-system.md` §6.2.1 requires named opaque handle interfaces and
    property-local diagnostics that do not expand private witnesses.
- [x] Specify generated registry ownership, custom adapters, and the public
      `defineKovo`/low-level assembly boundary.
  - Evidence: `spec/06-type-system.md` §6.1/§6.2.1 and `spec/12-testing.md` assign generated
    registries to the compiler and expose only opaque-token adapter/test boundaries.

## Runtime and type implementation

- [x] Make public `KovoApp` an opaque minimal token backed by module-private state.
  - Evidence: `packages/server/src/api/app.test.ts` proves the frozen zero-key token rejects
    copies/proxies; `packages/server/src/app-token.ts` retains runtime state in a private WeakMap.
- [x] Remove or redesign public raw `CreateAppOptions` so private assembly types are not
      recursively public.
  - Evidence: `pnpm run check:api-surface` reports zero public/recursive leaks; the root removal
    fixture passes and `@kovojs/server/custom-adapters` accepts only the opaque token.
- [x] Implement the selected app-scoped factories with runtime ownership validation.
  - Evidence: `packages/server/src/app-authoring-context.test.ts` and
    `packages/compiler/src/scan/project-mutation-bindings.test.ts` cover app-owned handles,
    foreign-handle refusal, and compiler identity recovery.
- [x] Reject declarations from duplicate Kovo package instances with an actionable diagnostic.
  - Evidence: `packages/compiler/src/app-contract-project.test.ts` proves D1X001 for direct,
    named, star, and same-owner duplicate physical package paths; the runtime token error names the
    package-instance mismatch.
- [x] Implement a real auth-provider-bound `app.authenticated` guard and the selected access
      algebra.
  - Evidence: `packages/server/src/access.test.ts` and `app-authoring-context.test.ts` execute the
    provider-bound guard and cover composed, public, and verified access decisions.
- [x] Infer DB, request/session/env, error, query, route, task, and endpoint types while retaining
      explicit endpoint security posture.
  - Evidence: `packages/server/src/app-authoring-context.test.ts` compiles the positive contracts
    and their property-local `@ts-expect-error` posture refusals.
- [x] Replace string/module-augmentation optimism with query-handle binding and exact
      missing/duplicate/unrelated diagnostics.
  - Evidence: the starter and CRM mutations use query-handle `.optimistic(...)`; the compiler
    binding suite covers missing, duplicate, and unrelated handles.
- [x] Infer component mutation slots and form-error bindings from handles.
  - Evidence: `packages/server/src/app-authoring-context.test.ts` derives submitted fields and
    declared form-error codes from the mutation handle and rejects renamed fields/codes.
- [x] Replace component inference plumbing with opaque `Component<Props>`.
  - Evidence: `packages/core/src/index.test.ts` proves the callable opaque handle and derived exact
    props; `pnpm run check:api-surface` confirms the former helper families are absent.
- [x] Make `Link` JSX-only, keep `href` imperative, and infer GET-form helper records.
  - Evidence: `packages/core/src/index.test.ts` rejects imperative `Link(...)`, exercises `href`,
    and type-checks GET-form fields while the six helper records remain private.

## Acceptance

- [x] Add positive and expected-type-error fixtures for every inferred contract and security
      posture.
  - Evidence: `packages/server/src/app-authoring-type-fixtures.test.ts` compiles the positive
    corpus and its prop/query/route/form/DB/auth/access/CSRF/endpoint/optimism/error refusals.
- [ ] Add error-localization and declaration-nameability fixtures.
  - Current proof: the production query typo is pinned to a three-character span and a message
    within the 240-character ceiling; no production-handle declaration-emission/nameability
    fixture exists yet.
- [ ] Prove compiler/runtime loader consumption and a real CRM optimistic browser round trip.
  - Blocker: `examples/crm/src/optimistic-browser-roundtrip.test.ts` still reflects private runtime
    mutation state and builds a test-only virtual adapter instead of consuming the production
    compiler-emitted module through the production loader.
- [ ] Migrate the packed starter and one advanced example with no manual app context, registry
      augmentation, app generics, or casts.
  - Current proof: `pnpm run check:app-contract-g23` is source-clean for the 14-file starter,
    16-file advanced CRM, and 3-file release CRM corpora; a fresh tarball-backed typecheck has not
    yet proved the word “packed.”
- [ ] Ratify TypeScript and language-service budgets from the D1 baseline.
  - Current proof: timing/completion/declaration budgets are numeric and ratified; the
    extended-diagnostics instantiation ceiling remains `pending-measurement`.
- [ ] Track 4 exit: G23 green with emitted proof artifacts and `kovo explain` equivalent to the
      pre-facade model.
  - Blockers: fresh packed G23, production optimism, current emitted/explain parity, and a
    current-source D1 artifact reseal remain open.

## Latest verification

- `pnpm exec vitest --run <12 focused Track 4 files> --reporter=dot`: 12 files / 118 tests pass.
- `pnpm run check:api-surface`: zero public/recursive leaks; 34 tests pass.
- `pnpm run check:app-contract-g23`: all three source corpora clean; 2 tests pass.
- Type-budget policy: 3 tests pass; timings are ratified and instantiations are pending.
- D1 evaluator: 40/42 tests pass; the two artifact-authentication assertions correctly fail because
  23 framework source subjects changed after the last v6 seal. Do not treat the committed seal as
  current release evidence until the integration freeze reseals it.
