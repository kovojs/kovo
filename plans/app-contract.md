# World-class DevEx — declare app context once

Status: **active child ledger**

Charter: `plans/worldclass-devex.md` D1 and Track 4. Gates: G22-G24. The decision spike precedes
product implementation; the smallest owning normative modules change before or with behavior.

## D1 decision

- [ ] Record pre-judgment numeric baselines for cold/warm TypeScript, completion latency,
      declaration size, and localized diagnostic size.
- [ ] Exercise Arm A receiver provenance across local import, re-export, alias, destructure,
      wrapper, dynamic construction, shared-package, and duplicate-package fixtures.
- [ ] Exercise Arm B generated app-scoped free functions across the same matrix.
- [ ] Prove both arms lower through existing authorable IR and fail closed where identity cannot be
      established.
- [ ] Select an arm through the registered criteria or invoke the written fallback; record the
      decision in the charter.

## Normative contract

- [ ] Resolve the UUIDv4 app identity contract in `spec/09-wire-protocol.md`.
- [ ] Specify the closed aggregate, lazy provider binding, and deterministic membership/HMR
      teardown in the owning app-shell contract.
- [ ] Specify factory identity, config-secret/egress install point, capability census, and
      duplicate-package failure under the soundness boundary.
- [ ] Specify query/mutation/request/session/DB/env/error/result inference without weakening
      default-deny posture.
- [ ] Specify assembly completeness and the deterministic orphan-declaration diagnostic/fix.
- [ ] Specify parameterized guard composition, ownership selectors, rate limits, role refinement,
      and one decision per surface.
- [ ] Specify keyed optimism, import-cycle handling, exact status coverage, and pure-transform
      semantics.
- [ ] Specify named declaration-emittable handle interfaces and bounded property-local errors.
- [ ] Specify generated registry ownership, custom adapters, and the public
      `defineKovo`/low-level assembly boundary.

## Runtime and type implementation

- [ ] Make public `KovoApp` an opaque minimal token backed by module-private state.
- [ ] Remove or redesign public raw `CreateAppOptions` so private assembly types are not
      recursively public.
- [x] Implement the selected app-scoped factories with runtime ownership validation.
  - Evidence: `packages/server/src/app-authoring-context.test.ts` and
    `packages/compiler/src/scan/project-mutation-bindings.test.ts` cover app-owned handles,
    foreign-handle refusal, and compiler identity recovery.
- [ ] Reject declarations from duplicate Kovo package instances with an actionable diagnostic.
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
- [ ] Replace component inference plumbing with opaque `Component<Props>`.
- [ ] Make `Link` JSX-only, keep `href` imperative, and infer GET-form helper records.

## Acceptance

- [ ] Add positive and expected-type-error fixtures for every inferred contract and security
      posture.
- [ ] Add error-localization and declaration-nameability fixtures.
- [ ] Prove compiler/runtime loader consumption and a real CRM optimistic browser round trip.
- [ ] Migrate the packed starter and one advanced example with no manual app context, registry
      augmentation, app generics, or casts.
- [ ] Ratify TypeScript and language-service budgets from the D1 baseline.
- [ ] Track 4 exit: G23 green with emitted proof artifacts and `kovo explain` equivalent to the
      pre-facade model.

## Latest verification

`pnpm exec vitest --run packages/create-kovo/src/index.build.scaffold.typecheck.test.ts -t
'runs the generated public inferred harness' --reporter=dot` passes G24 against the generated app
(1 passed, 2 skipped; 290.89 seconds real).
