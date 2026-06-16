/** Severity tier of a diagnostic, from blocking `error` down to advisory `notice`. */
export type DiagnosticSeverity = 'error' | 'warn' | 'lint' | 'notice';

/** The string-literal union of every `KV###` diagnostic code the framework can emit. */
export type DiagnosticCode =
  | 'KV201'
  | 'KV210'
  | 'KV211'
  | 'KV212'
  | 'KV220'
  | 'KV221'
  | 'KV222'
  | 'KV223'
  | 'KV224'
  | 'KV225'
  | 'KV226'
  | 'KV227'
  | 'KV228'
  | 'KV230'
  | 'KV231'
  | 'KV232'
  | 'KV233'
  | 'KV234'
  | 'KV235'
  | 'KV236'
  | 'KV301'
  | 'KV302'
  | 'KV303'
  | 'KV304'
  | 'KV310'
  | 'KV311'
  | 'KV320'
  | 'KV330'
  | 'KV402'
  | 'KV403'
  | 'KV404'
  | 'KV405'
  | 'KV406'
  | 'KV407'
  | 'KV408'
  | 'KV409'
  | 'KV410'
  | 'KV411';

/** A diagnostic's registry entry: its code, severity, message, optional help, and detail labels. */
export interface DiagnosticDefinition {
  code: DiagnosticCode;
  detailLabels?: Readonly<Record<string, string>>;
  help?: string;
  severity: DiagnosticSeverity;
  message: string;
}

/** Options controlling how `diagnosticDefinitionText` includes or prefers help text. */
export interface DiagnosticTextOptions {
  includeHelp?: boolean;
  preferHelp?: boolean;
}

/**
 * Render the human-readable text for a diagnostic code, optionally including or
 * preferring its help line.
 *
 * @param code - A `KV###` diagnostic code.
 * @param options - Whether to include/prefer the help text.
 * @returns The diagnostic's message (and help, when requested).
 * @example
 * import { diagnosticDefinitionText } from '@kovojs/core';
 *
 * const text: string = diagnosticDefinitionText('KV201', { includeHelp: true });
 */
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

/**
 * Type guard: narrow an unknown value to a known `KV###` diagnostic code.
 *
 * @param value - The value to test.
 * @returns `true` when `value` is a registered `DiagnosticCode`.
 * @example
 * import { isDiagnosticCode } from '@kovojs/core';
 *
 * const code: unknown = 'KV201';
 * if (isDiagnosticCode(code)) {
 *   // code is now typed as DiagnosticCode
 * }
 */
export function isDiagnosticCode(value: unknown): value is DiagnosticCode {
  return typeof value === 'string' && value in diagnosticDefinitions;
}

/** The frozen registry of every `KV###` diagnostic: code → definition (message, severity, help). */
export const diagnosticDefinitions = {
  KV201: {
    code: 'KV201',
    detailLabels: {
      blockedExpression: 'Blocked expression:',
      elementParams: 'Element params:',
      handlerLowering: 'Would lower to:',
    },
    help: [
      'Fixes: move the value into component/query state via ctx; pass serializable element params with data-p-*; or keep shared constants in module scope.',
      'Handlers may reference only state/ctx/event, data-p-* element params, named imports, and statically serializable module constants.',
    ].join('\n'),
    severity: 'error',
    message: 'Closure captures unserializable value.',
  },
  KV210: {
    code: 'KV210',
    severity: 'lint',
    message: 'Anonymous handler; name it for stable identity.',
  },
  KV211: {
    code: 'KV211',
    severity: 'lint',
    message: 'on:load eager trigger requires a justification comment.',
  },
  KV212: {
    code: 'KV212',
    severity: 'lint',
    message: 'Unknown on:* event or execution trigger name.',
  },
  KV220: {
    code: 'KV220',
    severity: 'error',
    message: 'Literal href or form action matches no declared route.',
  },
  KV221: {
    code: 'KV221',
    severity: 'error',
    message: 'IDREF references an id not present in component scope.',
  },
  KV222: {
    code: 'KV222',
    severity: 'error',
    message: 'Hand-written binding stamp disagrees with the typed expression it wraps.',
  },
  KV223: {
    code: 'KV223',
    severity: 'lint',
    message: 'Redundant hand-written binding stamp in sugar; the compiler derives it.',
  },
  KV224: {
    code: 'KV224',
    severity: 'error',
    message: 'Static id is duplicated in component scope or appears inside a repeatable stamp.',
  },
  KV225: {
    code: 'KV225',
    severity: 'error',
    message: 'JSX nesting violates the HTML content model.',
  },
  KV226: {
    code: 'KV226',
    severity: 'error',
    message: 'kovo-deps or kovo-c names an unknown query instance or component.',
  },
  KV227: {
    code: 'KV227',
    help: [
      'Fixes: write the nullable traversal with ?., extract a named derive that handles null explicitly, or make the projection non-null in the query.',
      'SPEC §4.8 requires empty-on-null semantics to be explicit so the server renderer and loader cannot drift.',
    ].join('\n'),
    severity: 'error',
    message: 'Binding path traverses a nullable segment without ?.',
  },
  KV228: {
    code: 'KV228',
    help: 'SPEC §9.5 requires static-first route matching to be unambiguous at compile time; split the patterns or make one route path more specific.',
    severity: 'error',
    message: 'Ambiguous route table: two routes can match the same canonical request path.',
  },
  KV230: {
    code: 'KV230',
    detailLabels: {
      blockedChildren: 'Blocked children:',
      slotHoist: 'Would hoist children to:',
    },
    help: 'Fixes: pass serializable props, move browser/request/db values behind a server fragment, or render children inside the fragment target itself.',
    severity: 'error',
    message: 'Fragment-target children cannot lower to a component reference.',
  },
  KV231: {
    code: 'KV231',
    severity: 'error',
    message: 'Unmergeable attribute conflict in primitive composition.',
  },
  KV232: {
    code: 'KV232',
    severity: 'lint',
    message: 'Author overrides a primitive-owned ARIA or state attribute.',
  },
  KV233: {
    code: 'KV233',
    severity: 'error',
    message: 'Two writers target the same binding slot.',
  },
  KV234: {
    code: 'KV234',
    help: 'SPEC §6.1.1 requires lowercase, dash-terminated, app-wide unique package component prefixes; kovo-* is reserved for @kovojs/* packages.',
    severity: 'error',
    message: 'Package component prefix registration conflict or reservation violation.',
  },
  KV235: {
    code: 'KV235',
    help: 'SPEC §5.2: TSX is the sole app-authoring surface. Write JSX with typed expressions and let the compiler emit renderSource(), kovo-c, kovo-deps, and data-bind.',
    severity: 'error',
    message:
      'App source hand-authors lowered IR/string-rendered components; write TSX and let the compiler emit IR.',
  },
  KV236: {
    code: 'KV236',
    help: [
      'Fixes: route URLs through typed route helpers; mark intentional external links with external; keep dynamic styling to compiler-generated safe properties; or pass raw HTML only as a Kovo TrustedHtml value.',
      'SPEC §1 and §5.2 require compiler output to be auditable; unsafe output contexts cannot depend on implicit browser or runtime sanitization.',
    ].join('\n'),
    severity: 'error',
    message: 'Unsafe output context requires an explicit trusted Kovo escape hatch.',
  },
  KV301: {
    code: 'KV301',
    severity: 'lint',
    message: 'Server fact stored in island-local state.',
  },
  KV302: {
    code: 'KV302',
    severity: 'error',
    message: 'data-bind path is not present in the declared query shape.',
  },
  KV303: {
    code: 'KV303',
    severity: 'error',
    message: 'Fragment target render input is not declared as query data or stamped props.',
  },
  KV304: {
    code: 'KV304',
    severity: 'error',
    message: 'Reserved query name is not allowed.',
  },
  KV310: {
    code: 'KV310',
    severity: 'warn',
    message: 'Invalidated query lacks optimistic transform.',
  },
  KV311: {
    code: 'KV311',
    help: 'Fixes: add a data-bind/query update plan, mark the expression renderOnce, move the subtree behind a fragment target, or make the component isomorphic.',
    severity: 'warn',
    message: 'Query/state-dependent DOM position has no update status.',
  },
  KV320: {
    code: 'KV320',
    severity: 'lint',
    message: 'Event payload overlaps query data; use a transform.',
  },
  KV330: {
    code: 'KV330',
    severity: 'lint',
    message: 'Direct db access in a mutation handler; route through domain.',
  },
  KV402: {
    code: 'KV402',
    severity: 'error',
    message: 'Write touched an undeclared domain.',
  },
  KV403: {
    code: 'KV403',
    severity: 'warn',
    message: 'Declared domain was never observed written.',
  },
  KV404: {
    code: 'KV404',
    severity: 'error',
    message: 'Write to unmapped table.',
  },
  KV405: {
    code: 'KV405',
    severity: 'warn',
    message: 'Conditional write branch was never executed under instrumentation.',
  },
  KV406: {
    code: 'KV406',
    severity: 'warn',
    message: 'Statically un-analyzable write site; manual touches required.',
  },
  KV407: {
    code: 'KV407',
    help: 'No mutation touch graph writes that domain.',
    severity: 'error',
    message: 'Query read from undeclared domain.',
  },
  KV408: {
    code: 'KV408',
    severity: 'error',
    message: 'Declared row key differs from observed row predicate.',
  },
  KV409: {
    code: 'KV409',
    severity: 'notice',
    message: 'Non-eq predicate degraded to table-level invalidation.',
  },
  KV410: {
    code: 'KV410',
    help: 'Opaque query projection requires a declared output schema.',
    severity: 'error',
    message: 'Query result shape failed declared output schema.',
  },
  KV411: {
    code: 'KV411',
    severity: 'error',
    message: 'Query read set includes an exempt table.',
  },
} as const satisfies Record<DiagnosticCode, DiagnosticDefinition>;
