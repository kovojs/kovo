import type { DiagnosticCode } from '@kovojs/core/internal/diagnostics';

import type { CompilerDiagnostic } from '../diagnostics.js';

export type DiagnosticRunner = () => readonly CompilerDiagnostic[];

export interface DiagnosticCoverageRegistration {
  code: DiagnosticCode;
  negative: DiagnosticRunner;
  positive: DiagnosticRunner;
  spec: string;
}

export interface DiagnosticMatrixRow extends DiagnosticCoverageRegistration {
  owner: DiagnosticCoverageOwner;
}

export type DiagnosticCoverageOwner =
  | 'app-graph-registry'
  | 'attribute-merge'
  | 'authoring-surface'
  | 'defer-lowering'
  | 'execution-triggers'
  | 'form-mutation'
  | 'fragment-targets'
  | 'handler-lowering'
  | 'navigation-idref'
  | 'package-components'
  | 'query-bindings'
  | 'state-bindings';

export interface OutOfScopeDiagnosticRow {
  code: DiagnosticCode;
  reason: string;
}

export function defineDiagnosticCoverage(
  owner: DiagnosticCoverageOwner,
  rows: readonly DiagnosticCoverageRegistration[],
): readonly DiagnosticMatrixRow[] {
  return rows.map((row) => ({ ...row, owner }));
}

export function generateDiagnosticCoverageMatrix(
  registrations: readonly (readonly DiagnosticMatrixRow[])[],
): readonly DiagnosticMatrixRow[] {
  return registrations.flatMap((producerRows) => producerRows.map((row) => ({ ...row })));
}
