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
  domain: string;
  keys: null | string;
  predicate?: 'eq' | 'non-eq';
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
  capabilities?: readonly CapabilityExplainFact[];
  derivedMutations?: readonly DerivedMutationDomainSet[];
  derivedQueries?: readonly QueryReadSet[];
  diagnostics?: readonly StaticDiagnosticFact[];
  cookies?: readonly CookieExplainFact[];
  endpoints?: readonly EndpointExplain[];
  eventPayloads?: readonly EventPayloadFact[];
  fixpointChecks?: readonly FixpointCheck[];
  lints?: readonly SemanticLint[];
  mutations?: readonly MutationExplain[];
  optimistic?: readonly OptimisticCoverage[];
  ownerDomains?: readonly OwnerDomainFact[];
  pages?: readonly PageExplain[];
  queryData?: readonly QueryDataFact[];
  queries?: readonly QueryReadSet[];
  requestProviders?: readonly RequestProviderExplain[];
  renderEquivalenceChecks?: readonly RenderEquivalenceCheck[];
  revealed?: readonly RevealExplainFact[];
  scopeAudits?: readonly ScopeAuditFact[];
  sqlSafety?: readonly SqlSafetyExplainFact[];
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
  source?: 'access' | 'auth' | 'guard' | 'legacy-guard' | 'webhook';
}

/** @internal */
export interface CapabilityExplainFact {
  column?: string;
  kind: 'adminAssign' | 'cspAllow' | 'publishToClient' | 'unsafeRegex';
  reason?: string;
  site: string;
  source?: string;
  table?: string;
}

/** @internal */
export interface CookieExplainFact {
  class: 'app-data' | 'auth' | 'session';
  downgraded?: readonly ('httpOnly' | 'sameSiteNone' | 'secure')[];
  floor: string;
  justification?: string;
  name: string;
  site?: string;
  source: 'builder' | 'forwarded';
}

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
  auth?: string;
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
  kind: 'layout' | 'page';
  name: string;
  queries?: readonly string[];
}

/** @internal */
export interface PageExplain {
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
  auth?: string;
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
  name?: string;
  path: string;
  rateLimit?: string;
  surface?: 'dynamic-export' | 'endpoint' | 'route-file' | 'route-stream' | 'webhook';
  writes?: readonly string[];
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
  kind: 'query' | 'write';
  name: string;
  scope: 'args' | 'session' | 'unscoped' | 'unknown';
  site: string;
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
  domains: readonly string[];
  guards?: readonly string[];
  query: string;
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

const arrayFields = [
  'access',
  'capabilities',
  'components',
  'cookies',
  'derivedMutations',
  'derivedQueries',
  'diagnostics',
  'endpoints',
  'eventPayloads',
  'fixpointChecks',
  'lints',
  'mutations',
  'optimistic',
  'ownerDomains',
  'packageComponentPrefixes',
  'pages',
  'queryData',
  'queries',
  'requestProviders',
  'renderEquivalenceChecks',
  'revealed',
  'scopeAudits',
  'sqlSafety',
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
