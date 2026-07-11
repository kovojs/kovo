type AnyFunction = (...args: any[]) => any;

/** @internal Fixed retention ceiling for process-local runtime audit observations (SPEC §9.5). */
const RUNTIME_AUDIT_FACT_CAPACITY = 256;

/** @internal Bounded process-local audit observation buffer. */
interface BoundedRuntimeAuditCollector<Fact> {
  /** Drain retained facts in observation order and reset the collector for reuse. */
  drain(): Fact[];
  /** Record one fact, dropping the oldest retained fact on overflow. */
  record(fact: Fact): void;
}

/**
 * Build a fixed-capacity process-local audit collector (SPEC §9.5 bounded availability).
 *
 * Runtime audit observations are defense-in-depth; for audited escapes with build/explain
 * call-site facts, those static facts remain the authoritative inventory. The collector therefore
 * retains the most recent bounded window and drops the oldest observation on overflow. Draining is
 * destructive, preserves chronological order, releases retained object references, and leaves the
 * collector reusable.
 *
 * @internal
 */
export function createBoundedRuntimeAuditCollector<Fact>(
  capacity = RUNTIME_AUDIT_FACT_CAPACITY,
): BoundedRuntimeAuditCollector<Fact> {
  if (!Number.isSafeInteger(capacity) || capacity <= 0 || capacity > RUNTIME_AUDIT_FACT_CAPACITY) {
    throw new TypeError(
      `Runtime audit collector capacity must be an integer from 1 to ${RUNTIME_AUDIT_FACT_CAPACITY}.`,
    );
  }

  const retained: (Fact | undefined)[] = new Array(capacity);
  let head = 0;
  let size = 0;

  return Object.freeze({
    drain(): Fact[] {
      const facts: Fact[] = [];
      for (let index = 0; index < size; index += 1) {
        facts.push(retained[(head + index) % capacity]!);
      }
      retained.fill(undefined);
      head = 0;
      size = 0;
      return facts;
    },
    record(fact: Fact): void {
      if (size < capacity) {
        retained[(head + size) % capacity] = fact;
        size += 1;
        return;
      }
      retained[head] = fact;
      head = (head + 1) % capacity;
    },
  });
}

const securityDecisionBrand: unique symbol = Symbol('kovo.security-decision');
const securityDecisionName: unique symbol = Symbol('kovo.security-decision.name');

/** @internal Security-code enforcement taxonomy from fundamental-fixes-followup-4 DEC-D. */
export type SecurityCodeEnforcement =
  | 'runtime-choke'
  | 'by-construction'
  | 'escape-hatch-audit'
  | 'build-only';

/** @internal Reviewed dependency axis from fundamental-fixes-followup-5 DEC-B. */
export type SecurityCodePropertyDependency = 'build-artifact' | 'request-state' | 'concurrency';

/** @internal Boundary proof classification for runtime or provenance-backed security codes. */
export type SecurityBoundaryProof =
  | 'engine-enumerated-door'
  | 'framework-owned-door'
  | 'boxed-egress'
  | 'static-provenance';

/** @internal Hand-maintained security-code registry entry (SPEC §6.6, §10.3, §11.2). */
interface BaseSecurityCodeRegistryEntry {
  readonly boundaryProof?: SecurityBoundaryProof;
  readonly code: string;
  readonly property: string;
}

interface BuildOnlySecurityCodeRegistryEntry extends BaseSecurityCodeRegistryEntry {
  readonly boundaryProof?: never;
  readonly buildOnlyRationale: string;
  readonly enforcement: 'build-only';
  readonly propertyDependsOn: 'build-artifact';
}

interface EnforcedSecurityCodeRegistryEntry extends BaseSecurityCodeRegistryEntry {
  readonly buildOnlyRationale?: never;
  readonly chokeId?: string;
  readonly enforcement: Exclude<SecurityCodeEnforcement, 'build-only'>;
  readonly paranoidAdvisory?: true;
  readonly propertyDependsOn: SecurityCodePropertyDependency;
}

/** @internal Hand-maintained security-code registry entry (SPEC §6.6, §10.3, §11.2). */
export type SecurityCodeRegistryEntry =
  | BuildOnlySecurityCodeRegistryEntry
  | EnforcedSecurityCodeRegistryEntry;

/**
 * DEC-B/DEC-D security-code registry. This is intentionally hand maintained: the security classifier
 * brand records only a source-level decision name, while paranoid mode needs code-level guarantees.
 * `propertyDependsOn` is a reviewed label, not a derived proof; it keeps request-state and
 * concurrency properties from drifting back into `build-only` classifications.
 *
 * `paranoidAdvisory` is accepted only for proven `by-construction` entries. Runtime chokes are
 * always advisory under KOVO_PARANOID=1; escape hatches and build-only residuals are never stubbed.
 *
 * @internal
 */
export const SECURITY_CODE_REGISTRY = {
  KV406: {
    boundaryProof: 'framework-owned-door',
    chokeId: 'server.sql.write-table-allowlist',
    code: 'KV406',
    enforcement: 'runtime-choke',
    property: 'Declared mutation write scope rejects raw-SQL writes outside registered tables.',
    propertyDependsOn: 'request-state',
  },
  KV407: {
    buildOnlyRationale:
      'Read/write coverage is computed from the build-derived graph and declared table domains; runtime freshness remains separate from this static completeness diagnostic.',
    code: 'KV407',
    enforcement: 'build-only',
    property: 'Touch graph read/write coverage is complete enough to invalidate stale queries.',
    propertyDependsOn: 'build-artifact',
  },
  KV408: {
    buildOnlyRationale:
      'Row-key precision is decided by the extracted predicates and declarations in the build graph, not by a per-request value decision.',
    code: 'KV408',
    enforcement: 'build-only',
    property: 'Declared row keys match observed row predicates for precise invalidation.',
    propertyDependsOn: 'build-artifact',
  },
  KV409: {
    buildOnlyRationale:
      'Predicate shape is visible in the static query facts; runtime invalidation only consumes the degraded table-level classification.',
    code: 'KV409',
    enforcement: 'build-only',
    property: 'Non-equality predicates are visible as table-level invalidation degradation.',
    propertyDependsOn: 'build-artifact',
  },
  KV410: {
    buildOnlyRationale:
      'Opaque projection declarations and read-set facts are build artifacts; DEC-C keeps the raw-SQL table set visible enough for this check to remain static.',
    code: 'KV410',
    enforcement: 'build-only',
    property: 'Opaque query projections carry declared output schemas before client exposure.',
    propertyDependsOn: 'build-artifact',
  },
  KV411: {
    buildOnlyRationale:
      'Exempt-table use is determined by comparing declared/query read sets with the static domain registry.',
    code: 'KV411',
    enforcement: 'build-only',
    property: 'Queries do not read tables excluded from Kovo invalidation modeling.',
    propertyDependsOn: 'build-artifact',
  },
  KV412: {
    buildOnlyRationale:
      'Unmodeled relation detection is a static comparison between extracted read sets and modeled domains.',
    code: 'KV412',
    enforcement: 'build-only',
    property: 'Query read sets avoid unmodeled relations.',
    propertyDependsOn: 'build-artifact',
  },
  KV413: {
    buildOnlyRationale:
      'Engine fan-out declarations are schema/build metadata; runtime invalidation depends on the emitted fan-out graph after this static gate.',
    code: 'KV413',
    enforcement: 'build-only',
    property: 'Database engine side effects are declared as fan-out edges.',
    propertyDependsOn: 'build-artifact',
  },
  KV414: {
    boundaryProof: 'engine-enumerated-door',
    code: 'KV414',
    enforcement: 'runtime-choke',
    property:
      'Authorization: Postgres owner-table access is scoped at the engine choke by unassumeable privilege roles, a classified role-attribute allowlist over the runtime-login/assumable-role closure, a confined statement surface for per-request principal GUCs on scrubbed connections, RLS, and side-effect-inclusive engine-closure-audited reachable objects; SQLite is experimental/non-guaranteeing and cannot claim this authorization property.',
    propertyDependsOn: 'request-state',
  },
  KV415: {
    boundaryProof: 'framework-owned-door',
    chokeId: 'server.response.emit-to-wire',
    code: 'KV415',
    enforcement: 'runtime-choke',
    property: 'Response header names and values stay in typed, framework-owned channels.',
    propertyDependsOn: 'request-state',
  },
  KV416: {
    buildOnlyRationale:
      'Render-equivalence and token monotonicity are build-corpus properties checked before emitting deploy artifacts.',
    code: 'KV416',
    enforcement: 'build-only',
    property: 'Production render-equivalence and render-plan-token monotonicity hold.',
    propertyDependsOn: 'build-artifact',
  },
  KV417: {
    buildOnlyRationale:
      'Deploy-skew retention is decided from preset/build configuration and emitted immutable module/query artifact retention policy.',
    code: 'KV417',
    enforcement: 'build-only',
    property: 'Deploy-skew retention supports stale documents long enough to recover.',
    propertyDependsOn: 'build-artifact',
  },
  KV418: {
    buildOnlyRationale:
      'The forbidden shape is csrf:false plus statically declared session/guard dependence on the endpoint or mutation surface.',
    code: 'KV418',
    enforcement: 'build-only',
    property: 'CSRF-exempt endpoints and mutations do not depend on ambient session authority.',
    propertyDependsOn: 'build-artifact',
  },
  KV419: {
    buildOnlyRationale:
      'Speculation prerender safety is decided from route metadata, guards, and side-effect-free facts in the build graph.',
    code: 'KV419',
    enforcement: 'build-only',
    property: 'Speculation prerender does not execute guarded session-dependent routes.',
    propertyDependsOn: 'build-artifact',
  },
  KV420: {
    buildOnlyRationale:
      'Nested island state and server-refreshable fragment ownership are component graph facts known at build time.',
    code: 'KV420',
    enforcement: 'build-only',
    property: 'Server-refreshable fragments cannot clobber nested island-local state.',
    propertyDependsOn: 'build-artifact',
  },
  KV421: {
    buildOnlyRationale:
      'Mutation-key uniqueness is a registry/indexing property over the generated mutation graph.',
    code: 'KV421',
    enforcement: 'build-only',
    property: 'Mutation keys are unique across server dispatch and invalidation registries.',
    propertyDependsOn: 'build-artifact',
  },
  KV422: {
    boundaryProof: 'framework-owned-door',
    chokeId: 'server.sql.enforce-managed-sql',
    code: 'KV422',
    enforcement: 'runtime-choke',
    property: 'Executable SQL text reaches managed DB handles only through branded SQL values.',
    propertyDependsOn: 'request-state',
  },
  KV423: {
    code: 'KV423',
    enforcement: 'escape-hatch-audit',
    property: 'Raw endpoints carry explicit ingress, method, and response-posture metadata.',
    propertyDependsOn: 'build-artifact',
  },
  KV424: {
    code: 'KV424',
    enforcement: 'escape-hatch-audit',
    property: 'Dangerous app-owned sinks are either safe helpers or explicit audited escapes.',
    propertyDependsOn: 'request-state',
  },
  KV425: {
    buildOnlyRationale:
      'Framework sink-token drift is a repository/source inventory comparison, independent of any request.',
    code: 'KV425',
    enforcement: 'build-only',
    property: 'Framework source/sink registry covers dangerous framework-owned sink tokens.',
    propertyDependsOn: 'build-artifact',
  },
  KV426: {
    code: 'KV426',
    enforcement: 'escape-hatch-audit',
    property: 'Trusted-output and raw trust escape hatches carry auditable provenance.',
    propertyDependsOn: 'build-artifact',
  },
  KV428: {
    boundaryProof: 'framework-owned-door',
    code: 'KV428',
    enforcement: 'by-construction',
    property: 'Upload inline rendering requires a branded server-side safety opt-in.',
    propertyDependsOn: 'request-state',
  },
  KV429: {
    code: 'KV429',
    enforcement: 'by-construction',
    property: 'Atomic read-then-write flows use compare-and-set or typed stale-version outcomes.',
    propertyDependsOn: 'concurrency',
  },
  KV430: {
    buildOnlyRationale:
      'Unbounded schema breadth/depth is visible from the wire schema AST; the runtime budget is a separate floor.',
    code: 'KV430',
    enforcement: 'build-only',
    property: 'Wire schemas declare explicit breadth/depth bounds for untrusted sources.',
    propertyDependsOn: 'build-artifact',
  },
  KV431: {
    buildOnlyRationale:
      'Client-module manifest completeness compares document references with the generated integrity/CSP manifest during build/export.',
    code: 'KV431',
    enforcement: 'build-only',
    property: 'Referenced client modules are present in the integrity/CSP manifest.',
    propertyDependsOn: 'build-artifact',
  },
  KV432: {
    code: 'KV432',
    enforcement: 'escape-hatch-audit',
    property: 'Cookie security-floor downgrades require an explicit audit record.',
    propertyDependsOn: 'request-state',
  },
  KV433: {
    boundaryProof: 'framework-owned-door',
    chokeId: 'server.sql.read-only-statement',
    code: 'KV433',
    enforcement: 'runtime-choke',
    property: 'Read-only query loaders reject write effects at the managed DB/storage choke.',
    propertyDependsOn: 'request-state',
  },
  KV434: {
    code: 'KV434',
    enforcement: 'by-construction',
    property: 'Wire string validators avoid known non-linear regular-expression patterns.',
    propertyDependsOn: 'request-state',
  },
  KV435: {
    boundaryProof: 'boxed-egress',
    chokeId: 'server.response.emit-to-wire',
    code: 'KV435',
    enforcement: 'runtime-choke',
    property:
      'Confidentiality: runtime Secret values cannot cross client-readable wire egress; Postgres secret columns are engine-unreadable only under a least-privilege runtime, a classified role-attribute allowlist plus a predefined-role-membership allowlist over the runtime-login/assumable-role closure, and engine-closure-audited reachable objects at the engine choke, while SQLite is experimental/non-guaranteeing and relies on runtime boxes.',
    propertyDependsOn: 'request-state',
  },
  KV436: {
    buildOnlyRationale:
      'The presence of an explicit access decision is a generated graph fact; KV414 owns request-time IDOR correctness.',
    code: 'KV436',
    enforcement: 'build-only',
    property: 'Reachable app surfaces carry explicit access decisions.',
    propertyDependsOn: 'build-artifact',
  },
  KV437: {
    buildOnlyRationale:
      'Server-only capture into browser handler bundles is decided from the compiler capture graph and emitted client artifact.',
    code: 'KV437',
    enforcement: 'build-only',
    property: 'Server-only values are not captured into client handler bundles.',
    propertyDependsOn: 'build-artifact',
  },
  KV438: {
    boundaryProof: 'static-provenance',
    code: 'KV438',
    enforcement: 'by-construction',
    paranoidAdvisory: true,
    property:
      'Governed-column writes bind only declared server-derived or audited values through static provenance at the managed write boundary, never a runtime proxy-only check.',
    propertyDependsOn: 'request-state',
  },
  KV439: {
    buildOnlyRationale:
      'Client query wire shape projection is derived from the build graph and, under DEC-C, the visible table/read set.',
    code: 'KV439',
    enforcement: 'build-only',
    property: 'Client query wire shapes use intentional projections instead of whole DB rows.',
    propertyDependsOn: 'build-artifact',
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

/** @internal DEC-D1/C5: auth/confidentiality guarantees cannot rest only on build enumeration. */
export const AUTHORIZATION_CONFIDENTIALITY_RUNTIME_CODES = ['KV414', 'KV435'] as const;

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
