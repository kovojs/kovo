import type { DerivationStatus } from './derivation.js';

import { isDiagnosticCode, type DiagnosticCode, type DiagnosticSeverity } from './diagnostics.js';

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
  kind: 'endpoint' | 'mutation' | 'webhook';
  name: string;
  referencesSession: boolean;
  source?: 'session-authority';
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
  | { guards: readonly { name: string }[]; kind: 'guard-chain' }
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
  // `req.session` (surfaced here as `session`) or run a session/cookie-derived guard
  // (`authed`, `role()`, `owns()`), because such a mutation would skip CSRF yet still ride
  // the victim's ambient cookie — the unsound exemption §9.1 forbids for endpoints.
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
  csrf?: 'checked' | 'exempt';
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

/** @internal */
export interface TrustEscapeExplain {
  justification?: string;
  kind:
    | 'customVerifier'
    | 'rawEndpoint'
    | 'staticExportPathOverride'
    | 'trustedHtml'
    | 'trustedSql'
    | 'trustedUrl'
    | 'webhookVerifyNone';
  owner?: string;
  safePath?: string;
  site: string;
  source?: string;
}

/** @internal */
export interface RevealExplainFact {
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
 * @internal A held dangerous *capability* surfaced by `kovo explain --capabilities` (SPEC §6.6,
 * audit-only). One row per declared escape: a `publishToClient` secret-emit escape (KV437), an
 * egress `allowInternal` private-network entry, a confidentiality `trustedReveal`, an audited
 * `crossOwnerRead`, or a `serverValue`/`unsafeCookie`/`accept.unverified` escape. The renderer collects these from the
 * merged slice facts so a reviewer can diff the app's entire dangerous-capability surface in one
 * audited table. Audit-only: surfacing informs review; it enforces nothing.
 */
export interface CapabilityExplain {
  /** The capability family the escape belongs to. */
  kind:
    | 'acceptUnverified'
    | 'crossOwnerRead'
    | 'egressAllowInternal'
    | 'publishToClient'
    | 'serverValue'
    | 'trustedReveal'
    | 'unsafeCookie';
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

/**
 * @internal By-construction default-deny classifier (SPEC.md §10.2 / §6.6). Every
 * query/mutation/route-page/endpoint/webhook surface is classified into exactly one
 * producer-owned `AccessExplainFact`: an explicit `access:` decision
 * (`public`/`verified`/guard-chain) wins; otherwise the surface is `missing` and
 * the KV436 consumer fails `kovo check`.
 *
 * This proves a decision EXISTS, never that it is CORRECT — a no-op guard chain in
 * an explicit access fact satisfies it (KV414 carries IDOR correctness). The proof
 * is the static graph fact, not a TypeScript brand (the compiler runs no type checker,
 * §6.6).
 */
export function deriveAccessExplainFacts(input: AccessDerivationInput): AccessExplainFact[] {
  return [
    ...(input.endpoints ?? []).map(endpointAccessFact),
    ...(input.mutations ?? []).map(mutationAccessFact),
    ...(input.pages ?? []).map(pageAccessFact),
    ...(input.queries ?? []).map(queryAccessFact),
  ].sort(compareAccessExplainFact);
}

/** @internal Derive guarded/unguarded posture as producer-owned facts (SPEC.md §10.2). */
export function deriveAuthPostureFacts(input: AccessDerivationInput): AuthPostureFact[] {
  const decided = decidedAccessKeys(deriveAccessExplainFacts(input));
  return [
    ...(input.endpoints ?? []).map((endpoint) => endpointAuthPostureFact(endpoint, decided)),
    ...(input.mutations ?? []).map((mutation) => mutationAuthPostureFact(mutation, decided)),
    ...(input.pages ?? []).map((page) => pageAuthPostureFact(page, decided)),
    ...(input.queries ?? []).map((query) => queryAuthPostureFact(query, decided)),
  ].sort(compareAuthPostureFact);
}

/** @internal Derive ambient session authority posture for KV418 producers (SPEC.md §9.1). */
export function deriveSessionAuthorityFacts(input: AccessDerivationInput): SessionAuthorityFact[] {
  return [
    ...(input.endpoints ?? []).map(endpointSessionAuthorityFact),
    ...(input.mutations ?? []).map(mutationSessionAuthorityFact),
  ].sort(compareSessionAuthorityFact);
}

/** @internal Derive owner-domain guard posture for KV414 producers (SPEC.md §10.3). */
export function deriveOwnershipPostureFacts(input: AccessDerivationInput): OwnershipPostureFact[] {
  return [
    ...(input.queries ?? []).flatMap((query) =>
      ownershipPostureFactsForGuards('query', query.query, query.guards ?? []),
    ),
    ...(input.mutations ?? []).flatMap((mutation) =>
      ownershipPostureFactsForGuards('mutation', mutation.key, mutation.guards ?? []),
    ),
  ].sort(compareOwnershipPostureFact);
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

  const guards =
    access.guards.length === 0 ? '-' : access.guards.map((guard) => guard.name).join(',');
  return {
    decision: 'guard',
    detail: `access=guard-chain guards=${guards}`,
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
    left.kind.localeCompare(right.kind) ||
    left.name.localeCompare(right.name) ||
    left.decision.localeCompare(right.decision)
  );
}

function decidedAccessKeys(access: readonly AccessExplainFact[]): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const fact of access) {
    if (fact.decision !== 'missing') keys.add(accessKey(fact.kind, fact.name));
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
  return {
    detail: [
      `method=${endpoint.method ?? 'ANY'}`,
      `path=${endpoint.path}`,
      `mount=${endpoint.mount ?? 'exact'}`,
      `auth=${endpointAuthDetail(endpoint)}`,
      `csrf=${endpoint.csrf ?? 'checked'}`,
    ].join(' '),
    guarded:
      decided.has(accessKey(kind, name)) ||
      hasSessionAuthGuard(endpoint.guards ?? []) ||
      endpointHasAuth(endpoint),
    kind,
    name,
    source: 'access-posture',
  };
}

function mutationAuthPostureFact(
  mutation: MutationExplain,
  decided: ReadonlySet<string>,
): AuthPostureFact {
  return {
    detail: [
      `guards=${listFactValues(mutation.guards)}`,
      mutation.auth === undefined ? '' : `auth=${mutation.auth}`,
      `writes=${listFactValues(mutation.writes)}`,
      `invalidates=${listFactValues(mutation.invalidates)}`,
      `manual-invalidates=${listFactValues(mutation.manualInvalidates)}`,
    ]
      .filter(Boolean)
      .join(' '),
    guarded:
      decided.has(accessKey('mutation', mutation.key)) ||
      hasSessionAuthGuard(mutation.guards ?? []) ||
      mutation.auth !== undefined,
    kind: 'mutation',
    name: mutation.key,
    source: 'access-posture',
  };
}

function pageAuthPostureFact(page: PageExplain, decided: ReadonlySet<string>): AuthPostureFact {
  return {
    detail: [
      `guards=${listFactValues(page.guards)}`,
      `queries=${listFactValues(page.queries)}`,
    ].join(' '),
    guarded: decided.has(accessKey('page', page.route)) || hasSessionAuthGuard(page.guards ?? []),
    kind: 'page',
    name: page.route,
    source: 'access-posture',
  };
}

function queryAuthPostureFact(query: QueryReadSet, decided: ReadonlySet<string>): AuthPostureFact {
  return {
    detail: [
      `guards=${listFactValues(query.guards)}`,
      `reads=${listFactValues(query.domains)}`,
    ].join(' '),
    guarded:
      decided.has(accessKey('query', query.query)) || hasSessionAuthGuard(query.guards ?? []),
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
      mutation.auth?.startsWith('role:') === true ||
      hasSessionAuthorityGuard(mutation.guards ?? []),
    source: 'session-authority',
  };
}

function ownershipPostureFactsForGuards(
  kind: OwnershipPostureFact['kind'],
  name: string,
  guards: readonly string[],
): OwnershipPostureFact[] {
  return guards.flatMap((guard) => {
    const parsed = ownsGuardFact(guard);
    if (!parsed) return [];
    return [{ ...parsed, kind, name, ownerGuarded: true, source: 'ownership-posture' as const }];
  });
}

function ownsGuardFact(guard: string): Pick<OwnershipPostureFact, 'domain' | 'key'> | undefined {
  if (guard.startsWith('owns:')) {
    const parts = guard.slice('owns:'.length).split(':');
    const domain = parts[0]?.trim();
    if (!domain) return undefined;
    const key = parts.slice(1).join(':').trim();
    return key ? { domain, key } : { domain };
  }
  if (guard.startsWith('owns(') && guard.endsWith(')')) {
    const [domainPart, keyPart] = guard.slice('owns('.length, -1).split(',');
    const domain = domainPart?.trim();
    if (!domain) return undefined;
    const key = keyPart?.trim();
    return key ? { domain, key } : { domain };
  }
  return undefined;
}

function endpointHasAuth(endpoint: EndpointExplain): boolean {
  if (!endpoint.auth) return false;
  return (
    endpoint.auth === 'authed' ||
    endpoint.auth.startsWith('role:') ||
    endpoint.auth.startsWith('custom:') ||
    endpoint.auth.startsWith('verifier:')
  );
}

function endpointAuthDetail(endpoint: EndpointExplain): string {
  if (endpoint.auth === 'none' && endpoint.authJustification) {
    return `none:${endpoint.authJustification}`;
  }
  return endpoint.auth ?? '-';
}

function hasSessionAuthGuard(guards: readonly string[]): boolean {
  return guards.some((guard) => guard === 'authed' || guard.startsWith('role:'));
}

function hasSessionAuthorityGuard(guards: readonly string[]): boolean {
  return guards.some(
    (guard) =>
      guard === 'authed' ||
      guard.startsWith('role:') ||
      guard === 'owns' ||
      ownsGuardFact(guard) !== undefined,
  );
}

function listFactValues(values: readonly string[] | undefined): string {
  return values === undefined || values.length === 0 ? '-' : values.join(',');
}

function compareAuthPostureFact(left: AuthPostureFact, right: AuthPostureFact): number {
  return left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name);
}

function compareSessionAuthorityFact(
  left: SessionAuthorityFact,
  right: SessionAuthorityFact,
): number {
  return left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name);
}

function compareOwnershipPostureFact(
  left: OwnershipPostureFact,
  right: OwnershipPostureFact,
): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.name.localeCompare(right.name) ||
    left.domain.localeCompare(right.domain) ||
    (left.key ?? '').localeCompare(right.key ?? '')
  );
}

const arrayFields = [
  'access',
  'authPosture',
  'capabilities',
  'components',
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

  for (const field of arrayFields) {
    if (input[field] !== undefined && !Array.isArray(input[field])) {
      errors.push({ message: `${field} must be an array`, path: field });
    }
  }

  if (input.touchGraph !== undefined && !isRecord(input.touchGraph)) {
    errors.push({ message: 'touchGraph must be an object', path: 'touchGraph' });
  }

  validateDiagnosticFactCodes(input.diagnostics, 'diagnostics', errors);
  validateDiagnosticFactCodes(input.verificationDiagnostics, 'verificationDiagnostics', errors);
  validateDiagnosticFactCodes(input.lints, 'lints', errors);
  validateAttributeMergeDiagnosticCodes(input.components, errors);
  validateTouchGraphDiagnosticCodes(input.touchGraph, errors);

  return errors;
}

function validateDiagnosticFactCodes(
  values: unknown,
  path: string,
  errors: GraphInputValidationError[],
): void {
  if (!Array.isArray(values)) return;

  values.forEach((value, index) => {
    if (!isRecord(value) || value.code === undefined) return;
    validateDiagnosticCode(value.code, `${path}[${index}].code`, errors);
  });
}

function validateAttributeMergeDiagnosticCodes(
  components: unknown,
  errors: GraphInputValidationError[],
): void {
  if (!Array.isArray(components)) return;

  components.forEach((component, componentIndex) => {
    if (!isRecord(component) || !Array.isArray(component.attributeMerges)) return;

    component.attributeMerges.forEach((merge, mergeIndex) => {
      if (!isRecord(merge) || !Array.isArray(merge.diagnostics)) return;

      merge.diagnostics.forEach((code, codeIndex) => {
        validateDiagnosticCode(
          code,
          `components[${componentIndex}].attributeMerges[${mergeIndex}].diagnostics[${codeIndex}]`,
          errors,
        );
      });
    });
  });
}

function validateTouchGraphDiagnosticCodes(
  touchGraph: unknown,
  errors: GraphInputValidationError[],
): void {
  if (!isRecord(touchGraph)) return;

  for (const [entryName, entry] of Object.entries(touchGraph)) {
    if (!isRecord(entry) || !Array.isArray(entry.unresolved)) continue;

    entry.unresolved.forEach((unresolved, index) => {
      if (!isRecord(unresolved) || unresolved.code === undefined) return;
      validateDiagnosticCode(
        unresolved.code,
        `touchGraph.${quotePathSegment(entryName)}.unresolved[${index}].code`,
        errors,
      );
    });
  }
}

function validateDiagnosticCode(
  value: unknown,
  path: string,
  errors: GraphInputValidationError[],
): void {
  if (isDiagnosticCode(value)) return;

  errors.push({
    message: `unknown diagnostic code ${JSON.stringify(value)}`,
    path,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function quotePathSegment(value: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(value) ? value : JSON.stringify(value);
}
