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
- [ ] Implement the selected app-scoped factories with runtime ownership validation.
- [ ] Reject declarations from duplicate Kovo package instances with an actionable diagnostic.
- [ ] Implement a real auth-provider-bound `app.authenticated` guard and the selected access
      algebra.
- [ ] Infer DB, request/session/env, error, query, route, task, and endpoint types while retaining
      explicit endpoint security posture.
- [ ] Replace string/module-augmentation optimism with query-handle binding and exact
      missing/duplicate/unrelated diagnostics.
- [ ] Infer component mutation slots and form-error bindings from handles.
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

No implementation checkbox has been closed in this ledger yet.
