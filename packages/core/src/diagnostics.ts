export type DiagnosticSeverity = 'error' | 'warn' | 'lint' | 'notice';

export type DiagnosticCode =
  | 'FW201'
  | 'FW210'
  | 'FW220'
  | 'FW221'
  | 'FW301'
  | 'FW302'
  | 'FW303'
  | 'FW310'
  | 'FW311'
  | 'FW320'
  | 'FW330'
  | 'FW402'
  | 'FW403'
  | 'FW404'
  | 'FW405'
  | 'FW406'
  | 'FW407'
  | 'FW408'
  | 'FW409'
  | 'FW410';

export interface DiagnosticDefinition {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
}

export const diagnosticDefinitions = {
  FW201: {
    code: 'FW201',
    severity: 'error',
    message: 'Closure captures unserializable value.',
  },
  FW210: {
    code: 'FW210',
    severity: 'lint',
    message: 'Anonymous handler; name it for stable identity.',
  },
  FW220: {
    code: 'FW220',
    severity: 'error',
    message: 'Literal href or form action matches no declared route.',
  },
  FW221: {
    code: 'FW221',
    severity: 'error',
    message: 'IDREF references an id not present in component scope.',
  },
  FW301: {
    code: 'FW301',
    severity: 'lint',
    message: 'Server fact stored in island-local state.',
  },
  FW302: {
    code: 'FW302',
    severity: 'error',
    message: 'data-bind path is not present in the declared query shape.',
  },
  FW303: {
    code: 'FW303',
    severity: 'error',
    message: 'Fragment target render input is not declared as query data or stamped props.',
  },
  FW310: {
    code: 'FW310',
    severity: 'warn',
    message: 'Invalidated query lacks optimistic transform.',
  },
  FW311: {
    code: 'FW311',
    severity: 'warn',
    message: 'Query-dependent DOM position has no update status.',
  },
  FW320: {
    code: 'FW320',
    severity: 'lint',
    message: 'Event payload overlaps query data; use a transform.',
  },
  FW330: {
    code: 'FW330',
    severity: 'lint',
    message: 'Direct db access in a mutation handler; route through domain.',
  },
  FW402: {
    code: 'FW402',
    severity: 'error',
    message: 'Write touched an undeclared domain.',
  },
  FW403: {
    code: 'FW403',
    severity: 'warn',
    message: 'Declared domain was never observed written.',
  },
  FW404: {
    code: 'FW404',
    severity: 'error',
    message: 'Write to unmapped table.',
  },
  FW405: {
    code: 'FW405',
    severity: 'warn',
    message: 'Conditional write branch was never executed under instrumentation.',
  },
  FW406: {
    code: 'FW406',
    severity: 'warn',
    message: 'Statically un-analyzable write site; manual touches required.',
  },
  FW407: {
    code: 'FW407',
    severity: 'error',
    message: 'Query read from undeclared domain.',
  },
  FW408: {
    code: 'FW408',
    severity: 'error',
    message: 'Declared row key differs from observed row predicate.',
  },
  FW409: {
    code: 'FW409',
    severity: 'notice',
    message: 'Non-eq predicate degraded to table-level invalidation.',
  },
  FW410: {
    code: 'FW410',
    severity: 'error',
    message: 'Query result shape failed declared output schema.',
  },
} as const satisfies Record<DiagnosticCode, DiagnosticDefinition>;

export function getDiagnosticDefinition(code: DiagnosticCode): DiagnosticDefinition {
  return diagnosticDefinitions[code];
}
