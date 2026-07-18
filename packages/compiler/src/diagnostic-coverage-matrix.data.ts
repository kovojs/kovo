import type { DiagnosticCode } from '@kovojs/core/internal/diagnostics';

import { appGraphRegistryDiagnosticCoverage } from './diagnostic-coverage/app-graph-registry.js';
import { attributeMergeDiagnosticCoverage } from './diagnostic-coverage/attribute-merge.js';
import { authoringSurfaceDiagnosticCoverage } from './diagnostic-coverage/authoring-surface.js';
import { deferLoweringDiagnosticCoverage } from './diagnostic-coverage/defer-lowering.js';
import { executionTriggersDiagnosticCoverage } from './diagnostic-coverage/execution-triggers.js';
import { formMutationDiagnosticCoverage } from './diagnostic-coverage/form-mutation.js';
import { fragmentTargetsDiagnosticCoverage } from './diagnostic-coverage/fragment-targets.js';
import { handlerLoweringDiagnosticCoverage } from './diagnostic-coverage/handler-lowering.js';
import { navigationIdrefDiagnosticCoverage } from './diagnostic-coverage/navigation-idref.js';
import { packageComponentsDiagnosticCoverage } from './diagnostic-coverage/package-components.js';
import { queryBindingsDiagnosticCoverage } from './diagnostic-coverage/query-bindings.js';
import { stateBindingsDiagnosticCoverage } from './diagnostic-coverage/state-bindings.js';
import {
  generateDiagnosticCoverageMatrix,
  type DiagnosticMatrixRow,
  type OutOfScopeDiagnosticRow,
} from './diagnostic-coverage/registration.js';

const compilerDiagnosticCoverageOrder = [
  'KV201',
  'KV210',
  'KV211',
  'KV212',
  'KV220',
  'KV221',
  'KV222',
  'KV223',
  'KV224',
  'KV225',
  'KV226',
  'KV227',
  'KV228',
  'KV230',
  'KV231',
  'KV232',
  'KV317',
  'KV233',
  'KV234',
  'KV235',
  'KV244',
  'KV245',
  'KV236',
  'KV237',
  'KV238',
  'KV242',
  'KV243',
  'KV239',
  'KV240',
  'KV241',
  'KV246',
  'KV247',
  'KV301',
  'KV302',
  'KV303',
  'KV304',
  'KV311',
  'KV312',
  'KV315',
  'KV316',
  'KV318',
  'KV320',
  'KV330',
  'KV420',
  'KV421',
  'KV435',
  'KV426',
  'KV437',
  'KV449',
] as const satisfies readonly DiagnosticCode[];

const compilerDiagnosticCoverageRows = [
  ...appGraphRegistryDiagnosticCoverage,
  ...attributeMergeDiagnosticCoverage,
  ...authoringSurfaceDiagnosticCoverage,
  ...deferLoweringDiagnosticCoverage,
  ...executionTriggersDiagnosticCoverage,
  ...formMutationDiagnosticCoverage,
  ...fragmentTargetsDiagnosticCoverage,
  ...handlerLoweringDiagnosticCoverage,
  ...navigationIdrefDiagnosticCoverage,
  ...packageComponentsDiagnosticCoverage,
  ...queryBindingsDiagnosticCoverage,
  ...stateBindingsDiagnosticCoverage,
] as const satisfies readonly DiagnosticMatrixRow[];

const compilerDiagnosticCoverageByCode = new Map(
  compilerDiagnosticCoverageRows.map((row) => [row.code, row]),
);
const compilerDiagnosticCoverageCodeSet = new Set<DiagnosticCode>(compilerDiagnosticCoverageOrder);

if (compilerDiagnosticCoverageByCode.size !== compilerDiagnosticCoverageRows.length) {
  throw new Error('Duplicate compiler diagnostic coverage registration code.');
}

for (const row of compilerDiagnosticCoverageRows) {
  if (!compilerDiagnosticCoverageCodeSet.has(row.code)) {
    throw new Error(`Unexpected compiler diagnostic coverage registration for ${row.code}.`);
  }
}

export const compilerDiagnosticCoverageRegistrations = compilerDiagnosticCoverageOrder.map(
  (code) => {
    const row = compilerDiagnosticCoverageByCode.get(code);
    if (!row) throw new Error(`Missing compiler diagnostic coverage registration for ${code}.`);
    return row;
  },
);

// SPEC §11.3: the public matrix is generated from producer-owned diagnostic
// coverage registrations so new compiler-owned KV codes cannot bypass owner,
// SPEC, positive-fixture, or negative-fixture review.
export const compilerOwnedDiagnosticMatrix = generateDiagnosticCoverageMatrix([
  compilerDiagnosticCoverageRegistrations,
]);

export const outOfScopeCompilerDiagnostics = [
  {
    code: 'KV229',
    reason:
      'Compiler-owned in the registry, but static-export non-exportability is emitted by server/export replay and output-target validation rather than component compilation or app graph derivation.',
  },
  {
    code: 'KV310',
    reason:
      'Compiler-owned, but emitted by the optimistic coverage/check path (`tests/kovo-check.node.mjs`) rather than compileComponentModule/deriveAppGraph/query-shape validation.',
  },
  {
    code: 'KV313',
    reason:
      'Compiler-owned in the registry, but optimistic rebase discard reporting is emitted by the browser runtime rather than component compilation, app graph derivation, or query-shape validation.',
  },
  {
    code: 'KV314',
    reason:
      'Compiler-owned, but emitted by the kovo check coverage graph path (`packages/cli/src/index.kovo-check.test.ts`) rather than compileComponentModule/deriveAppGraph/query-shape validation.',
  },
  {
    code: 'KV422',
    reason:
      'Security-heavy, but produced by the Drizzle/static SQL analyzer and carried through compile/check graph diagnostics rather than by component compilation or app graph derivation.',
  },
  {
    code: 'KV423',
    reason:
      'Security-heavy, but raw endpoint metadata ownership currently lives in server/check graph producers; no compiler-owned row is claimed until endpoint extraction is compiler-derived.',
  },
  {
    code: 'KV424',
    reason:
      'Security-heavy, but produced by source/sink and kovo check graph diagnostics for app-authored dangerous sinks rather than component compilation.',
  },
  {
    code: 'KV425',
    reason:
      'Security-heavy, but source/sink drift detection is a repository audit/check path, not compiler component or registry graph output.',
  },
  {
    code: 'KV428',
    reason:
      'Security-heavy, but upload content-disposition/type enforcement is runtime/server-owned and not emitted by the compiler diagnostic path.',
  },
  {
    code: 'KV429',
    reason:
      'Security-heavy, but lost-update write provenance is enforced by kovo check graph diagnostics, not component compilation.',
  },
  {
    code: 'KV430',
    reason:
      'Security-heavy, but schema breadth/depth budget linting is schema/check ownership and not emitted by component compilation.',
  },
  {
    code: 'KV431',
    reason:
      'Security-heavy, but client-module manifest completeness is deployment/check ownership rather than compiler-owned component diagnostics.',
  },
  {
    code: 'KV432',
    reason:
      'Security-heavy, but cookie-attribute floors are server/runtime sink ownership rather than compiler-owned component diagnostics.',
  },
  {
    code: 'KV433',
    reason:
      'Security-heavy, but write-reaching query loaders are enforced by kovo check graph diagnostics, not component compilation.',
  },
  {
    code: 'KV434',
    reason:
      'Security-heavy, but regex/schema analyzer ownership is outside the compiler component/registry diagnostic matrix.',
  },
  {
    code: 'KV436',
    reason:
      'Security-heavy: kovo check consumes compiler-derived undecided access facts, while compileRouteModule emits access/legacy-guard ambiguity into the static build graph; the latter is covered by route-pages and kovo-build security fixtures rather than the component/registry matrix.',
  },
  {
    code: 'KV438',
    reason:
      'Security-heavy, but governed-column mass-assignment is enforced by kovo check graph diagnostics rather than compiler-owned component or registry diagnostics.',
  },
] as const satisfies readonly OutOfScopeDiagnosticRow[];
