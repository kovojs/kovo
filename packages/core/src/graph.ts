import type { DerivationStatus } from './derivation.js';
import type {
  SecurityOperationIr,
  SecuritySemanticGraph,
} from './internal/security-operation-ir.js';

import { isDiagnosticCode, type DiagnosticCode, type DiagnosticSeverity } from './diagnostics.js';
import { snapshotAuditText } from './internal/audit-text.js';
import {
  freezeSecurityValue,
  securityArrayAppend,
  securityDefineProperty,
  securityGetOwnPropertyDescriptor,
  securityIsArray,
  securityJsonStringify,
  securityNullRecord,
  securityObjectKeys,
  securityOwnArrayEntry,
  securityRegExpTest,
  securitySet,
  securitySetAdd,
  securitySetHas,
  securityStringSlice,
  securityStringSplit,
  securityStringStartsWith,
  securityStringTrim,
} from './internal/security-witness-intrinsics.js';

/** @internal */
export interface TouchSite {
  branch?: string;
  domain: string;
  keys: null | string;
  predicate?: 'eq' | 'non-eq';
  site: string;
  via: string;
}

/** @internal */
export interface ReadSite {
  branch?: string;
  columns?: readonly QueryProjectedColumn[];
  domain: string;
  keys: null | string;
  predicate?: 'eq' | 'non-eq';
  scope?: QueryReadScopeProvenance;
  site: string;
  source: string;
  via: string;
}

/** @internal */
export interface UnresolvedWriteSite {
  code: 'KV404' | 'KV406' | 'KV413';
  domain?: string;
  message: string;
  site: string;
}

/** @internal */
export interface TouchGraphEntry {
  reads?: readonly ReadSite[];
  /**
   * Raw-SQL write table allowlist declared for opaque writes (SPEC.md §10.3/§11.2).
   * When present, the runtime verifier rejects observed raw writes to any other table
   * before ordinary domain coverage, so opaque writes fail closed instead of silently
   * relying on broad domain touches.
   */
  tables?: readonly string[];
  touches: readonly TouchSite[];
  unresolved: readonly UnresolvedWriteSite[];
}

/** @internal */
export type TouchGraph = Readonly<Record<string, TouchGraphEntry>>;

/** @internal */
export interface KovoCheckInput {
  access?: readonly AccessExplainFact[];
  authPosture?: readonly AuthPostureFact[];
  capabilities?: readonly CapabilityExplain[];
  capabilityClosure?: readonly CapabilityClosureExplainFact[];
  components?: readonly ComponentExplain[];
  cookieDowngrades?: readonly CookieDowngradeExplain[];
  derivedMutations?: readonly DerivedMutationDomainSet[];
  derivedQueries?: readonly QueryReadSet[];
  diagnostics?: readonly StaticDiagnosticFact[];
  endpoints?: readonly EndpointExplain[];
  endpointPosture?: readonly EndpointPostureVerificationFact[];
  eventPayloads?: readonly EventPayloadFact[];
  fixpointChecks?: readonly FixpointCheck[];
  handlerWriteSinks?: readonly HandlerWriteSinkExplain[];
  lints?: readonly SemanticLint[];
  massAssignmentFacts?: readonly MassAssignmentFact[];
  mutations?: readonly MutationExplain[];
  optimistic?: readonly OptimisticCoverage[];
  ownerDomains?: readonly OwnerDomainFact[];
  ownershipPosture?: readonly OwnershipPostureFact[];
  pages?: readonly PageExplain[];
  queryData?: readonly QueryDataFact[];
  queries?: readonly QueryReadSet[];
  queryWriteReachability?: readonly QueryWriteReachabilityFact[];
  requestProviders?: readonly RequestProviderExplain[];
  renderEquivalenceChecks?: readonly RenderEquivalenceCheck[];
  revealed?: readonly RevealExplainFact[];
  scopeAudits?: readonly ScopeAuditFact[];
  sessionAuthority?: readonly SessionAuthorityFact[];
  sqlSafety?: readonly SqlSafetyExplainFact[];
  sqlSafetyDiagnostics?: readonly SqlSafetyDiagnosticFact[];
  tasks?: readonly TaskExplain[];
  toctouFacts?: readonly ToctouFact[];
  touchGraph?: TouchGraph;
  trustEscapes?: readonly TrustEscapeExplain[];
  unregisteredSinks?: readonly UnregisteredSinkFact[];
  updateCoverage?: readonly UpdateCoverageFact[];
  verificationCoverage?: readonly VerificationCoverageFact[];
  verificationDiagnostics?: readonly VerificationDiagnosticFact[];
}

/** @internal */
export interface KovoExplainInput extends KovoCheckInput {
  components?: readonly ComponentExplain[];
  mutations?: readonly MutationExplain[];
  packageComponentPrefixes?: readonly PackageComponentPrefixExplain[];
  pages?: readonly PageExplain[];
}

/** @internal */
export interface TaskExplain {
  cron?: string;
  key: string;
  runMutations?: readonly string[];
  runQueries?: readonly string[];
  schedules?: readonly string[];
}

/** @internal */
export type HandlerWriteSinkSurface = 'endpoint' | 'mutation' | 'task' | 'webhook';

/** @internal */
export type HandlerWriteSinkOperationKind =
  | 'batch'
  | 'delete'
  | 'execute'
  | 'insert'
  | 'put'
  | 'raw-driver-escape'
  | 'run'
  | 'store'
  | 'upload'
  | 'update'
  | 'UNRESOLVED';

/** @internal */
export type HandlerWriteSinkTargetProvenance =
  | 'computed-member'
  | 'property-access-path'
  | 'unresolved-property-access';

/** @internal */
export interface HandlerWriteSinkExplain {
  canonicalTarget: {
    identity: string;
    provenance: HandlerWriteSinkTargetProvenance;
  };
  operationKind: HandlerWriteSinkOperationKind;
  owner: {
    kind: 'key' | 'path';
    value: string;
  };
  path: string;
  span: {
    end: number;
    start: number;
  };
  surface: HandlerWriteSinkSurface;
}

/** @internal */
export interface PackageComponentPrefixExplain {
  effectivePrefix?: string;
  packageName: string;
  prefix?: string | null;
}

/** @internal */
export interface RequestProviderExplain {
  consumers?: readonly string[];
  fields?: readonly string[];
  kind: 'db' | 'session';
  source?: string;
}

/** @internal */
export interface AccessExplainFact {
  decision: 'guard' | 'missing' | 'public' | 'verified';
  detail?: string;
  justification?: string;
  kind: 'endpoint' | 'mutation' | 'page' | 'query' | 'webhook';
  name: string;
  site?: string;
  source?: 'access';
}

/** @internal Producer-owned guarded/unguarded posture for SPEC.md §10.2 audits. */
export interface AuthPostureFact {
  detail?: string;
  guarded: boolean;
  kind: 'endpoint' | 'mutation' | 'page' | 'query' | 'webhook';
  name: string;
  source?: 'access-posture';
}

/** @internal Producer-owned ambient session authority posture for SPEC.md §9.1 / KV418. */
export interface SessionAuthorityFact {
  detail?: string;
  /** SHA-256 identities of inline handler syntax proven by this source fact. */
  handlerFingerprints?: readonly string[];
  kind: 'endpoint' | 'mutation' | 'webhook';
  name: string;
  referencesSession: boolean;
  source?: 'session-authority';
  /** A source producer found authority use but could not prove the runtime registry name. */
  unresolvedName?: true;
}

/** @internal Producer-owned ownership-guard posture for SPEC.md §10.3 / KV414. */
export interface OwnershipPostureFact {
  domain: string;
  key?: string;
  kind: 'mutation' | 'query';
  name: string;
  ownerGuarded: boolean;
  source?: 'ownership-posture';
}

/**
 * @internal Structural serialization of a producer-owned `access:` decision
 * (SPEC.md §10.2 default-deny). Mirrors `@kovojs/server`'s `AccessDecision` union
 * without importing it (core cannot depend on server); the static app-graph
 * derivation reads this off each surface fact to classify guarded/public/verified
 * and emits KV436 `missing` when the surface producer failed to provide one.
 */
export type AccessDecisionFact =
  | { guards: readonly string[]; kind: 'guard-chain' }
  | { kind: 'public'; reason: string }
  | { kind: 'verified-machine-auth' };

/** @internal */
export interface ComponentExplain {
  attributeMerges?: readonly AttributeMergeExplain[];
  clocks?: readonly ClockExplain[];
  derives?: readonly DeriveExplain[];
  disambiguatedDomName?: string;
  domName?: string;
  exportName?: string;
  fragments?: readonly string[];
  handlers?: readonly HandlerExplain[];
  mutationForms?: readonly MutationFormExplain[];
  name: string;
  mutableLocalState?: boolean;
  platformSubstitutions?: readonly PlatformSubstitutionExplain[];
  queries?: readonly string[];
  securitySemanticGraph?: SecuritySemanticGraph;
  securityOperations?: readonly SecurityOperationIr[];
  styleRules?: readonly StyleRuleExplain[];
  triggers?: readonly TriggerExplain[];
}

/** @internal */
export interface ClockExplain {
  cadence: string;
  name: string;
}

/** @internal */
export interface MutationFormExplain {
  fieldErrors?: readonly MutationFormFieldErrorExplain[];
  fields?: readonly string[];
  formErrors?: readonly MutationFormErrorExplain[];
  mutation: string;
  slot: string;
}

/** @internal */
export interface MutationFormFieldErrorExplain {
  id?: string;
  name: string;
}

/** @internal */
export interface MutationFormErrorExplain {
  code?: string;
}

/** @internal */
export interface StyleRuleExplain {
  className: string;
  source: string;
  styleRef: string;
}

/** @internal */
export interface AttributeMergeExplain {
  attr: string;
  decision: string;
  diagnostics?: readonly DiagnosticCode[];
  element: string;
  rule: string;
}

/** @internal */
export interface SqlSafetyExplainFact {
  declarations?: readonly string[];
  justificationSite?: string;
  site: string;
  target: string;
  targetKind: 'mutation' | 'query';
  text: 'parameterized' | 'static' | 'trusted' | 'unsafe';
}

/** @internal */
export interface DeriveExplain {
  inputs: readonly string[];
  name: string;
  ref: string;
  target: string;
}

/** @internal */
export interface HandlerExplain {
  captures?: readonly CaptureChannel[];
  event: string;
  exportName: string;
  params?: readonly string[];
  ref: string;
  substitution?: string;
}

/** @internal */
export type CaptureChannel = 'ctx' | 'element-params' | 'module-scope';

/** @internal */
export interface TriggerExplain {
  deps?: readonly string[];
  exportName: string;
  justification?: string;
  ref: string;
  trigger: 'idle' | 'load' | 'visible';
}

/** @internal */
export interface PlatformSubstitutionExplain {
  action: string;
  event: string;
  kind: 'details' | 'dialog' | 'popover';
  tag: string;
  target: string;
}

/** @internal */
export interface MutationExplain {
  access?: AccessDecisionFact;
  auth?: string;
  // SPEC §6.6/§9.1: CSRF posture for the mutation POST. `checked` (the default) means the
  // synchronizer token is verified before the guard chain; `exempt` is the `csrf: false`
  // opt-out reserved for non-browser/externally-authenticated writes. A `csrf: 'exempt'`
  // mutation MUST NOT reference ambient browser authority (KV418): it cannot read
  // `req.session` (surfaced here as `session`), read/escape Cookie, Authorization, or
  // Proxy-Authorization, mutate browser cookies/storage, or run a session/cookie-derived guard
  // (`authed`, `role()`, `owns()`), because such a mutation would skip CSRF yet still ride or alter
  // the victim's ambient browser authority — the unsound exemption §9.1 forbids.
  csrf?: 'checked' | 'exempt';
  csrfJustification?: string;
  enctype?: 'application/x-www-form-urlencoded' | 'multipart/form-data';
  fileFields?: readonly string[];
  guards?: readonly string[];
  invalidates?: readonly string[];
  inputFields?: readonly string[];
  key: string;
  manualInvalidates?: readonly string[];
  session?: string;
  writes?: readonly string[];
}

/** @internal */
export interface DerivedMutationDomainSet {
  domains: readonly string[];
  mutation: string;
  site?: string;
}

/** @internal */
export interface PageMetaExplain {
  description?: string;
  image?: string;
  title?: string;
}

/** @internal */
export interface PageLayoutExplain {
  name: string;
  queries?: readonly string[];
}

/** @internal */
export interface PageNavigationSegmentExplain {
  components?: readonly string[];
  id: string;
  kind: 'layout' | 'page' | 'region';
  name: string;
  queries?: readonly string[];
}

/** @internal */
export interface PageExplain {
  access?: AccessDecisionFact;
  guards?: readonly string[];
  i18n?: readonly string[];
  layouts?: readonly PageLayoutExplain[];
  meta?: PageMetaExplain;
  modulepreloads?: readonly string[];
  navigationSegments?: readonly PageNavigationSegmentExplain[];
  prefetch?: 'conservative' | 'moderate' | false;
  queries?: readonly string[];
  route: string;
  stylesheets?: readonly string[];
  viewTransitions?: readonly string[];
}

/** @internal */
export interface EndpointExplain {
  access?: AccessDecisionFact;
  appOwnedSafety?: boolean;
  auth?: string;
  authJustification?: string;
  body?: string;
  bodySize?: string;
  cache?: string;
  csrf?: 'checked' | 'exempt' | 'safe:read-only';
  csrfJustification?: string;
  dynamicExports?: readonly string[];
  files?: readonly string[];
  guards?: readonly string[];
  headers?: readonly string[];
  method?: string;
  mount?: 'exact' | 'prefix';
  mountJustification?: string;
  name?: string;
  path: string;
  rateLimit?: string;
  reason?: string;
  runMutations?: readonly string[];
  surface?: 'dynamic-export' | 'endpoint' | 'route-file' | 'route-stream' | 'webhook';
  writes?: readonly string[];
}

/** @internal */
export interface EndpointPostureVerificationFact {
  endpoint: string;
  failures?: readonly string[];
  observed: boolean;
  site?: string;
}

/** @internal */
export interface OptimisticCoverage {
  // SPEC.md §10.5/§10.6: v2 adds `derived` to the status set. `derivation` is
  // separate metadata (derived ✓ or a named PUNTED reason) — a PUNTED derivation
  // does NOT count as coverage; the pair stays UNHANDLED unless a hand-written
  // transform or `'await-fragment'` covers it.
  derivation?: DerivationStatus;
  mutation: string;
  query: string;
  status: 'UNHANDLED' | 'await-fragment' | 'derived' | 'hand-written';
}

/** @internal */
export interface OwnerDomainFact {
  domain: string;
  owner: string;
}

/** @internal */
export interface ScopeAuditFact {
  detail?: string;
  domain: string;
  /** SPEC §10.3: a recorded public-read justification — suppresses KV414 in `kovo check` while still surfaced by `kovo explain --unscoped`. */
  justification?: string;
  /** SPEC §10.3: exact client-visible owner key this `args` scope fact is about, e.g. `arg:id`. */
  key?: string;
  kind: 'query' | 'write';
  name: string;
  scope: 'args' | 'session' | 'unscoped' | 'unknown';
  site: string;
}

/**
 * A write reaching a GOVERNED column with request-input provenance — the §11.1
 * mass-assignment finding (KV438). Governed columns are owner/principal columns,
 * the primary key, and columns marked `kovo({ governed: true })`. `escape` records
 * an audited author-assertion (`serverValue`/`trustedAssign`) when the write was
 * discharged; `kind: 'reject'` (no escape) is the blocking KV438 error.
 *
 * @internal
 */
export interface MassAssignmentFact {
  column: string;
  /** The dot-path of the offending request-input value (e.g. `role`, `input.isAdmin`). */
  detail?: string;
  domain: string;
  /**
   * `input` — a request-input value reached the governed column (the unsafe case).
   * `unknown` — fail-closed: the value's provenance is unprovable (opaque helper /
   * spread of an un-narrowable object) on a governed column.
   */
  provenance: 'input' | 'unknown';
  /** The mutation/handler key owning the write, for audit + `owns()`-style discharge. */
  name: string;
  /** The write site (`file:line`). */
  site: string;
  /** The table column-write the finding flags. */
  via: 'raw-sql' | 'set' | 'spread' | 'values';
}

/** @internal */
export type QueryWriteReachabilityOperationKind =
  | 'batch'
  | 'delete'
  | 'execute'
  | 'insert'
  | 'put'
  | 'run'
  | 'store'
  | 'upload'
  | 'update'
  | 'UNRESOLVED';

/** @internal */
export type QueryWriteReachabilityOperationProvenance =
  | 'computed-member'
  | 'property-access'
  | 'receiver-method-alias';

/** @internal */
export type QueryWriteReachabilityTargetProvenance =
  | 'raw-receiver-method'
  | 'storage-receiver'
  | 'table-argument'
  | 'unresolved-table';

/** @internal */
export interface QueryWriteReachabilityUnresolved {
  code: 'KV406';
  reason: 'computed-member';
}

/** A `query()` loader that reaches a write-capable handle — the §9.4 read-only finding (KV433 Stage 2). */
export interface QueryWriteReachabilityFact {
  canonicalTarget?: {
    identity: string;
    provenance: QueryWriteReachabilityTargetProvenance;
  };
  operation: string;
  operationKind?: QueryWriteReachabilityOperationKind;
  operationProvenance?: QueryWriteReachabilityOperationProvenance;
  query: string;
  site: string;
  span?: {
    end: number;
    start: number;
  };
  table: string;
  unresolved?: QueryWriteReachabilityUnresolved;
}

/**
 * A single-row self-referential write to a declared `atomic` column whose `where()`
 * carries no compare-and-set / `version` guard — the §10.3 lost-update finding (KV429).
 *
 * @internal
 */
export interface ToctouFact {
  column: string;
  name?: string;
  site: string;
  table: string;
}

/**
 * @internal Closed runtime registry for every trust-escape kind rendered by
 * `kovo explain --trust` (SPEC.md §2). The threat-matrix liveness gate consumes
 * this value so widening the audit surface cannot silently outgrow its matrix cell.
 */
export const AUDITED_TRUST_ESCAPE_KINDS = freezeSecurityValue([
  'customVerifier',
  'rawEndpoint',
  'staticExportPathOverride',
  'trustedHtml',
  'trustedSql',
  'trustedUrl',
  'webhookVerifyNone',
] as const);

/** @internal */
export interface TrustEscapeExplain {
  justification?: string;
  kind: (typeof AUDITED_TRUST_ESCAPE_KINDS)[number];
  owner?: string;
  safePath?: string;
  site: string;
  source?: string;
}

/** @internal */
export interface RevealExplainFact {
  /** Exact authored call identity used only to deduplicate two analyzers observing one AST node. */
  callIdentity?: string;
  grade: 'audit' | 'proof';
  justification?: string;
  method: 'arbitrary-fn' | 'fixed-redactor' | 'server-projection';
  path: string;
  query: string;
  selectedSecret?: boolean;
  site: string;
  source?: string;
}

/** @internal */
export interface UnregisteredSinkFact {
  safePath: string;
  sink: string;
  site: string;
  source?: string;
}

/**
 * @internal Closed runtime registry for every dangerous capability kind rendered
 * by `kovo explain --capabilities` (SPEC.md §2/§6.6). The threat-matrix
 * liveness gate consumes this value as the audited escape/capability denominator.
 */
export const AUDITED_CAPABILITY_KINDS = freezeSecurityValue([
  'acceptUnverified',
  'actAs',
  'authAdapterDb',
  'crossOwnerRead',
  'declareSystemRead',
  'declareSystemWrite',
  'egressAllowInternal',
  'managedSqlStatement',
  'postgresRoleTopology',
  'publishToClient',
  'publicRelation',
  'rawRead',
  'serverValue',
  'systemDb',
  'trustedReveal',
  'unsafeCookie',
  'unsafeInline',
  'unsafeRegex',
] as const);

/**
 * @internal A held dangerous *capability* surfaced by `kovo explain --capabilities` (SPEC §6.6,
 * audit-only, threat-matrix M3). One row per declared escape: a `publishToClient` secret-emit escape
 * (KV437), an egress `allowInternal` private-network entry, a confidentiality `trustedReveal`, an
 * audited `crossOwnerRead`/`rawRead`, a `serverValue`/`trustedAssign` privileged-write escape
 * (KV438), an `unsafeRegex` ReDoS-risk acceptance (KV434), an `accept.unverified` upload escape, an
 * `unsafeCookie` credential-cookie downgrade, an `unsafeInline` response-sniff bypass, an
 * `actAs`/`declareSystemRead`/`declareSystemWrite`
 * non-request principal elevation (SPEC §10.3 DEC-G), a vetted `declarePublicRelation`, a
 * framework-owned auth/system DB facade (`usePostgresSystemDb`), managed SQL statement identity, or
 * Postgres role topology. The app-authored escapes are detected at their CALL SITE by the static
 * producer `collectCapabilityEscapesFromProject` (packages/drizzle/src/trust-escapes-static.ts),
 * mirroring the `publishToClient` call-site pattern; the framework-fixed capabilities
 * (`managedSqlStatement`/`postgresRoleTopology`) have no per-app call site and are tracked by the
 * capability-surface census gate instead. The renderer collects these from the merged slice facts so
 * a reviewer can diff the app's entire dangerous-capability surface in one audited table. Audit-only:
 * surfacing informs review; it enforces nothing.
 */
export interface CapabilityExplain {
  /** The capability family the escape belongs to. */
  kind: (typeof AUDITED_CAPABILITY_KINDS)[number];
  /** A human justification recorded at the escape site (the audit's load-bearing field). */
  justification?: string;
  /** Source module for module-scoped escapes such as `publishToClient`. */
  moduleSpecifier?: string;
  /** The escape target/value descriptor (e.g. host:port, query path, cookie name). */
  target?: string;
  /** The source span of the escape. */
  site: string;
}

/**
 * One stable row in the capability-closed module graph audit (SPEC §6.6).
 *
 * `root` rows census every untrusted-data surface. `summary` rows pin the exact installed package
 * verdict. `door` rows show a reviewed framework capability reached from a root, and `closed` rows
 * preserve the KV448 provenance that stopped the build. The path is ordered root → transfers →
 * terminal module/package so `kovo explain --capabilities` and diagnostics share one proof object.
 *
 * @internal
 */
export interface CapabilityClosureExplainFact {
  capability?:
    | 'database-driver'
    | 'dynamic-loader'
    | 'filesystem'
    | 'network'
    | 'process'
    | 'vm'
    | 'worker';
  conditions?: readonly string[];
  kind: 'closed' | 'door' | 'root' | 'summary';
  manifestFingerprint?: string;
  module?: string;
  name?: string;
  packageName?: string;
  packageVersion?: string;
  path?: readonly string[];
  reason?: string;
  rootKind?:
    | 'agent-tool-callback'
    | 'application'
    | 'durable-task'
    | 'endpoint'
    | 'layout'
    | 'mutation'
    | 'query'
    | 'route'
    | 'scheduled-task'
    | 'serialized-browser-handler'
    | 'webhook';
  site: string;
  status?: 'absent' | 'contradictory' | 'stale' | 'unresolved' | 'valid';
  summaryVersion?: string;
}

/**
 * @internal A recorded insecure cookie downgrade surfaced by `kovo explain --cookies` (SPEC
 * §6.6/§9.1, audit-only). Mirrors `@kovojs/server`'s runtime `CookieDowngradeFact` so the renderer
 * can read it off the graph without importing server. One row per `serializeCookie` call that
 * intentionally weakens a credential cookie's floor through `unsafeCookie`.
 */
export interface CookieDowngradeExplain {
  class: 'app-data' | 'auth' | 'session';
  downgrade: { httpOnly?: boolean; sameSite?: 'lax' | 'none' | 'strict'; secure?: boolean };
  justification: string;
  name: string;
  site?: string;
}

/** @internal */
export interface UpdateCoverageFact {
  component: string;
  detail?: string;
  position: string;
  query: string;
  source?: 'query' | 'state';
  status: 'UNHANDLED' | 'fragment' | 'isomorphic' | 'plan' | 'renderOnce';
}

/** @internal */
export interface FixpointCheck {
  actual?: string;
  artifact: string;
  detail?: string;
  expected?: string;
  ok: boolean;
}

/** @internal */
export interface RenderEquivalenceCheck {
  actual?: string;
  artifact: string;
  detail?: string;
  expected?: string;
  ok: boolean;
}

/** @internal */
export interface EventPayloadFact {
  event: string;
  fields: readonly string[];
  site: string;
}

/** @internal */
export interface QueryDataFact {
  fields: readonly string[];
  query: string;
}

/** @internal */
export interface QueryReadSet {
  access?: AccessDecisionFact;
  domains: readonly string[];
  guards?: readonly string[];
  query: string;
  readProvenance?: readonly QueryReadProvenance[];
  readOnlyDomains?: readonly string[];
}

/** @internal */
export type QueryColumnClassification = 'public' | 'secret' | 'unresolved';

/** @internal */
export type QueryColumnProjectionKind = 'column' | 'opaque' | 'table-row' | 'unresolved';

/** @internal */
export type QueryReadScopeProvenance =
  | { key?: string; kind: 'arg' }
  | { key: string; kind: 'guard' | 'session' | 'tenant'; ownerProof?: true }
  | { kind: 'unscoped' };

/** @internal */
export interface QueryProjectedColumn {
  classification: QueryColumnClassification;
  column?: string;
  path: string;
  projection: QueryColumnProjectionKind;
  site: string;
  table: string;
}

/** @internal */
export interface QueryReadProvenance {
  columns: readonly QueryProjectedColumn[];
  domain: string;
  keys: null | string;
  scope: QueryReadScopeProvenance;
  site: string;
  source: 'declared' | 'helper' | 'relational-query' | 'select';
  via: string;
}

/** @internal */
export interface SemanticLint {
  code: DiagnosticCode;
  detail?: string;
  site: string;
}

/** @internal */
export interface VerificationDiagnosticFact {
  branch?: string;
  code: DiagnosticCode;
  detail?: string;
  domain?: string;
  message?: string;
  severity?: DiagnosticSeverity;
  site?: string;
}

/** @internal */
export interface StaticDiagnosticFact {
  code: DiagnosticCode;
  length?: number;
  message?: string;
  severity?: DiagnosticSeverity;
  site: string;
  start?: SourcePosition;
}

/**
 * @internal A by-construction SQL-safety (KV422) diagnostic produced by the Drizzle static analyzer
 * (`analyzeSqlSafetyFromProject`, @kovojs/drizzle/internal/static; SPEC §10.2/§11.2). The analyzer
 * emits `{ code, message, severity, site }` records; they ride from `compile drizzle-static` into the
 * real-app-build check graph (via {@link deriveAppGraph}) so `kovo check` fails (nonzero exit) on
 * request-derived text reaching executable SQL — not only at the `compile drizzle-static` gate.
 */
export interface SqlSafetyDiagnosticFact {
  code: DiagnosticCode;
  message: string;
  severity: DiagnosticSeverity;
  site: string;
}

/** @internal */
export interface VerificationCoverageFact {
  key: string;
  kind: 'mutation' | 'query';
  observed: boolean;
  site?: string;
}

/** @internal */
export interface SourcePosition {
  column: number;
  line: number;
}

/** @internal */
export interface GraphInputValidationError {
  message: string;
  path: string;
}

/**
 * @internal The static surface facts the default-deny access derivation checks
 * (SPEC.md §10.2). The compiler's `deriveAppGraph` passes whatever it has assembled;
 * each list is optional so partial graphs (queries-only, endpoints-only) still derive.
 */
export interface AccessDerivationInput {
  endpoints?: readonly EndpointExplain[];
  mutations?: readonly MutationExplain[];
  pages?: readonly PageExplain[];
  queries?: readonly QueryReadSet[];
}

const MAX_GRAPH_DERIVATION_ENTRIES = 100_000;
const MAX_GRAPH_DERIVATION_TEXT_CHARACTERS = 4_000_000;

interface GraphTraversalBudget {
  entries: number;
  textCharacters: number;
}

function createGraphTraversalBudget(): GraphTraversalBudget {
  return { entries: 0, textCharacters: 0 };
}

function snapshotAccessDerivationInput(input: AccessDerivationInput): AccessDerivationInput {
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('Kovo access graph derivation input must be an object.');
  }
  const budget = createGraphTraversalBudget();
  const endpoints = snapshotGraphList(
    ownGraphData(input, 'endpoints', 'access graph endpoints'),
    'endpoints',
    snapshotEndpointDerivation,
    budget,
  );
  const mutations = snapshotGraphList(
    ownGraphData(input, 'mutations', 'access graph mutations'),
    'mutations',
    snapshotMutationDerivation,
    budget,
  );
  const pages = snapshotGraphList(
    ownGraphData(input, 'pages', 'access graph pages'),
    'pages',
    snapshotPageDerivation,
    budget,
  );
  const queries = snapshotGraphList(
    ownGraphData(input, 'queries', 'access graph queries'),
    'queries',
    snapshotQueryDerivation,
    budget,
  );
  return graphSnapshotRecord({
    ...(endpoints === undefined ? {} : { endpoints }),
    ...(mutations === undefined ? {} : { mutations }),
    ...(pages === undefined ? {} : { pages }),
    ...(queries === undefined ? {} : { queries }),
  });
}

function graphSnapshotRecord<const Value extends object>(source: Value): Value {
  const snapshot = securityNullRecord<unknown>();
  const keys = securityObjectKeys(source);
  for (let index = 0; index < keys.length; index += 1) {
    const key = securityOwnArrayEntry(keys, index);
    if (!key.ok) throw new TypeError('Kovo graph snapshot keys must be dense.');
    securityDefineProperty(snapshot, key.value, {
      configurable: false,
      enumerable: true,
      value: ownGraphData(source, key.value, `snapshot.${key.value}`),
      writable: false,
    });
  }
  // The returned value was reconstructed above from exact own data fields on a
  // null-prototype record; this assertion only restores its static shape.
  return snapshot as Value;
}

function snapshotGraphList<Value>(
  value: unknown,
  label: string,
  snapshot: (value: object, label: string, budget: GraphTraversalBudget) => Value,
  budget: GraphTraversalBudget,
): Value[] | undefined {
  if (value === undefined) return undefined;
  if (!securityIsArray(value)) throw new TypeError(`Kovo graph ${label} must be an array.`);
  const length = snapshotGraphArrayLength(value, label, budget);
  const values: Value[] = [];
  for (let index = 0; index < length; index += 1) {
    const entry = securityOwnArrayEntry(value, index);
    if (!entry.ok || typeof entry.value !== 'object' || entry.value === null) {
      throw new TypeError(`Kovo graph ${label}[${index}] must be an own object entry.`);
    }
    securityArrayAppend(values, snapshot(entry.value, `${label}[${index}]`, budget));
  }
  return values;
}

function snapshotEndpointDerivation(
  value: object,
  label: string,
  budget: GraphTraversalBudget,
): EndpointExplain {
  const mount = snapshotOptionalGraphString(
    ownGraphData(value, 'mount', `${label}.mount`),
    `${label}.mount`,
    budget,
  );
  if (mount !== undefined && mount !== 'exact' && mount !== 'prefix') {
    throw new TypeError(`Kovo graph ${label}.mount must be exact or prefix.`);
  }
  const csrf = snapshotOptionalGraphString(
    ownGraphData(value, 'csrf', `${label}.csrf`),
    `${label}.csrf`,
    budget,
  );
  if (csrf !== undefined && csrf !== 'checked' && csrf !== 'exempt' && csrf !== 'safe:read-only') {
    throw new TypeError(`Kovo graph ${label}.csrf must be checked, exempt, or safe:read-only.`);
  }
  const surface = snapshotOptionalGraphString(
    ownGraphData(value, 'surface', `${label}.surface`),
    `${label}.surface`,
    budget,
  );
  if (
    surface !== undefined &&
    surface !== 'dynamic-export' &&
    surface !== 'endpoint' &&
    surface !== 'route-file' &&
    surface !== 'route-stream' &&
    surface !== 'webhook'
  ) {
    throw new TypeError(`Kovo graph ${label}.surface has an unsupported value.`);
  }
  const access = snapshotAccessDecision(
    ownGraphData(value, 'access', `${label}.access`),
    `${label}.access`,
    budget,
  );
  const auth = snapshotOptionalGraphString(
    ownGraphData(value, 'auth', `${label}.auth`),
    `${label}.auth`,
    budget,
  );
  const authJustification = snapshotOptionalGraphString(
    ownGraphData(value, 'authJustification', `${label}.authJustification`),
    `${label}.authJustification`,
    budget,
  );
  const csrfJustification = snapshotOptionalGraphString(
    ownGraphData(value, 'csrfJustification', `${label}.csrfJustification`),
    `${label}.csrfJustification`,
    budget,
  );
  const guards = snapshotGraphStringList(
    ownGraphData(value, 'guards', `${label}.guards`),
    `${label}.guards`,
    budget,
  );
  const method = snapshotOptionalGraphString(
    ownGraphData(value, 'method', `${label}.method`),
    `${label}.method`,
    budget,
  );
  const name = snapshotOptionalGraphString(
    ownGraphData(value, 'name', `${label}.name`),
    `${label}.name`,
    budget,
  );
  return graphSnapshotRecord({
    ...(access === undefined ? {} : { access }),
    ...(auth === undefined ? {} : { auth }),
    ...(authJustification === undefined ? {} : { authJustification }),
    ...(csrf === undefined ? {} : { csrf: csrf as NonNullable<EndpointExplain['csrf']> }),
    ...(csrfJustification === undefined ? {} : { csrfJustification }),
    ...(guards === undefined ? {} : { guards }),
    ...(method === undefined ? {} : { method }),
    ...(mount === undefined ? {} : { mount: mount as NonNullable<EndpointExplain['mount']> }),
    ...(name === undefined ? {} : { name }),
    path: snapshotRequiredGraphString(
      ownGraphData(value, 'path', `${label}.path`),
      `${label}.path`,
      budget,
    ),
    ...(surface === undefined
      ? {}
      : { surface: surface as NonNullable<EndpointExplain['surface']> }),
  });
}

function snapshotMutationDerivation(
  value: object,
  label: string,
  budget: GraphTraversalBudget,
): MutationExplain {
  const access = snapshotAccessDecision(
    ownGraphData(value, 'access', `${label}.access`),
    `${label}.access`,
    budget,
  );
  const auth = snapshotOptionalGraphString(
    ownGraphData(value, 'auth', `${label}.auth`),
    `${label}.auth`,
    budget,
  );
  const guards = snapshotGraphStringList(
    ownGraphData(value, 'guards', `${label}.guards`),
    `${label}.guards`,
    budget,
  );
  const invalidates = snapshotGraphStringList(
    ownGraphData(value, 'invalidates', `${label}.invalidates`),
    `${label}.invalidates`,
    budget,
  );
  const manualInvalidates = snapshotGraphStringList(
    ownGraphData(value, 'manualInvalidates', `${label}.manualInvalidates`),
    `${label}.manualInvalidates`,
    budget,
  );
  const session = snapshotOptionalGraphString(
    ownGraphData(value, 'session', `${label}.session`),
    `${label}.session`,
    budget,
  );
  const writes = snapshotGraphStringList(
    ownGraphData(value, 'writes', `${label}.writes`),
    `${label}.writes`,
    budget,
  );
  return graphSnapshotRecord({
    ...(access === undefined ? {} : { access }),
    ...(auth === undefined ? {} : { auth }),
    ...(guards === undefined ? {} : { guards }),
    ...(invalidates === undefined ? {} : { invalidates }),
    key: snapshotRequiredGraphString(
      ownGraphData(value, 'key', `${label}.key`),
      `${label}.key`,
      budget,
    ),
    ...(manualInvalidates === undefined ? {} : { manualInvalidates }),
    ...(session === undefined ? {} : { session }),
    ...(writes === undefined ? {} : { writes }),
  });
}

function snapshotPageDerivation(
  value: object,
  label: string,
  budget: GraphTraversalBudget,
): PageExplain {
  const access = snapshotAccessDecision(
    ownGraphData(value, 'access', `${label}.access`),
    `${label}.access`,
    budget,
  );
  const guards = snapshotGraphStringList(
    ownGraphData(value, 'guards', `${label}.guards`),
    `${label}.guards`,
    budget,
  );
  const queries = snapshotGraphStringList(
    ownGraphData(value, 'queries', `${label}.queries`),
    `${label}.queries`,
    budget,
  );
  return graphSnapshotRecord({
    ...(access === undefined ? {} : { access }),
    ...(guards === undefined ? {} : { guards }),
    ...(queries === undefined ? {} : { queries }),
    route: snapshotRequiredGraphString(
      ownGraphData(value, 'route', `${label}.route`),
      `${label}.route`,
      budget,
    ),
  });
}

function snapshotQueryDerivation(
  value: object,
  label: string,
  budget: GraphTraversalBudget,
): QueryReadSet {
  const access = snapshotAccessDecision(
    ownGraphData(value, 'access', `${label}.access`),
    `${label}.access`,
    budget,
  );
  const guards = snapshotGraphStringList(
    ownGraphData(value, 'guards', `${label}.guards`),
    `${label}.guards`,
    budget,
  );
  return graphSnapshotRecord({
    ...(access === undefined ? {} : { access }),
    domains:
      snapshotGraphStringList(
        ownGraphData(value, 'domains', `${label}.domains`),
        `${label}.domains`,
        budget,
      ) ?? [],
    ...(guards === undefined ? {} : { guards }),
    query: snapshotRequiredGraphString(
      ownGraphData(value, 'query', `${label}.query`),
      `${label}.query`,
      budget,
    ),
  });
}

function snapshotAccessDecision(
  value: unknown,
  label: string,
  budget: GraphTraversalBudget,
): AccessDecisionFact | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`Kovo graph ${label} must be an object.`);
  }
  const kind = snapshotRequiredGraphString(
    ownGraphData(value, 'kind', `${label}.kind`),
    `${label}.kind`,
    budget,
  );
  if (kind === 'verified-machine-auth') return graphSnapshotRecord({ kind });
  if (kind === 'public') {
    return graphSnapshotRecord({
      kind,
      reason: snapshotRequiredGraphString(
        ownGraphData(value, 'reason', `${label}.reason`),
        `${label}.reason`,
        budget,
      ),
    });
  }
  if (kind === 'guard-chain') {
    const guards = snapshotGraphStringList(
      ownGraphData(value, 'guards', `${label}.guards`),
      `${label}.guards`,
      budget,
    );
    if (guards === undefined) throw new TypeError(`Kovo graph ${label}.guards must be an array.`);
    return graphSnapshotRecord({ guards, kind });
  }
  throw new TypeError(`Kovo graph ${label}.kind has an unsupported value.`);
}

function snapshotGraphStringList(
  value: unknown,
  label: string,
  budget: GraphTraversalBudget,
): string[] | undefined {
  if (value === undefined) return undefined;
  if (!securityIsArray(value)) throw new TypeError(`Kovo graph ${label} must be an array.`);
  const length = snapshotGraphArrayLength(value, label, budget);
  const values: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const entry = securityOwnArrayEntry(value, index);
    if (!entry.ok) throw new TypeError(`Kovo graph ${label}[${index}] must be an own entry.`);
    securityArrayAppend(
      values,
      snapshotRequiredGraphString(entry.value, `${label}[${index}]`, budget),
    );
  }
  return values;
}

function snapshotGraphArrayLength(
  value: readonly unknown[],
  label: string,
  budget?: GraphTraversalBudget,
): number {
  const descriptor = securityGetOwnPropertyDescriptor(value, 'length');
  const length = descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  if (
    typeof length !== 'number' ||
    length < 0 ||
    length % 1 !== 0 ||
    length > MAX_GRAPH_DERIVATION_ENTRIES
  ) {
    throw new TypeError(
      `Kovo graph ${label} must contain at most ${MAX_GRAPH_DERIVATION_ENTRIES} entries.`,
    );
  }
  if (budget !== undefined) {
    consumeGraphTraversalEntries(budget, length);
  }
  return length;
}

function consumeGraphTraversalEntries(budget: GraphTraversalBudget, count: number): void {
  budget.entries += count;
  if (budget.entries > MAX_GRAPH_DERIVATION_ENTRIES) {
    throw new TypeError(
      `Kovo graph traversal exceeds the ${MAX_GRAPH_DERIVATION_ENTRIES}-entry aggregate bound.`,
    );
  }
}

function snapshotRequiredGraphString(
  value: unknown,
  label: string,
  budget: GraphTraversalBudget,
): string {
  if (typeof value !== 'string') throw new TypeError(`Kovo graph ${label} must be a string.`);
  const snapshot = snapshotAuditText(value, `Kovo graph ${label}`);
  budget.textCharacters += snapshot.length;
  if (budget.textCharacters > MAX_GRAPH_DERIVATION_TEXT_CHARACTERS) {
    throw new TypeError(
      `Kovo graph traversal exceeds the ${MAX_GRAPH_DERIVATION_TEXT_CHARACTERS}-character aggregate text bound.`,
    );
  }
  return snapshot;
}

function snapshotOptionalGraphString(
  value: unknown,
  label: string,
  budget: GraphTraversalBudget,
): string | undefined {
  return value === undefined ? undefined : snapshotRequiredGraphString(value, label, budget);
}

function ownGraphData(value: object, property: PropertyKey, label: string): unknown {
  const descriptor = securityGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError(`Kovo graph ${label} must be an own data property.`);
  }
  return descriptor.value;
}

/**
 * @internal By-construction default-deny classifier (SPEC.md §10.2 / §6.6). Every
 * query/mutation/route-page/endpoint/webhook surface is classified into exactly one
 * producer-owned `AccessExplainFact`: an explicit `access:` decision
 * (`public`/`verified`/non-empty guard-chain) wins; otherwise the surface is `missing` and
 * the KV436 consumer fails `kovo check`.
 *
 * This proves a decision EXISTS, never that it is CORRECT — a non-empty executable
 * guard chain in an explicit access fact satisfies it (KV414 carries IDOR
 * correctness). The proof is the producer-owned graph fact, not a TypeScript brand
 * (the compiler runs no type checker, §6.6).
 */
export function deriveAccessExplainFacts(input: AccessDerivationInput): AccessExplainFact[] {
  return deriveAccessExplainFactsFromSnapshot(snapshotAccessDerivationInput(input));
}

function deriveAccessExplainFactsFromSnapshot(input: AccessDerivationInput): AccessExplainFact[] {
  const facts: AccessExplainFact[] = [];
  appendDerivedFacts(facts, input.endpoints, 'endpoints', endpointAccessFact);
  appendDerivedFacts(facts, input.mutations, 'mutations', mutationAccessFact);
  appendDerivedFacts(facts, input.pages, 'pages', pageAccessFact);
  appendDerivedFacts(facts, input.queries, 'queries', queryAccessFact);
  return stableSortGraphFacts(facts, compareAccessExplainFact);
}

/** @internal Derive guarded/unguarded posture as producer-owned facts (SPEC.md §10.2). */
export function deriveAuthPostureFacts(input: AccessDerivationInput): AuthPostureFact[] {
  const snapshot = snapshotAccessDerivationInput(input);
  const decided = decidedAccessKeys(deriveAccessExplainFactsFromSnapshot(snapshot));
  const facts: AuthPostureFact[] = [];
  appendDerivedFacts(facts, snapshot.endpoints, 'endpoints', (endpoint) =>
    endpointAuthPostureFact(endpoint, decided),
  );
  appendDerivedFacts(facts, snapshot.mutations, 'mutations', (mutation) =>
    mutationAuthPostureFact(mutation, decided),
  );
  appendDerivedFacts(facts, snapshot.pages, 'pages', (page) => pageAuthPostureFact(page, decided));
  appendDerivedFacts(facts, snapshot.queries, 'queries', (query) =>
    queryAuthPostureFact(query, decided),
  );
  return stableSortGraphFacts(facts, compareAuthPostureFact);
}

/** @internal Derive ambient session authority posture for KV418 producers (SPEC.md §9.1). */
export function deriveSessionAuthorityFacts(input: AccessDerivationInput): SessionAuthorityFact[] {
  const snapshot = snapshotAccessDerivationInput(input);
  const facts: SessionAuthorityFact[] = [];
  appendDerivedFacts(facts, snapshot.endpoints, 'endpoints', endpointSessionAuthorityFact);
  appendDerivedFacts(facts, snapshot.mutations, 'mutations', mutationSessionAuthorityFact);
  return stableSortGraphFacts(facts, compareSessionAuthorityFact);
}

/** @internal Derive owner-domain guard posture for KV414 producers (SPEC.md §10.3). */
export function deriveOwnershipPostureFacts(input: AccessDerivationInput): OwnershipPostureFact[] {
  const snapshot = snapshotAccessDerivationInput(input);
  const facts: OwnershipPostureFact[] = [];
  appendOwnershipPostureFacts(facts, snapshot.queries, 'queries', 'query');
  appendOwnershipPostureFacts(facts, snapshot.mutations, 'mutations', 'mutation');
  return stableSortGraphFacts(facts, compareOwnershipPostureFact);
}

function appendDerivedFacts<Input, Fact>(
  facts: Fact[],
  values: readonly Input[] | undefined,
  label: string,
  derive: (value: Input) => Fact,
): void {
  if (values === undefined) return;
  for (let index = 0; index < values.length; index += 1) {
    const entry = securityOwnArrayEntry(values, index);
    if (!entry.ok) {
      throw new TypeError(`Kovo graph derivation rejected sparse ${label} at index ${index}`);
    }
    securityArrayAppend(facts, derive(entry.value));
  }
}

function stableSortGraphFacts<Fact>(
  facts: Fact[],
  compare: (left: Fact, right: Fact) => number,
): Fact[] {
  // SPEC §6.6/§11.2: graph derivation processes app-shaped names during every
  // check/explain run. A reverse-ordered graph must remain O(n log n), not make
  // insertion-sort shifts an input-amplified build denial of service.
  const length = facts.length;
  if (length < 2) return facts;
  let source: Fact[] = [];
  for (let index = 0; index < length; index += 1) {
    const entry = securityOwnArrayEntry(facts, index);
    if (!entry.ok) throw new TypeError('Kovo graph fact list is unstable.');
    securityArrayAppend(source, entry.value);
  }

  for (let width = 1; width < length; width *= 2) {
    const target: Fact[] = [];
    for (let start = 0; start < length; start += width * 2) {
      const middle = start + width < length ? start + width : length;
      const end = start + width * 2 < length ? start + width * 2 : length;
      let left = start;
      let right = middle;
      while (left < middle || right < end) {
        const useLeft =
          right >= end || (left < middle && compare(source[left]!, source[right]!) <= 0);
        securityArrayAppend(target, source[useLeft ? left++ : right++]!);
      }
    }
    source = target;
  }
  return source;
}

function compareGraphString(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function joinGraphStrings(values: readonly string[], separator: string, start = 0): string {
  let result = '';
  for (let index = start; index < values.length; index += 1) {
    const entry = securityOwnArrayEntry(values, index);
    if (!entry.ok) {
      throw new TypeError(`Kovo graph derivation rejected sparse string list at index ${index}`);
    }
    if (index !== start) result += separator;
    result += entry.value;
  }
  return result;
}

function joinNonEmptyGraphStrings(values: readonly string[], separator: string): string {
  let result = '';
  for (let index = 0; index < values.length; index += 1) {
    const entry = securityOwnArrayEntry(values, index);
    if (!entry.ok) {
      throw new TypeError(`Kovo graph derivation rejected sparse detail list at index ${index}`);
    }
    if (entry.value === '') continue;
    if (result !== '') result += separator;
    result += entry.value;
  }
  return result;
}

function explicitAccessExplainFact(
  kind: AccessExplainFact['kind'],
  name: string,
  access: AccessDecisionFact | undefined,
): AccessExplainFact | undefined {
  if (access === undefined) return undefined;

  if (access.kind === 'public') {
    return {
      decision: 'public',
      detail: 'access=public',
      justification: access.reason,
      kind,
      name,
      source: 'access',
    };
  }

  if (access.kind === 'verified-machine-auth') {
    return {
      decision: 'verified',
      detail: 'access=verified-machine-auth',
      kind,
      name,
      source: 'access',
    };
  }

  if (access.guards.length === 0) return undefined;

  return {
    decision: 'guard',
    detail: `access=guards guards=${joinGraphStrings(access.guards, ',')}`,
    kind,
    name,
    source: 'access',
  };
}

function mutationAccessFact(mutation: MutationExplain): AccessExplainFact {
  const explicit = explicitAccessExplainFact('mutation', mutation.key, mutation.access);
  if (explicit) return explicit;

  return missingAccessFact('mutation', mutation.key);
}

function queryAccessFact(query: QueryReadSet): AccessExplainFact {
  const explicit = explicitAccessExplainFact('query', query.query, query.access);
  if (explicit) return explicit;

  return missingAccessFact('query', query.query);
}

function pageAccessFact(page: PageExplain): AccessExplainFact {
  const explicit = explicitAccessExplainFact('page', page.route, page.access);
  if (explicit) return explicit;

  return missingAccessFact('page', page.route);
}

function endpointAccessFact(endpoint: EndpointExplain): AccessExplainFact {
  const kind: AccessExplainFact['kind'] = endpoint.surface === 'webhook' ? 'webhook' : 'endpoint';
  const name = endpoint.name ?? endpoint.path;
  const auth =
    endpoint.auth === 'none' && endpoint.authJustification
      ? `none:${endpoint.authJustification}`
      : (endpoint.auth ?? '-');
  const detail = `method=${endpoint.method ?? 'ANY'} path=${endpoint.path} mount=${endpoint.mount ?? 'exact'} auth=${auth}`;

  const explicit = explicitAccessExplainFact(kind, name, endpoint.access);
  if (explicit) {
    return {
      ...explicit,
      detail: `${explicit.detail} ${detail}`,
      ...(endpoint.csrfJustification === undefined
        ? {}
        : { justification: endpoint.csrfJustification }),
    };
  }

  return {
    ...missingAccessFact(kind, name),
    detail: `missing access fact ${detail}`,
    ...(endpoint.csrfJustification === undefined
      ? {}
      : { justification: endpoint.csrfJustification }),
  };
}

function missingAccessFact(kind: AccessExplainFact['kind'], name: string): AccessExplainFact {
  return {
    decision: 'missing',
    detail: 'missing access fact',
    kind,
    name,
    source: 'access',
  };
}

function compareAccessExplainFact(left: AccessExplainFact, right: AccessExplainFact): number {
  return (
    compareGraphString(left.kind, right.kind) ||
    compareGraphString(left.name, right.name) ||
    compareGraphString(left.decision, right.decision)
  );
}

function decidedAccessKeys(access: readonly AccessExplainFact[]): ReadonlySet<string> {
  const keys = securitySet<string>();
  for (let index = 0; index < access.length; index += 1) {
    const entry = securityOwnArrayEntry(access, index);
    if (!entry.ok) {
      throw new TypeError(`Kovo graph derivation rejected sparse access facts at index ${index}`);
    }
    const fact = entry.value;
    if (fact.decision !== 'missing') securitySetAdd(keys, accessKey(fact.kind, fact.name));
  }
  return keys;
}

function accessKey(kind: AccessExplainFact['kind'], name: string): string {
  return `${kind}\0${name}`;
}

function endpointAuthPostureFact(
  endpoint: EndpointExplain,
  decided: ReadonlySet<string>,
): AuthPostureFact {
  const kind = endpoint.surface === 'webhook' ? 'webhook' : 'endpoint';
  const name = endpoint.name ?? endpoint.path;
  const methodPosture = endpointDefaultCsrfPosture(endpoint.method);
  return {
    detail: joinGraphStrings(
      [
        `method=${endpoint.method ?? 'ANY'}`,
        `path=${endpoint.path}`,
        `mount=${endpoint.mount ?? 'exact'}`,
        `auth=${endpointAuthDetail(endpoint)}`,
        `csrf=${methodPosture === 'safe:read-only' ? methodPosture : (endpoint.csrf ?? methodPosture)}`,
      ],
      ' ',
    ),
    guarded:
      securitySetHas(decided, accessKey(kind, name)) ||
      hasSessionAuthGuard(endpoint.guards ?? []) ||
      endpointHasAuth(endpoint),
    kind,
    name,
    source: 'access-posture',
  };
}

function endpointDefaultCsrfPosture(method: string | undefined): 'checked' | 'safe:read-only' {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
    ? 'safe:read-only'
    : 'checked';
}

function mutationAuthPostureFact(
  mutation: MutationExplain,
  decided: ReadonlySet<string>,
): AuthPostureFact {
  return {
    detail: joinNonEmptyGraphStrings(
      [
        `guards=${listFactValues(mutation.guards)}`,
        mutation.auth === undefined ? '' : `auth=${mutation.auth}`,
        `writes=${listFactValues(mutation.writes)}`,
        `invalidates=${listFactValues(mutation.invalidates)}`,
        `manual-invalidates=${listFactValues(mutation.manualInvalidates)}`,
      ],
      ' ',
    ),
    guarded:
      securitySetHas(decided, accessKey('mutation', mutation.key)) ||
      hasSessionAuthGuard(mutation.guards ?? []) ||
      mutation.auth !== undefined,
    kind: 'mutation',
    name: mutation.key,
    source: 'access-posture',
  };
}

function pageAuthPostureFact(page: PageExplain, decided: ReadonlySet<string>): AuthPostureFact {
  return {
    detail: joinGraphStrings(
      [`guards=${listFactValues(page.guards)}`, `queries=${listFactValues(page.queries)}`],
      ' ',
    ),
    guarded:
      securitySetHas(decided, accessKey('page', page.route)) ||
      hasSessionAuthGuard(page.guards ?? []),
    kind: 'page',
    name: page.route,
    source: 'access-posture',
  };
}

function queryAuthPostureFact(query: QueryReadSet, decided: ReadonlySet<string>): AuthPostureFact {
  return {
    detail: joinGraphStrings(
      [`guards=${listFactValues(query.guards)}`, `reads=${listFactValues(query.domains)}`],
      ' ',
    ),
    guarded:
      securitySetHas(decided, accessKey('query', query.query)) ||
      hasSessionAuthGuard(query.guards ?? []),
    kind: 'query',
    name: query.query,
    source: 'access-posture',
  };
}

function endpointSessionAuthorityFact(endpoint: EndpointExplain): SessionAuthorityFact {
  const kind = endpoint.surface === 'webhook' ? 'webhook' : 'endpoint';
  return {
    detail: `auth=${endpointAuthDetail(endpoint)} guards=${listFactValues(endpoint.guards)}`,
    kind,
    name: endpoint.name ?? endpoint.path,
    referencesSession:
      endpoint.auth === 'authed' || hasSessionAuthorityGuard(endpoint.guards ?? []),
    source: 'session-authority',
  };
}

function mutationSessionAuthorityFact(mutation: MutationExplain): SessionAuthorityFact {
  return {
    detail: `session=${mutation.session ?? '-'} auth=${mutation.auth ?? '-'} guards=${listFactValues(mutation.guards)}`,
    kind: 'mutation',
    name: mutation.key,
    referencesSession:
      mutation.session !== undefined ||
      mutation.auth === 'authed' ||
      (mutation.auth !== undefined && securityStringStartsWith(mutation.auth, 'role:')) ||
      hasSessionAuthorityGuard(mutation.guards ?? []),
    source: 'session-authority',
  };
}

function appendOwnershipPostureFacts<Entry extends QueryReadSet | MutationExplain>(
  facts: OwnershipPostureFact[],
  entries: readonly Entry[] | undefined,
  label: string,
  kind: OwnershipPostureFact['kind'],
): void {
  if (entries === undefined) return;
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = securityOwnArrayEntry(entries, entryIndex);
    if (!entry.ok) {
      throw new TypeError(`Kovo graph derivation rejected sparse ${label} at index ${entryIndex}`);
    }
    const name =
      kind === 'query' ? (entry.value as QueryReadSet).query : (entry.value as MutationExplain).key;
    const guards = entry.value.guards ?? [];
    for (let guardIndex = 0; guardIndex < guards.length; guardIndex += 1) {
      const guardEntry = securityOwnArrayEntry(guards, guardIndex);
      if (!guardEntry.ok) {
        throw new TypeError(
          `Kovo graph derivation rejected sparse ${kind} guards at index ${guardIndex}`,
        );
      }
      const parsed = ownsGuardFact(guardEntry.value);
      if (parsed) {
        securityArrayAppend(facts, {
          ...parsed,
          kind,
          name,
          ownerGuarded: true,
          source: 'ownership-posture',
        });
      }
    }
  }
}

function ownsGuardFact(guard: string): Pick<OwnershipPostureFact, 'domain' | 'key'> | undefined {
  if (securityStringStartsWith(guard, 'owns:')) {
    const parts = securityStringSplit(securityStringSlice(guard, 'owns:'.length), ':');
    const domain = parts[0] === undefined ? undefined : securityStringTrim(parts[0]);
    if (!domain) return undefined;
    const key = securityStringTrim(joinGraphStrings(parts, ':', 1));
    return key ? { domain, key } : { domain };
  }
  if (securityStringStartsWith(guard, 'owns(') && securityStringSlice(guard, -1) === ')') {
    const parts = securityStringSplit(securityStringSlice(guard, 'owns('.length, -1), ',');
    const domainPart = parts[0];
    const keyPart = parts[1];
    const domain = domainPart === undefined ? undefined : securityStringTrim(domainPart);
    if (!domain) return undefined;
    const key = keyPart === undefined ? undefined : securityStringTrim(keyPart);
    return key ? { domain, key } : { domain };
  }
  return undefined;
}

function endpointHasAuth(endpoint: EndpointExplain): boolean {
  if (!endpoint.auth) return false;
  return (
    endpoint.auth === 'authed' ||
    securityStringStartsWith(endpoint.auth, 'role:') ||
    securityStringStartsWith(endpoint.auth, 'custom:') ||
    securityStringStartsWith(endpoint.auth, 'verifier:')
  );
}

function endpointAuthDetail(endpoint: EndpointExplain): string {
  if (endpoint.auth === 'none' && endpoint.authJustification) {
    return `none:${endpoint.authJustification}`;
  }
  return endpoint.auth ?? '-';
}

function hasSessionAuthGuard(guards: readonly string[]): boolean {
  for (let index = 0; index < guards.length; index += 1) {
    const entry = securityOwnArrayEntry(guards, index);
    if (!entry.ok) return false;
    if (entry.value === 'authed' || securityStringStartsWith(entry.value, 'role:')) return true;
  }
  return false;
}

function hasSessionAuthorityGuard(guards: readonly string[]): boolean {
  for (let index = 0; index < guards.length; index += 1) {
    const entry = securityOwnArrayEntry(guards, index);
    if (!entry.ok) return false;
    if (
      entry.value === 'authed' ||
      securityStringStartsWith(entry.value, 'role:') ||
      entry.value === 'owns' ||
      ownsGuardFact(entry.value) !== undefined
    ) {
      return true;
    }
  }
  return false;
}

function listFactValues(values: readonly string[] | undefined): string {
  return values === undefined || values.length === 0 ? '-' : joinGraphStrings(values, ',');
}

function compareAuthPostureFact(left: AuthPostureFact, right: AuthPostureFact): number {
  return compareGraphString(left.kind, right.kind) || compareGraphString(left.name, right.name);
}

function compareSessionAuthorityFact(
  left: SessionAuthorityFact,
  right: SessionAuthorityFact,
): number {
  return compareGraphString(left.kind, right.kind) || compareGraphString(left.name, right.name);
}

function compareOwnershipPostureFact(
  left: OwnershipPostureFact,
  right: OwnershipPostureFact,
): number {
  return (
    compareGraphString(left.kind, right.kind) ||
    compareGraphString(left.name, right.name) ||
    compareGraphString(left.domain, right.domain) ||
    compareGraphString(left.key ?? '', right.key ?? '')
  );
}

const arrayFields = [
  'access',
  'authPosture',
  'capabilities',
  'capabilityClosure',
  'components',
  'cookieDowngrades',
  'derivedMutations',
  'derivedQueries',
  'diagnostics',
  'endpoints',
  'endpointPosture',
  'eventPayloads',
  'fixpointChecks',
  'handlerWriteSinks',
  'lints',
  'massAssignmentFacts',
  'mutations',
  'optimistic',
  'ownerDomains',
  'ownershipPosture',
  'packageComponentPrefixes',
  'pages',
  'queryData',
  'queries',
  'queryWriteReachability',
  'requestProviders',
  'renderEquivalenceChecks',
  'revealed',
  'scopeAudits',
  'sessionAuthority',
  'sqlSafety',
  'sqlSafetyDiagnostics',
  'tasks',
  'toctouFacts',
  'trustEscapes',
  'unregisteredSinks',
  'updateCoverage',
  'verificationCoverage',
  'verificationDiagnostics',
] as const;

/** @internal */
export function validateKovoExplainInput(input: unknown): GraphInputValidationError[] {
  const errors: GraphInputValidationError[] = [];
  if (!isRecord(input)) {
    return [{ message: 'input JSON must be an object', path: '$' }];
  }

  const fields = securityNullRecord<unknown>();
  const budget = createGraphTraversalBudget();
  for (let index = 0; index < arrayFields.length; index += 1) {
    const field = securityOwnArrayEntry(arrayFields, index);
    if (!field.ok) continue;
    const value = ownGraphData(input, field.value, `input.${field.value}`);
    securityDefineProperty(fields, field.value, {
      configurable: true,
      enumerable: true,
      value,
      writable: false,
    });
    if (value !== undefined && !securityIsArray(value)) {
      securityArrayAppend(errors, {
        message: `${field.value} must be an array`,
        path: field.value,
      });
    }
  }

  const touchGraph = ownGraphData(input, 'touchGraph', 'input.touchGraph');
  if (touchGraph !== undefined && !isRecord(touchGraph)) {
    securityArrayAppend(errors, { message: 'touchGraph must be an object', path: 'touchGraph' });
  }

  validateDiagnosticFactCodes(fields.diagnostics, 'diagnostics', errors, budget);
  validateDiagnosticFactCodes(
    fields.verificationDiagnostics,
    'verificationDiagnostics',
    errors,
    budget,
  );
  validateDiagnosticFactCodes(fields.lints, 'lints', errors, budget);
  validateAttributeMergeDiagnosticCodes(fields.components, errors, budget);
  validateTouchGraphDiagnosticCodes(touchGraph, errors, budget);

  return errors;
}

function validateDiagnosticFactCodes(
  values: unknown,
  path: string,
  errors: GraphInputValidationError[],
  budget: GraphTraversalBudget,
): void {
  if (!securityIsArray(values)) return;
  const length = snapshotGraphArrayLength(values, path, budget);
  for (let index = 0; index < length; index += 1) {
    const entry = securityOwnArrayEntry(values, index);
    if (!entry.ok) continue;
    const value = entry.value;
    if (!isRecord(value)) continue;
    const code = ownGraphData(value, 'code', `${path}[${index}].code`);
    if (code === undefined) continue;
    validateDiagnosticCode(code, `${path}[${index}].code`, errors);
  }
}

function validateAttributeMergeDiagnosticCodes(
  components: unknown,
  errors: GraphInputValidationError[],
  budget: GraphTraversalBudget,
): void {
  if (!securityIsArray(components)) return;
  const componentLength = snapshotGraphArrayLength(components, 'components', budget);
  for (let componentIndex = 0; componentIndex < componentLength; componentIndex += 1) {
    const componentEntry = securityOwnArrayEntry(components, componentIndex);
    if (!componentEntry.ok) continue;
    const component = componentEntry.value;
    if (!isRecord(component)) continue;
    const attributeMerges = ownGraphData(
      component,
      'attributeMerges',
      `components[${componentIndex}].attributeMerges`,
    );
    if (!securityIsArray(attributeMerges)) continue;
    const mergeLength = snapshotGraphArrayLength(
      attributeMerges,
      `components[${componentIndex}].attributeMerges`,
      budget,
    );
    for (let mergeIndex = 0; mergeIndex < mergeLength; mergeIndex += 1) {
      const mergeEntry = securityOwnArrayEntry(attributeMerges, mergeIndex);
      if (!mergeEntry.ok) continue;
      const merge = mergeEntry.value;
      if (!isRecord(merge)) continue;
      const diagnostics = ownGraphData(
        merge,
        'diagnostics',
        `components[${componentIndex}].attributeMerges[${mergeIndex}].diagnostics`,
      );
      if (!securityIsArray(diagnostics)) continue;
      const codeLength = snapshotGraphArrayLength(
        diagnostics,
        `components[${componentIndex}].attributeMerges[${mergeIndex}].diagnostics`,
        budget,
      );
      for (let codeIndex = 0; codeIndex < codeLength; codeIndex += 1) {
        const code = securityOwnArrayEntry(diagnostics, codeIndex);
        if (!code.ok) continue;
        validateDiagnosticCode(
          code.value,
          `components[${componentIndex}].attributeMerges[${mergeIndex}].diagnostics[${codeIndex}]`,
          errors,
        );
      }
    }
  }
}

function validateTouchGraphDiagnosticCodes(
  touchGraph: unknown,
  errors: GraphInputValidationError[],
  budget: GraphTraversalBudget,
): void {
  if (!isRecord(touchGraph)) return;

  const names = securityObjectKeys(touchGraph);
  consumeGraphTraversalEntries(budget, names.length);
  for (let nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
    const nameEntry = securityOwnArrayEntry(names, nameIndex);
    if (!nameEntry.ok) continue;
    const entryName = nameEntry.value;
    const descriptor = securityGetOwnPropertyDescriptor(touchGraph, entryName);
    if (descriptor === undefined || !('value' in descriptor)) continue;
    const entry = descriptor.value;
    if (!isRecord(entry)) continue;
    const unresolved = ownGraphData(
      entry,
      'unresolved',
      `touchGraph.${quotePathSegment(entryName)}.unresolved`,
    );
    if (!securityIsArray(unresolved)) continue;
    const unresolvedLength = snapshotGraphArrayLength(
      unresolved,
      `touchGraph.${quotePathSegment(entryName)}.unresolved`,
      budget,
    );
    for (let index = 0; index < unresolvedLength; index += 1) {
      const unresolvedEntry = securityOwnArrayEntry(unresolved, index);
      if (!unresolvedEntry.ok) continue;
      if (!isRecord(unresolvedEntry.value)) continue;
      const code = ownGraphData(
        unresolvedEntry.value,
        'code',
        `touchGraph.${quotePathSegment(entryName)}.unresolved[${index}].code`,
      );
      if (code === undefined) continue;
      validateDiagnosticCode(
        code,
        `touchGraph.${quotePathSegment(entryName)}.unresolved[${index}].code`,
        errors,
      );
    }
  }
}

function validateDiagnosticCode(
  value: unknown,
  path: string,
  errors: GraphInputValidationError[],
): void {
  if (isDiagnosticCode(value)) return;

  securityArrayAppend(errors, {
    message: `unknown diagnostic code ${graphScalarLabel(value)}`,
    path,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !securityIsArray(value);
}

function quotePathSegment(value: string): string {
  if (value.length > 4_096) return '"<oversized-key>"';
  return securityRegExpTest(/^[A-Za-z_$][\w$]*$/u, value)
    ? value
    : (securityJsonStringify(value) ?? '""');
}

function graphScalarLabel(value: unknown): string {
  if (typeof value === 'string' && value.length > 4_096) {
    return `[string:${value.length} characters]`;
  }
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return securityJsonStringify(value) ?? 'undefined';
  }
  return `[${typeof value}]`;
}
