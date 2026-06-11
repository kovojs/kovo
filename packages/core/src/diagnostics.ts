export type DiagnosticSeverity = 'error' | 'warn' | 'lint' | 'notice';

export type DiagnosticCode =
  | 'FW201'
  | 'FW210'
  | 'FW211'
  | 'FW212'
  | 'FW220'
  | 'FW221'
  | 'FW222'
  | 'FW223'
  | 'FW224'
  | 'FW225'
  | 'FW226'
  | 'FW230'
  | 'FW231'
  | 'FW232'
  | 'FW233'
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
  detailLabels?: Readonly<Record<string, string>>;
  help?: string;
  severity: DiagnosticSeverity;
  message: string;
}

export interface DiagnosticTextOptions {
  includeHelp?: boolean;
  preferHelp?: boolean;
}

export function diagnosticDefinitionText(
  code: DiagnosticCode,
  options: DiagnosticTextOptions = {},
): string {
  const definition = diagnosticDefinitions[code];
  const help = 'help' in definition ? definition.help : undefined;
  const message = options.preferHelp ? (help ?? definition.message) : definition.message;
  if (!options.includeHelp || !help || message === help) return message;

  return `${message} ${help}`;
}

export const diagnosticDefinitions = {
  FW201: {
    code: 'FW201',
    detailLabels: {
      blockedExpression: 'Blocked expression:',
      elementParams: 'Element params:',
      handlerLowering: 'Would lower to:',
    },
    help: [
      'Fixes: move the value into component/query state via ctx; pass serializable element params with data-p-*; or keep shared constants in module scope.',
      'The compiler conservatively blocks free identifier references named window, document, db, request, response, Date, Map, or Set.',
    ].join('\n'),
    severity: 'error',
    message: 'Closure captures unserializable value.',
  },
  FW210: {
    code: 'FW210',
    severity: 'lint',
    message: 'Anonymous handler; name it for stable identity.',
  },
  FW211: {
    code: 'FW211',
    severity: 'lint',
    message: 'on:load eager trigger requires a justification comment.',
  },
  FW212: {
    code: 'FW212',
    severity: 'lint',
    message: 'Unknown on:* event or execution trigger name.',
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
  FW222: {
    code: 'FW222',
    severity: 'error',
    message: 'Hand-written binding stamp disagrees with the typed expression it wraps.',
  },
  FW223: {
    code: 'FW223',
    severity: 'lint',
    message: 'Redundant hand-written binding stamp in sugar; the compiler derives it.',
  },
  FW224: {
    code: 'FW224',
    severity: 'error',
    message: 'Static id appears in a repeatable component or duplicate page composition.',
  },
  FW225: {
    code: 'FW225',
    severity: 'error',
    message: 'JSX nesting violates the HTML content model.',
  },
  FW226: {
    code: 'FW226',
    severity: 'error',
    message: 'fw-deps or fw-c names an unknown query instance or component.',
  },
  FW230: {
    code: 'FW230',
    detailLabels: {
      blockedChildren: 'Blocked children:',
      slotHoist: 'Would hoist children to:',
    },
    help: 'Fixes: pass serializable props, move browser/request/db values behind a server fragment, or render children inside the fragment target itself.',
    severity: 'error',
    message: 'Fragment-target children cannot lower to a component reference.',
  },
  FW231: {
    code: 'FW231',
    severity: 'error',
    message: 'Unmergeable attribute conflict in primitive composition.',
  },
  FW232: {
    code: 'FW232',
    severity: 'lint',
    message: 'Author overrides a primitive-owned ARIA or state attribute.',
  },
  FW233: {
    code: 'FW233',
    severity: 'error',
    message: 'Two writers target the same binding slot.',
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
    help: 'No mutation touch graph writes that domain.',
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
    help: 'Opaque query projection requires a declared output schema.',
    severity: 'error',
    message: 'Query result shape failed declared output schema.',
  },
} as const satisfies Record<DiagnosticCode, DiagnosticDefinition>;
