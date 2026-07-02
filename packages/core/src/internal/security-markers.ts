type AnyFunction = (...args: any[]) => any;

const securityDecisionBrand: unique symbol = Symbol('kovo.security-decision');
const securityDecisionName: unique symbol = Symbol('kovo.security-decision.name');

/** @internal Security-code enforcement taxonomy from fundamental-fixes-followup-4 DEC-D. */
export type SecurityCodeEnforcement =
  | 'runtime-choke'
  | 'by-construction'
  | 'escape-hatch-audit'
  | 'build-only';

/** @internal Hand-maintained security-code registry entry (SPEC §6.6, §10.3, §11.2). */
export interface SecurityCodeRegistryEntry {
  readonly chokeId?: string;
  readonly code: string;
  readonly enforcement: SecurityCodeEnforcement;
  readonly paranoidAdvisory?: true;
  readonly property: string;
}

/**
 * DEC-D security-code registry. This is intentionally hand maintained: the security classifier
 * brand records only a source-level decision name, while paranoid mode needs code-level guarantees.
 *
 * `paranoidAdvisory` is accepted only for proven `by-construction` entries. Runtime chokes are
 * always advisory under KOVO_PARANOID=1; escape hatches and build-only residuals are never stubbed.
 *
 * @internal
 */
export const SECURITY_CODE_REGISTRY = {
  KV406: {
    chokeId: 'server.sql.write-table-allowlist',
    code: 'KV406',
    enforcement: 'runtime-choke',
    property: 'Declared mutation write scope rejects raw-SQL writes outside registered tables.',
  },
  KV407: {
    code: 'KV407',
    enforcement: 'build-only',
    property: 'Touch graph read/write coverage is complete enough to invalidate stale queries.',
  },
  KV408: {
    code: 'KV408',
    enforcement: 'build-only',
    property: 'Declared row keys match observed row predicates for precise invalidation.',
  },
  KV409: {
    code: 'KV409',
    enforcement: 'build-only',
    property: 'Non-equality predicates are visible as table-level invalidation degradation.',
  },
  KV410: {
    code: 'KV410',
    enforcement: 'build-only',
    property: 'Opaque query projections carry declared output schemas before client exposure.',
  },
  KV411: {
    code: 'KV411',
    enforcement: 'build-only',
    property: 'Queries do not read tables excluded from Kovo invalidation modeling.',
  },
  KV412: {
    code: 'KV412',
    enforcement: 'build-only',
    property: 'Query read sets avoid unmodeled relations.',
  },
  KV413: {
    code: 'KV413',
    enforcement: 'build-only',
    property: 'Database engine side effects are declared as fan-out edges.',
  },
  KV414: {
    code: 'KV414',
    enforcement: 'build-only',
    property: 'Owner-table access is scoped to a session principal or public-read justification.',
  },
  KV415: {
    chokeId: 'server.response.emit-to-wire',
    code: 'KV415',
    enforcement: 'build-only',
    property: 'Response header names and values stay in typed, framework-owned channels.',
  },
  KV416: {
    code: 'KV416',
    enforcement: 'build-only',
    property: 'Production render-equivalence and render-plan-token monotonicity hold.',
  },
  KV417: {
    code: 'KV417',
    enforcement: 'build-only',
    property: 'Deploy-skew retention supports stale documents long enough to recover.',
  },
  KV418: {
    code: 'KV418',
    enforcement: 'build-only',
    property: 'CSRF-exempt endpoints and mutations do not depend on ambient session authority.',
  },
  KV419: {
    code: 'KV419',
    enforcement: 'build-only',
    property: 'Speculation prerender does not execute guarded session-dependent routes.',
  },
  KV420: {
    code: 'KV420',
    enforcement: 'build-only',
    property: 'Server-refreshable fragments cannot clobber nested island-local state.',
  },
  KV421: {
    code: 'KV421',
    enforcement: 'build-only',
    property: 'Mutation keys are unique across server dispatch and invalidation registries.',
  },
  KV422: {
    chokeId: 'server.sql.enforce-managed-sql',
    code: 'KV422',
    enforcement: 'runtime-choke',
    property: 'Executable SQL text reaches managed DB handles only through branded SQL values.',
  },
  KV423: {
    code: 'KV423',
    enforcement: 'escape-hatch-audit',
    property: 'Raw endpoints carry explicit ingress, method, and response-posture metadata.',
  },
  KV424: {
    code: 'KV424',
    enforcement: 'escape-hatch-audit',
    property: 'Dangerous app-owned sinks are either safe helpers or explicit audited escapes.',
  },
  KV425: {
    code: 'KV425',
    enforcement: 'build-only',
    property: 'Framework source/sink registry covers dangerous framework-owned sink tokens.',
  },
  KV426: {
    code: 'KV426',
    enforcement: 'escape-hatch-audit',
    property: 'Trusted-output and raw trust escape hatches carry auditable provenance.',
  },
  KV428: {
    code: 'KV428',
    enforcement: 'by-construction',
    property: 'Upload inline rendering requires a branded server-side safety opt-in.',
  },
  KV429: {
    code: 'KV429',
    enforcement: 'build-only',
    property: 'Atomic read-then-write flows use compare-and-set or typed stale-version outcomes.',
  },
  KV430: {
    code: 'KV430',
    enforcement: 'build-only',
    property: 'Ambient server authority stays out of browser-facing execution channels.',
  },
  KV431: {
    code: 'KV431',
    enforcement: 'build-only',
    property: 'Framework request/response protocol surfaces preserve declared trust boundaries.',
  },
  KV432: {
    code: 'KV432',
    enforcement: 'escape-hatch-audit',
    property: 'Cookie security-floor downgrades require an explicit audit record.',
  },
  KV433: {
    chokeId: 'server.sql.read-only-statement',
    code: 'KV433',
    enforcement: 'runtime-choke',
    property: 'Read-only query loaders reject write effects at the managed DB/storage choke.',
  },
  KV434: {
    code: 'KV434',
    enforcement: 'by-construction',
    property: 'Wire string validators avoid known non-linear regular-expression patterns.',
  },
  KV435: {
    chokeId: 'server.response.emit-to-wire',
    code: 'KV435',
    enforcement: 'runtime-choke',
    property: 'Runtime Secret values cannot cross client-readable wire egress.',
  },
  KV436: {
    code: 'KV436',
    enforcement: 'build-only',
    property: 'Reachable app surfaces carry explicit access decisions.',
  },
  KV437: {
    code: 'KV437',
    enforcement: 'build-only',
    property: 'Server-only values are not captured into client handler bundles.',
  },
  KV438: {
    code: 'KV438',
    enforcement: 'by-construction',
    paranoidAdvisory: true,
    property: 'Governed-column writes bind only declared server-derived or audited values.',
  },
  KV439: {
    code: 'KV439',
    enforcement: 'build-only',
    property: 'Client query wire shapes use intentional projections instead of whole DB rows.',
  },
} as const satisfies Readonly<Record<string, SecurityCodeRegistryEntry>>;

/** @internal Security codes that paranoid mode must downgrade to advisory findings. */
export const PARANOID_SECURITY_ADVISORY_CODES: readonly string[] = Object.freeze(
  Object.values(SECURITY_CODE_REGISTRY)
    .filter((entry) => {
      const registryEntry = entry as SecurityCodeRegistryEntry;
      return (
        registryEntry.enforcement === 'runtime-choke' ||
        (registryEntry.enforcement === 'by-construction' && registryEntry.paranoidAdvisory === true)
      );
    })
    .map((entry) => entry.code)
    .sort(),
);

/** @internal Return whether a code is advisory under KOVO_PARANOID=1. */
export function isParanoidSecurityAdvisoryCode(code: string): boolean {
  return PARANOID_SECURITY_ADVISORY_CODES.includes(code);
}

/** @internal Non-structural marker for security-decision functions (SPEC.md §6 honesty boundary). */
export type SecurityDecisionFunction<
  Kind extends 'classifier' | 'wire-emitter',
  Name extends string,
  FunctionValue extends AnyFunction,
> = FunctionValue & {
  readonly [securityDecisionBrand]: Kind;
  readonly [securityDecisionName]: Name;
};

/** @internal Brand a classifier without changing call behavior. */
export function securityClassifier<const Name extends string, FunctionValue extends AnyFunction>(
  name: Name,
  fn: FunctionValue,
): SecurityDecisionFunction<'classifier', Name, FunctionValue> {
  return markSecurityDecision('classifier', name, fn);
}

/** @internal Brand a wire emitter without changing call behavior. */
export function wireEmitter<const Name extends string, FunctionValue extends AnyFunction>(
  name: Name,
  fn: FunctionValue,
): SecurityDecisionFunction<'wire-emitter', Name, FunctionValue> {
  return markSecurityDecision('wire-emitter', name, fn);
}

/** @internal Runtime census hook for source-derived gates; not a security proof. */
export function securityDecisionMetadata(
  value: unknown,
): { kind: 'classifier' | 'wire-emitter'; name: string } | undefined {
  if (typeof value !== 'function') return undefined;
  const record = value as Partial<
    Record<typeof securityDecisionBrand, 'classifier' | 'wire-emitter'> &
      Record<typeof securityDecisionName, string>
  >;
  return record[securityDecisionBrand] === undefined || record[securityDecisionName] === undefined
    ? undefined
    : { kind: record[securityDecisionBrand], name: record[securityDecisionName] };
}

function markSecurityDecision<
  Kind extends 'classifier' | 'wire-emitter',
  const Name extends string,
  FunctionValue extends AnyFunction,
>(kind: Kind, name: Name, fn: FunctionValue): SecurityDecisionFunction<Kind, Name, FunctionValue> {
  Object.defineProperties(fn, {
    [securityDecisionBrand]: {
      configurable: false,
      enumerable: false,
      value: kind,
      writable: false,
    },
    [securityDecisionName]: {
      configurable: false,
      enumerable: false,
      value: name,
      writable: false,
    },
  });
  return fn as SecurityDecisionFunction<Kind, Name, FunctionValue>;
}
