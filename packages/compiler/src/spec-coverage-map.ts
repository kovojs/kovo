import type { DiagnosticCode } from '@kovojs/core';

export type SpecClause =
  | 'SPEC.md §4.3'
  | 'SPEC.md §4.6'
  | 'SPEC.md §4.8'
  | 'SPEC.md §4.9'
  | 'SPEC.md §5.2'
  | 'SPEC.md §5.2.1'
  | 'SPEC.md §5.2.2'
  | 'SPEC.md §6.1.1'
  | 'SPEC.md §6.4'
  | 'SPEC.md §6.6'
  | 'SPEC.md §10'
  | 'SPEC.md §11.3/§11.4';

export interface ExecutableCoverageCitation {
  file: string;
  testName: string;
}

export interface DiagnosticCoverageCitation extends ExecutableCoverageCitation {
  codes?: readonly DiagnosticCode[];
  errorSurface?: string;
}

export interface SpecCoverageMapEntry {
  accepted: readonly ExecutableCoverageCitation[];
  clause: SpecClause;
  diagnostics: readonly DiagnosticCoverageCitation[];
  promise: string;
  referenceApp: readonly ExecutableCoverageCitation[];
}

// Authoritative coverage map for the quantified compiler promises in
// plans/compiler-quality-followup.md. Each citation is executable and is guarded
// by spec-coverage-map.test.ts so stale test/file references fail loudly.
export const compilerSpecCoverageMap = [
  {
    clause: 'SPEC.md §4.3',
    promise:
      'handler closure lowering crosses only ctx/state, element params, imports, and static module constants',
    accepted: [
      {
        file: 'packages/compiler/src/handler-lowering.test.ts',
        testName:
          'allows handler references through state, element params, named imports, and static module constants',
      },
      {
        file: 'packages/compiler/src/handler-lowering.test.ts',
        testName: 'emits executable handler bodies with stable unique anonymous names',
      },
      {
        file: 'packages/compiler/src/handler-lowering.test.ts',
        testName: 'declares boolean coercion for boolean-ish captured handler params',
      },
    ],
    diagnostics: [
      {
        file: 'packages/compiler/src/handler-lowering.test.ts',
        testName: 'reports KV201 when a handler captures non-serializable browser objects',
        codes: ['KV201'],
      },
      {
        file: 'packages/compiler/src/handler-lowering.test.ts',
        testName: 'reports KV201 for captured outer locals that are not element params',
        codes: ['KV201'],
      },
      {
        file: 'packages/compiler/src/diagnostic-coverage-matrix.test.ts',
        testName: 'keeps KV201 and KV230 teaching diagnostics compatibility-visible',
        codes: ['KV201'],
      },
    ],
    referenceApp: [
      {
        file: 'examples/commerce/src/app.add-to-cart.test.ts',
        testName: 'handles enhanced addToCart through the same endpoint as fragment wire',
      },
    ],
  },
  {
    clause: 'SPEC.md §4.6',
    promise:
      'primitive composition merges attributes deterministically and diagnoses unmergeable writers',
    accepted: [
      {
        file: 'packages/compiler/src/attribute-merge.test.ts',
        testName: 'merges primitive attrs-function records into the author element on the wire',
      },
      {
        file: 'packages/compiler/src/attribute-merge.test.ts',
        testName: 'rewrites primitive IDREFs when an authored id wins in the composition group',
      },
      {
        file: 'packages/compiler/src/handler-lowering.test.ts',
        testName: 'lowers asChild primitive wrappers onto the behavior-attribute merge path',
      },
      {
        file: 'packages/compiler/src/handler-lowering.test.ts',
        testName: 'lowers attrs-function primitive wrappers onto the behavior-attribute merge path',
      },
    ],
    diagnostics: [
      {
        file: 'packages/compiler/src/attribute-merge.test.ts',
        testName: 'reports KV231, KV232, and KV233 for residual attribute merge conflicts',
        codes: ['KV231', 'KV232', 'KV233'],
      },
      {
        file: 'packages/compiler/src/structural-jsx-ir.test.ts',
        testName: 'names both primitive and author writers for overlapping structural conflicts',
        codes: ['KV231'],
      },
    ],
    referenceApp: [
      {
        file: 'tests/integration/specs/primitive-as-child.spec.ts',
        testName: 'asChild lowers primitive attrs onto one author-owned element',
      },
    ],
  },
  {
    clause: 'SPEC.md §4.8',
    promise:
      'bindings, derives, stamps, nullability, and residual stamps are derived and validated',
    accepted: [
      {
        file: 'packages/compiler/src/query-coverage.test.ts',
        testName: 'derives data-bind stamps for sole text-child query expressions',
      },
      {
        file: 'packages/compiler/src/query-coverage.test.ts',
        testName: 'wraps mixed text query expressions in synthesized data-bind spans',
      },
      {
        file: 'packages/compiler/src/query-coverage.test.ts',
        testName: 'lowers inline attribute expressions into compiled query update stamps',
      },
      {
        file: 'packages/compiler/src/query-bindings.test.ts',
        testName: 'accepts optional binding path segments through nullable query shape metadata',
      },
      {
        file: 'packages/compiler/src/query-bindings.test.ts',
        testName: 'validates ejected list stamps against array element query shapes',
      },
    ],
    diagnostics: [
      {
        file: 'packages/compiler/src/query-bindings.test.ts',
        testName:
          'reports KV227 when binding paths traverse nullable query shape metadata without optional segments',
        codes: ['KV227'],
      },
      {
        file: 'packages/compiler/src/query-bindings.test.ts',
        testName: 'reports KV302 when data-bind paths are absent from declared query shapes',
        codes: ['KV302'],
      },
      {
        file: 'packages/compiler/src/query-coverage.test.ts',
        testName: 'classifies query-dependent render positions for KV311 coverage',
        codes: ['KV223', 'KV311'],
      },
      {
        file: 'packages/compiler/src/diagnostic-coverage-matrix.test.ts',
        testName:
          'proves every in-scope compiler-owned diagnostic has positive and negative coverage',
        codes: ['KV222'],
      },
    ],
    referenceApp: [
      {
        file: 'examples/commerce/src/app.queries.test.ts',
        testName: 'loads cursor-paged products and user-scoped order history',
      },
    ],
  },
  {
    clause: 'SPEC.md §4.9',
    promise:
      'every query/state-dependent rendered position is classified as plan, isomorphic, fragment, or renderOnce',
    accepted: [
      {
        file: 'packages/compiler/src/query-coverage.test.ts',
        testName: 'classifies fragment-target query expressions as fragment-covered without KV311',
      },
      {
        file: 'packages/compiler/src/query-coverage.test.ts',
        testName: 'classifies query-dependent render positions as isomorphic when declared',
      },
      {
        file: 'packages/compiler/src/query-coverage.test.ts',
        testName: 'classifies renderOnce coverage from parsed call argument facts',
      },
      {
        file: 'packages/compiler/src/state-bindings.test.ts',
        testName: 'classifies renderOnce state reads without emitting a runtime state plan',
      },
    ],
    diagnostics: [
      {
        file: 'packages/compiler/src/query-coverage.test.ts',
        testName: 'reports KV311 for compound query expressions in lowerer-skipped positions',
        codes: ['KV311'],
      },
      {
        file: 'packages/compiler/src/state-bindings.test.ts',
        testName: 'reports unhandled state and mixed query/state render expressions as KV311',
        codes: ['KV311'],
      },
      {
        file: 'packages/cli/src/index.kovo-check.test.ts',
        testName: 'fails kovo check coverage as a CLI command when coverage is unhandled',
        codes: ['KV311'],
      },
    ],
    referenceApp: [
      {
        file: 'examples/commerce/src/app.add-to-cart.test.ts',
        testName: 'renders SPEC 6.3 no-JS add-to-cart forms as the page output',
      },
    ],
  },
  {
    clause: 'SPEC.md §5.2',
    promise:
      'TSX-only authoring, fixpoint, semantic equivalence, teaching diagnostics, and typed-fact decisions hold',
    accepted: [
      {
        file: 'packages/compiler/src/compile-component.test.ts',
        testName: 'preserves emitted IR on recompilation',
      },
      {
        file: 'packages/compiler/src/compile-component.test.ts',
        testName: 'keeps compiler-emitted IR accepted through explicit fixpoint provenance',
      },
      {
        file: 'packages/compiler/src/compile-component.test.ts',
        testName: 'executes generated renderSource for semantic render-equivalence checks',
      },
      {
        file: 'packages/compiler/src/render-equivalence-boundary.test.ts',
        testName: 'uses SPEC §5.2 semantic render equivalence, not source-normalization evidence',
      },
      {
        file: 'packages/compiler/src/structural-jsx-ir.test.ts',
        testName: 'inserts generated imports deterministically for mixed structural helpers',
      },
    ],
    diagnostics: [
      {
        file: 'packages/compiler/src/compile-component.test.ts',
        testName: 'reports KV235 for app-authored compiler IR through the header fast path',
        codes: ['KV235'],
      },
      {
        file: 'packages/compiler/src/compile-component.test.ts',
        testName: 'fails the semantic render differential when visible HTML drifts',
        errorSurface: 'SPEC §5.2 semantic render differential failure',
      },
      {
        file: 'packages/cli/src/index.kovo-check.test.ts',
        testName: 'reports fixpoint invariant failures as stable ERROR diagnostics',
        errorSurface: 'kovo check fixpoint invariant ERROR',
      },
    ],
    referenceApp: [
      {
        file: 'packages/compiler/src/compiler-conformance.test.ts',
        testName: 'checks Commerce component IR through the package §5.2 gate on demand',
      },
    ],
  },
  {
    clause: 'SPEC.md §6.1.1',
    promise: 'package component prefixes are discovered, aliased, reserved, and conflict-checked',
    accepted: [
      {
        file: 'packages/compiler/src/package-prefixes.test.ts',
        testName: 'accepts an explicit package prefix alias as the collision escape hatch',
      },
      {
        file: 'packages/compiler/src/package-prefixes.test.ts',
        testName: 'discovers imported package prefixes from real package manifests',
      },
      {
        file: 'packages/compiler/src/package-prefixes.test.ts',
        testName: 'carries explicit package prefix facts into the app explain graph',
      },
    ],
    diagnostics: [
      {
        file: 'packages/compiler/src/package-prefixes.test.ts',
        testName: 'reports KV234 when component packages claim the same effective prefix',
        codes: ['KV234'],
      },
      {
        file: 'packages/compiler/src/package-prefixes.test.ts',
        testName: 'reports KV234 when non-kovo packages use the reserved kovo prefix family',
        codes: ['KV234'],
      },
      {
        file: 'packages/compiler/src/package-prefixes.test.ts',
        testName: 'reports KV234 for missing or invalid package prefix facts',
        codes: ['KV234'],
      },
    ],
    referenceApp: [
      {
        file: 'packages/cli/src/index.kovo-explain.test.ts',
        testName: 'prints package prefix provenance for a prefixed component target',
      },
    ],
  },
  {
    clause: 'SPEC.md §5.2.1',
    promise:
      'render-plan version tokens are one opaque build-stable contract shared across compiler and runtime URL/version consumers',
    accepted: [
      {
        file: 'packages/compiler/src/render-plan-token-contract.test.ts',
        testName: 'moves the token when any projected query shape changes (KV416 monotonicity)',
      },
      {
        file: 'packages/compiler/src/handler-lowering.test.ts',
        testName:
          'versions handler URLs from the render-plan fingerprint plus emitted client module source',
      },
    ],
    diagnostics: [
      {
        file: 'packages/compiler/src/compile-component.test.ts',
        testName:
          'throws KV416 when a projected-query field rename does NOT move a stubbed non-monotonic token (D4)',
        codes: ['KV416'],
      },
    ],
    referenceApp: [
      {
        file: 'examples/commerce/src/app.live-targets.test.ts',
        testName: 'stamps live-target hooks into the rendered cart document',
      },
    ],
  },
  {
    clause: 'SPEC.md §5.2.2',
    promise:
      'the production render-plan gate fails builds whose projected shape changes do not move the token',
    accepted: [
      {
        file: 'packages/compiler/src/compile-component.test.ts',
        testName: 'passes when shapes change AND the token changes',
      },
      {
        file: 'packages/compiler/src/compile-component.test.ts',
        testName:
          'does NOT throw KV416 when shapes differ and a correct token function moves (real fingerprint)',
      },
    ],
    diagnostics: [
      {
        file: 'packages/compiler/src/compile-component.test.ts',
        testName: 'wires KV416 into the production compile gate diagnostics',
        codes: ['KV416'],
      },
      {
        file: 'packages/compiler/src/compile-component.test.ts',
        testName: 'includes secret query shape metadata in the production render-plan token gate',
        codes: ['KV416'],
      },
    ],
    referenceApp: [
      {
        file: 'examples/commerce/src/app.live-targets.test.ts',
        testName: 'stamps live-target hooks into the rendered cart document',
      },
    ],
  },
  {
    clause: 'SPEC.md §6.6',
    promise:
      'static security facts reject secret client-wire and client-handler capture channels while preserving explicit audited escapes',
    accepted: [
      {
        file: 'packages/compiler/src/client-secret-capture.test.ts',
        testName: 'emits a callee-position import (ordinary client util) without KV437',
      },
      {
        file: 'packages/compiler/src/client-secret-capture.test.ts',
        testName:
          'allows a publishToClient(captured, { reason }) escape: emits and records the fact',
      },
      {
        file: 'packages/compiler/src/query-bindings.test.ts',
        testName: 'does not report KV435 for explicitly revealed query shape fields',
      },
    ],
    diagnostics: [
      {
        file: 'packages/compiler/src/client-secret-capture.test.ts',
        testName: 'fires KV437 for a captured NAMED import in call-argument (value) position',
        codes: ['KV437'],
      },
      {
        file: 'packages/compiler/src/query-bindings.test.ts',
        testName: 'reports KV435 when a component-declared query shape contains a secret field',
        codes: ['KV435'],
      },
      {
        file: 'packages/cli/src/index.kovo-check.test.ts',
        testName:
          'proves security-heavy check-owned diagnostics have accepted and rejected coverage',
        codes: ['KV438'],
      },
      {
        file: 'packages/cli/src/index.kovo-check.test.ts',
        testName:
          'formats KV438 mass-assignment diagnostics through the real kovo check CLI command',
        codes: ['KV438'],
      },
    ],
    referenceApp: [
      {
        file: 'examples/commerce/src/app.auth.test.ts',
        testName: 'uses the typed commerce session schema in authenticated mutations',
      },
    ],
  },
  {
    clause: 'SPEC.md §6.4',
    promise: 'typed navigation, IDREFs, and cross-island event wiring are accepted or diagnosed',
    accepted: [
      {
        file: 'packages/compiler/src/navigation-lowering.test.ts',
        testName: 'accepts literal navigation targets that match declared routes',
      },
      {
        file: 'packages/compiler/src/navigation-lowering.test.ts',
        testName: 'lowers static Link navigation sugar to plain anchors',
      },
      {
        file: 'packages/compiler/src/id-content-model.test.ts',
        testName: 'accepts package-prefixed behavior IDREFs that reference ids in component scope',
      },
      {
        file: 'packages/cli/src/index.kovo-check.test.ts',
        testName: 'accepts event payload facts that do not overlap query data facts',
      },
    ],
    diagnostics: [
      {
        file: 'packages/compiler/src/navigation-lowering.test.ts',
        testName: 'reports KV220 for literal navigation targets outside the route table',
        codes: ['KV220'],
      },
      {
        file: 'packages/compiler/src/id-content-model.test.ts',
        testName:
          'reports KV221 for package-prefixed behavior IDREFs that miss component scope ids',
        codes: ['KV221'],
      },
      {
        file: 'packages/cli/src/index.kovo-check.test.ts',
        testName: 'reports KV320 when event payload facts overlap query data facts',
        codes: ['KV320'],
      },
    ],
    referenceApp: [
      {
        file: 'examples/reference/src/app-shell.test.ts',
        testName: 'wires vp run export to the public reference shell static output',
      },
    ],
  },
  {
    clause: 'SPEC.md §10',
    promise:
      'mutation write domains, invalidation coverage, optimistic status, and guarded ownership checks are statically auditable',
    accepted: [
      {
        file: 'packages/compiler/src/registry.test.ts',
        testName: 'derives registry facts from graph query, mutation, and page facts',
      },
      {
        file: 'packages/cli/src/index.kovo-check.test.ts',
        testName: 'accepts explicit optimistic statuses for every invalidated query',
      },
      {
        file: 'packages/cli/src/index.kovo-check.test.ts',
        testName: 'discharges an owner-domain arg access guarded by owns() (SPEC §10.3)',
      },
    ],
    diagnostics: [
      {
        file: 'packages/compiler/src/registry.test.ts',
        testName:
          'reports KV421 for duplicate mutation-key facts (today none; invalidations last-write-wins)',
        codes: ['KV421'],
      },
      {
        file: 'packages/cli/src/index.kovo-check.test.ts',
        testName: 'fails KV314 when renderOnce reads a query invalidated by modeled writes',
        codes: ['KV314'],
      },
      {
        file: 'packages/cli/src/index.kovo-check.test.ts',
        testName: 'derives KV310 gaps from mutation invalidations and query read sets',
        codes: ['KV310'],
      },
    ],
    referenceApp: [
      {
        file: 'examples/commerce/src/app.test.ts',
        testName: 'dispatches enhanced and no-JS cart mutations through the shared app over HTTP',
      },
    ],
  },
  {
    clause: 'SPEC.md §11.3/§11.4',
    promise:
      'diagnostic registry, kovo check, explain, and mutation/domain verifier surfaces are mechanically audited',
    accepted: [
      {
        file: 'packages/compiler/src/diagnostic-coverage-matrix.test.ts',
        testName: 'guards the authoritative compiler-owned diagnostic code list',
      },
      {
        file: 'packages/compiler/src/diagnostic-coverage-matrix.test.ts',
        testName:
          'proves every in-scope compiler-owned diagnostic has positive and negative coverage',
      },
      {
        file: 'packages/compiler/src/direct-db.test.ts',
        testName: 'does not report KV330 for domain-routed mutation handlers',
      },
      {
        file: 'packages/cli/src/index.kovo-check.test.ts',
        testName: 'accepts query read domains covered by the touch graph',
      },
    ],
    diagnostics: [
      {
        file: 'packages/compiler/src/direct-db.test.ts',
        testName: 'reports KV330 when mutation handlers access request db directly',
        codes: ['KV330'],
      },
      {
        file: 'packages/cli/src/index.kovo-check.test.ts',
        testName: 'prints runtime verification diagnostics as kovo check findings',
        codes: ['KV402', 'KV403', 'KV404'],
      },
      {
        file: 'packages/cli/src/index.kovo-check.test.ts',
        testName: 'reports semantic findings for local state, events, and direct db access',
        codes: ['KV301', 'KV320', 'KV330'],
      },
      {
        file: 'packages/cli/src/index.kovo-check.test.ts',
        testName:
          'proves security-heavy check-owned diagnostics have accepted and rejected coverage',
        codes: ['KV423', 'KV424', 'KV438'],
      },
    ],
    referenceApp: [
      {
        file: 'examples/commerce/src/app.live-targets.test.ts',
        testName: 'stamps live-target hooks into the rendered cart document',
      },
      {
        file: 'examples/reference/src/app.test.ts',
        testName: 'renders authed and role guards through the reference app flow',
      },
    ],
  },
] as const satisfies readonly SpecCoverageMapEntry[];
