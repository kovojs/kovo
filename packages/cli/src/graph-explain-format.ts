/* oxlint-disable typescript/unbound-method -- Boot-captured controls pin KV330 diagnostic policy. */
import type { DiagnosticCode, DiagnosticSeverity } from '@kovojs/core';
import { diagnosticDefinitionText, diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import { puntReasonLabel } from '@kovojs/core/internal/derivation';
import type { DerivationProof } from '@kovojs/core/internal/derivation';
import type * as CoreGraph from '@kovojs/core/internal/graph';
import {
  deriveOwnershipPostureFacts,
  deriveSessionAuthorityFacts,
} from '@kovojs/core/internal/graph';
import { frameworkSourceSinkInventory } from '@kovojs/core/internal/source-sink-registry';

import type { KovoTargetExplainOptions } from './graph-args.js';
import type { KovoCheckResult } from './shared.js';

const NativeReflect = globalThis.Reflect;
const NativeSet = globalThis.Set;
const nativeReflectApply = NativeReflect.apply;
const nativeSetHas = NativeSet.prototype.has;

const explainOutputVersion = 'kovo-explain/v1';

export type DocumentSourceSinkRow = ReturnType<typeof frameworkSourceSinkInventory>[number];

export interface TouchGraphDiagnosticFact {
  code: DiagnosticCode;
  message: string;
  severity: DiagnosticSeverity;
  site: string;
}

export interface UnguardedAccessFact {
  detail: string;
  kind: 'endpoint' | 'mutation' | 'page' | 'query' | 'webhook';
  name: string;
}

export function diagnosticSeverity(
  diagnostic: Pick<CoreGraph.StaticDiagnosticFact, 'code' | 'severity'>,
): DiagnosticSeverity {
  return diagnostic.severity ?? diagnosticDefinitions[diagnostic.code].severity;
}

export function diagnosticsForTouchGraph(graph: CoreGraph.TouchGraph): TouchGraphDiagnosticFact[] {
  return Object.values(graph).flatMap((entry) => [
    ...entry.unresolved.map((unresolved) => ({
      code: unresolved.code,
      message: unresolved.message,
      severity: diagnosticDefinitions[unresolved.code].severity,
      site: unresolved.site,
    })),
    ...entry.touches
      .filter((touch) => touch.predicate === 'non-eq')
      .map((touch) => ({
        code: 'KV409' as const,
        message: diagnosticDefinitions.KV409.message,
        severity: diagnosticDefinitions.KV409.severity,
        site: touch.site,
      })),
    ...(entry.reads ?? [])
      .filter((read) => read.predicate === 'non-eq')
      .map((read) => ({
        code: 'KV409' as const,
        message: diagnosticDefinitions.KV409.message,
        severity: diagnosticDefinitions.KV409.severity,
        site: read.site,
      })),
  ]);
}

export function verificationDiagnosticLine(
  diagnostic: CoreGraph.VerificationDiagnosticFact,
): string {
  const definition = diagnosticDefinitions[diagnostic.code];
  const severity = diagnostic.severity ?? definition.severity;
  const site = diagnostic.site ?? (diagnostic.domain ? `domain:${diagnostic.domain}` : '-');
  const details = [
    diagnostic.domain ? `domain=${diagnostic.domain}` : '',
    diagnostic.branch ? `branch=${diagnostic.branch}` : '',
    diagnostic.detail ?? '',
  ].filter(Boolean);
  const suffix = details.length > 0 ? ` ${details.join(' ')}` : '';

  return `${severity.toUpperCase()} ${diagnostic.code} ${site} ${diagnostic.message ?? definition.message}${suffix}`;
}

export function verificationCoverageGapLine(coverage: CoreGraph.VerificationCoverageFact): string {
  const site = coverage.site ? `${coverage.site} ` : '';
  return `ERROR VERIFY ${site}${coverage.kind} ${coverage.key} has no verifier coverage.`;
}

export function endpointPostureVerificationLines(
  fact: CoreGraph.EndpointPostureVerificationFact,
): string[] {
  const site = fact.site ? `${fact.site} ` : '';
  if (!fact.observed) {
    return [`ERROR ENDPOINT-POSTURE ${site}${fact.endpoint} fixture was not observed.`];
  }

  const failures = fact.failures ?? [];
  if (failures.length === 0) {
    return [`OK ENDPOINT-POSTURE ${site}${fact.endpoint}`];
  }

  return failures.map((failure) => `ERROR ENDPOINT-POSTURE ${site}${fact.endpoint} ${failure}`);
}

export function missingEndpointPostureLines(
  endpoints: readonly CoreGraph.EndpointExplain[],
  facts: readonly CoreGraph.EndpointPostureVerificationFact[],
): string[] {
  const observed = new Set(facts.filter((fact) => fact.observed).map((fact) => fact.endpoint));
  return endpoints
    .filter((endpoint) => endpoint.method !== undefined)
    .map((endpoint) => endpointPostureKey(endpoint))
    .filter((endpoint) => !observed.has(endpoint))
    .sort()
    .map((endpoint) => `ERROR ENDPOINT-POSTURE ${endpoint} declared endpoint was not observed.`);
}

export function endpointPostureKey(endpoint: CoreGraph.EndpointExplain): string {
  return `${endpoint.method ?? 'ANY'} ${endpoint.path}`;
}

export function staticDiagnosticLine(diagnostic: CoreGraph.StaticDiagnosticFact): string {
  const definition = diagnosticDefinitions[diagnostic.code];
  const severity = diagnostic.severity ?? definition.severity;
  return `${severity.toUpperCase()} ${diagnostic.code} ${diagnosticSite(diagnostic)} ${diagnostic.message ?? definition.message}`;
}

/**
 * SQL-safety (KV422) diagnostics carried into the check graph by the compile/build pipeline.
 *
 * `analyzeSqlSafetyFromProject` (@kovojs/drizzle/internal/static, SPEC §10.2/§11.2) returns
 * `{ code, message, severity, site }` records — exactly {@link TouchGraphDiagnosticFact}. They are
 * attached to the check graph as a `sqlSafetyDiagnostics` field (not part of the typed
 * `KovoCheckInput` surface, so it is read defensively here).
 */
export function sqlSafetyDiagnostics(graph: CoreGraph.KovoCheckInput): TouchGraphDiagnosticFact[] {
  const raw = (graph as { sqlSafetyDiagnostics?: unknown }).sqlSafetyDiagnostics;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (diagnostic): diagnostic is TouchGraphDiagnosticFact =>
      typeof diagnostic === 'object' &&
      diagnostic !== null &&
      typeof (diagnostic as { code?: unknown }).code === 'string' &&
      typeof (diagnostic as { site?: unknown }).site === 'string',
  );
}

export function sqlSafetyKv422Line(diagnostic: TouchGraphDiagnosticFact): string {
  const definition = diagnosticDefinitions[diagnostic.code];
  const severity = diagnostic.severity ?? definition?.severity ?? 'error';
  return `${severity.toUpperCase()} ${diagnostic.code} ${diagnostic.site} ${diagnostic.message ?? definition?.message ?? ''}`.trimEnd();
}

export function unregisteredSinkLine(sink: CoreGraph.UnregisteredSinkFact): string {
  const source = sink.source ? ` source=${sink.source}` : '';
  return [
    `ERROR KV424 ${sink.site} sink=${sink.sink}${source} safe=${sink.safePath}`,
    diagnosticDefinitionText('KV424', { includeHelp: true }),
  ].join(' ');
}

export interface EndpointMetadataDiagnostic {
  detail: string;
  endpoint: CoreGraph.EndpointExplain;
}

export function endpointMetadataDiagnostics(
  endpoints: readonly CoreGraph.EndpointExplain[],
): EndpointMetadataDiagnostic[] {
  return endpoints.flatMap((endpoint) => {
    const missing = missingEndpointMetadata(endpoint);
    return missing.length === 0 ? [] : [{ detail: `missing=${missing.join(',')}`, endpoint }];
  });
}

export function missingEndpointMetadata(endpoint: CoreGraph.EndpointExplain): string[] {
  const missing: string[] = [];
  const surface = endpoint.surface ?? 'endpoint';

  if (!endpoint.method) missing.push('method');
  if (!endpoint.reason && surface === 'endpoint') missing.push('reason');
  if (!endpoint.body) missing.push('response.body');
  if (!endpoint.cache) missing.push('response.cache');
  if (endpoint.appOwnedSafety !== true && surface === 'endpoint') missing.push('appOwnedSafety');
  if (endpoint.mount === 'prefix' && !endpoint.mountJustification) {
    missing.push('mountJustification');
  }
  if (endpoint.csrf === 'exempt' && !endpoint.csrfJustification) {
    missing.push('csrfJustification');
  }

  if (surface === 'webhook') {
    if (!endpoint.name) missing.push('name');
    if (endpoint.method && endpoint.method.toUpperCase() !== 'POST') missing.push('method=POST');
    if ((endpoint.mount ?? 'exact') !== 'exact') missing.push('mount=exact');
    if (!endpoint.auth) missing.push('auth');
    if (endpoint.auth === 'none' && !endpoint.csrfJustification) {
      missing.push('verifyJustification');
    }
  }

  return missing;
}

export function endpointMetadataKv423Line(diagnostic: EndpointMetadataDiagnostic): string {
  return [
    `ERROR KV423 ${endpointSurfaceLabel(diagnostic.endpoint)} ${endpointName(diagnostic.endpoint)}`,
    diagnosticDefinitions.KV423.message,
    diagnostic.detail,
  ].join(' ');
}

export function endpointSurfaceLabel(endpoint: CoreGraph.EndpointExplain): string {
  return endpoint.surface === 'webhook' ? 'WEBHOOK' : 'ENDPOINT';
}

export function diagnosticSite(diagnostic: CoreGraph.StaticDiagnosticFact): string {
  return diagnostic.start
    ? `${diagnostic.site}:${diagnostic.start.line}:${diagnostic.start.column}`
    : diagnostic.site;
}

export function notFound(options: KovoTargetExplainOptions): KovoCheckResult {
  return {
    exitCode: 1,
    output: `${explainOutputVersion}\nERROR NOT_FOUND ${options.kind} ${options.target}\n`,
  };
}

export function list(values: readonly string[] | undefined): string {
  return values && values.length > 0 ? values.join(',') : '-';
}

export function sortedTasks(tasks: readonly CoreGraph.TaskExplain[]): CoreGraph.TaskExplain[] {
  return [...tasks].sort((left, right) => left.key.localeCompare(right.key));
}

export function taskSummaryLine(task: CoreGraph.TaskExplain): string {
  return [
    `TASK ${task.key}`,
    `cron=${task.cron ?? '-'}`,
    `runMutations=${list(task.runMutations)}`,
    `runQueries=${list(task.runQueries)}`,
    `schedules=${list(task.schedules)}`,
  ].join(' ');
}

export function sortedHandlerWriteSinks(
  facts: readonly CoreGraph.HandlerWriteSinkExplain[],
): CoreGraph.HandlerWriteSinkExplain[] {
  return [...facts].sort(
    (left, right) =>
      left.surface.localeCompare(right.surface) ||
      left.owner.value.localeCompare(right.owner.value) ||
      left.span.start - right.span.start ||
      left.operationKind.localeCompare(right.operationKind) ||
      left.path.localeCompare(right.path),
  );
}

export function handlerWriteSinkExplainLine(fact: CoreGraph.HandlerWriteSinkExplain): string {
  return [
    'WRITE-SINK',
    `surface=${fact.surface}`,
    `owner=${fact.owner.kind}:${fact.owner.value}`,
    `operation=${fact.operationKind}`,
    `target=${fact.canonicalTarget.identity}`,
    `targetProvenance=${fact.canonicalTarget.provenance}`,
    `path=${fact.path}`,
    `span=${fact.span.start}-${fact.span.end}`,
    `status=${handlerWriteSinkIsUnresolved(fact) ? 'unresolved' : 'resolved'}`,
  ].join(' ');
}

export function handlerWriteSinkIsUnresolved(fact: CoreGraph.HandlerWriteSinkExplain): boolean {
  return (
    fact.operationKind === 'UNRESOLVED' ||
    fact.path === 'UNRESOLVED' ||
    fact.owner.value === 'UNRESOLVED' ||
    fact.canonicalTarget.identity === 'UNRESOLVED'
  );
}

export function handlerWriteSinkCheckLines(
  facts: readonly CoreGraph.HandlerWriteSinkExplain[],
): string[] {
  return sortedHandlerWriteSinks(facts).map((fact) => {
    const surface = fact.surface.toUpperCase();
    if (handlerWriteSinkIsUnresolved(fact)) {
      return [
        'ERROR KV406',
        `${surface} ${fact.owner.kind}:${fact.owner.value}`,
        unresolvedHandlerWriteSinkMessage(fact.surface),
        `operation=${fact.operationKind}`,
        `target=${fact.canonicalTarget.identity}`,
        `path=${fact.path}`,
        `span=${fact.span.start}-${fact.span.end}`,
      ].join(' ');
    }
    return [
      'ERROR KV330',
      `${surface} ${fact.owner.kind}:${fact.owner.value}`,
      resolvedHandlerWriteSinkMessage(fact.surface),
      `operation=${fact.operationKind}`,
      `target=${fact.canonicalTarget.identity}`,
      `path=${fact.path}`,
      `span=${fact.span.start}-${fact.span.end}`,
    ].join(' ');
  });
}

export function hasStaticHandlerWriteSinkDiagnostic(
  diagnostics: readonly CoreGraph.StaticDiagnosticFact[],
): boolean {
  return diagnostics.some((diagnostic) => {
    if (diagnostic.code === 'KV330') {
      return handlerWriteSinkKv330MessageHas(
        diagnostic.message ?? diagnosticDefinitions.KV330.message,
      );
    }
    return (
      diagnostic.code === 'KV406' &&
      typeof diagnostic.message === 'string' &&
      diagnostic.message.includes('Unresolved write sink in a')
    );
  });
}

const handlerWriteSinkKv330Messages = new NativeSet([
  diagnosticDefinitions.KV330.message,
  'Direct db access in a task run body; route through ctx.runMutation.',
  'Direct db access in an endpoint handler; use readonlyAppDb for reads and route writes through an audited mutation/domain write.',
  'Direct db access in a webhook handler; route writes through an audited mutation/domain write.',
]);

function handlerWriteSinkKv330MessageHas(message: string): boolean {
  return nativeReflectApply(nativeSetHas, handlerWriteSinkKv330Messages, [message]) === true;
}

export function resolvedHandlerWriteSinkMessage(
  surface: CoreGraph.HandlerWriteSinkSurface,
): string {
  if (surface === 'mutation') return diagnosticDefinitions.KV330.message;
  if (surface === 'task')
    return 'Direct db access in a task run body; route through ctx.runMutation.';
  if (surface === 'endpoint') {
    return 'Direct db access in an endpoint handler; use readonlyAppDb for reads and route writes through an audited mutation/domain write.';
  }
  return 'Direct db access in a webhook handler; route writes through an audited mutation/domain write.';
}

export function unresolvedHandlerWriteSinkMessage(
  surface: CoreGraph.HandlerWriteSinkSurface,
): string {
  if (surface === 'task')
    return 'Unresolved write sink in a task run body; route through ctx.runMutation.';
  if (surface === 'mutation')
    return 'Unresolved write sink in a mutation handler; route through domain.';
  if (surface === 'endpoint') {
    return 'Unresolved write sink in an endpoint handler; route writes through an audited mutation/domain write.';
  }
  return 'Unresolved write sink in a webhook handler; route writes through an audited mutation/domain write.';
}

export function sqlSafetyFactsForTarget(
  graph: CoreGraph.KovoExplainInput,
  targetKind: CoreGraph.SqlSafetyExplainFact['targetKind'],
  target: string,
): CoreGraph.SqlSafetyExplainFact[] {
  return [...(graph.sqlSafety ?? [])]
    .filter((fact) => fact.targetKind === targetKind && fact.target === target)
    .sort((left, right) => left.site.localeCompare(right.site));
}

export function sqlSafetyLine(fact: CoreGraph.SqlSafetyExplainFact): string {
  return [
    `SQL ${fact.site}`,
    `text=${fact.text}`,
    `declarations=${list(fact.declarations)}`,
    `justification=${fact.justificationSite ?? '-'}`,
  ].join(' ');
}

export function findComponentExplain(
  components: readonly CoreGraph.ComponentExplain[] | undefined,
  target: string,
): CoreGraph.ComponentExplain | undefined {
  return components?.find(
    (component) =>
      component.name === target ||
      component.domName === target ||
      component.disambiguatedDomName === target ||
      componentWireName(component.name) === target,
  );
}

export function componentPrefixProvenance(
  component: CoreGraph.ComponentExplain,
  target: string,
  input: CoreGraph.KovoExplainInput,
): string | null {
  const wireName = target.includes('-') ? target : componentWireName(component.name);
  const owner = packagePrefixOwner(input.packageComponentPrefixes, wireName);
  if (!owner) return null;

  const effectivePrefix = owner.effectivePrefix ?? owner.prefix;
  if (!effectivePrefix) return null;

  return [
    'provenance:',
    `package=${owner.packageName}`,
    `prefix=${owner.prefix ?? '-'}`,
    `effective-prefix=${effectivePrefix}`,
    'source=package-prefix-fact',
  ].join(' ');
}

export function packagePrefixOwner(
  facts: readonly CoreGraph.PackageComponentPrefixExplain[] | undefined,
  wireName: string,
): CoreGraph.PackageComponentPrefixExplain | null {
  const candidates = (facts ?? [])
    .filter((fact) => {
      const effectivePrefix = fact.effectivePrefix ?? fact.prefix;
      return Boolean(effectivePrefix && wireName.startsWith(effectivePrefix));
    })
    .sort((left, right) => {
      const leftPrefix = left.effectivePrefix ?? left.prefix ?? '';
      const rightPrefix = right.effectivePrefix ?? right.prefix ?? '';
      return (
        rightPrefix.length - leftPrefix.length || left.packageName.localeCompare(right.packageName)
      );
    });

  return candidates[0] ?? null;
}

export function componentWireName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

export function invalidatedBy(
  query: CoreGraph.QueryReadSet,
  input: CoreGraph.KovoExplainInput,
): string[] {
  const invalidators = new Set<string>();

  for (const mutation of input.mutations ?? []) {
    const domains = mutationAffectedDomains(mutation);

    if (query.domains.some((domain) => domains.has(domain))) {
      invalidators.add(mutation.key);
    }
  }

  return [...invalidators].sort();
}

export function domainWritesFor(
  query: CoreGraph.QueryReadSet,
  input: CoreGraph.KovoExplainInput,
): string[] {
  const writes = new Set<string>();

  for (const [writeName, entry] of Object.entries(input.touchGraph ?? {})) {
    if (entry.touches.some((touch) => query.domains.some((domain) => domain === touch.domain))) {
      writes.add(writeName);
    }
  }

  return [...writes].sort();
}

export function queryConsumers(queryName: string, input: CoreGraph.KovoExplainInput): string[] {
  const components =
    input.components
      ?.filter((component) => component.queries?.includes(queryName))
      .map((component) => `component:${component.exportName ?? component.name}`) ?? [];
  const pages =
    input.pages
      ?.filter((page) => page.queries?.includes(queryName))
      .map((page) => `page:${page.route}`) ?? [];

  return [...components, ...pages].sort();
}

export function mutationUpdates(
  mutation: CoreGraph.MutationExplain,
  input: CoreGraph.KovoExplainInput,
): Array<{ consumers: string[]; query: string }> {
  const domains = mutationAffectedDomains(mutation);
  if (domains.size === 0) return [];

  return (input.queries ?? [])
    .filter((query) => query.domains.some((domain) => domains.has(domain)))
    .map((query) => ({
      consumers: queryConsumers(query.query, input),
      query: query.query,
    }))
    .filter((update) => update.consumers.length > 0)
    .sort((left, right) => left.query.localeCompare(right.query));
}

export function listMutationUpdates(
  updates: readonly { consumers: readonly string[]; query: string }[],
): string {
  if (updates.length === 0) return '-';

  return updates.map((update) => `${update.query}->${list(update.consumers)}`).join('; ');
}

export function accessDecisions(input: CoreGraph.KovoExplainInput): CoreGraph.AccessExplainFact[] {
  return [...(input.access ?? [])].sort(compareAccessExplain);
}

export function explicitAccessDecisions(
  input: CoreGraph.KovoCheckInput,
): CoreGraph.AccessExplainFact[] {
  return [...(input.access ?? [])].sort(compareAccessExplain);
}

export function accessLine(access: CoreGraph.AccessExplainFact): string {
  return [
    'ACCESS',
    access.kind.toUpperCase(),
    access.name,
    `decision=${access.decision}`,
    `source=${access.source ?? '-'}`,
    `site=${access.site ?? '-'}`,
    `detail=${stableValue(access.detail)}`,
    `justification=${stableValue(access.justification)}`,
  ].join(' ');
}

export function accessSummary(access: readonly CoreGraph.AccessExplainFact[]): string {
  const counts: Record<CoreGraph.AccessExplainFact['decision'], number> = {
    guard: 0,
    missing: 0,
    public: 0,
    verified: 0,
  };
  for (const fact of access) counts[fact.decision] += 1;

  return [
    'SUMMARY',
    `total=${access.length}`,
    `guard=${counts.guard}`,
    `verified=${counts.verified}`,
    `public=${counts.public}`,
    `missing=${counts.missing}`,
  ].join(' ');
}

export function accessKv436Line(access: CoreGraph.AccessExplainFact): string {
  return [
    'ERROR KV436',
    access.kind.toUpperCase(),
    access.name,
    `site=${access.site ?? '-'}`,
    diagnosticDefinitions.KV436.message,
    access.detail ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function compareAccessExplain(
  left: CoreGraph.AccessExplainFact,
  right: CoreGraph.AccessExplainFact,
): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.name.localeCompare(right.name) ||
    (left.site ?? '').localeCompare(right.site ?? '') ||
    left.decision.localeCompare(right.decision)
  );
}

export function unguardedAccesses(input: CoreGraph.KovoExplainInput): UnguardedAccessFact[] {
  if (input.authPosture !== undefined) {
    const postures = new Map(input.authPosture.map((fact) => [authPostureKey(fact), fact]));
    return accessPostureSurfaces(input)
      .flatMap((surface) => {
        const posture = postures.get(authPostureKey(surface));
        if (posture?.guarded) return [];
        return [
          {
            detail: posture?.detail ?? 'missing auth posture fact',
            kind: surface.kind,
            name: surface.name,
          },
        ];
      })
      .sort(compareUnguardedAccess);
  }

  const guardedAccess = guardedAccessKeys(input.access ?? []);
  return [
    ...(input.endpoints ?? [])
      .filter(
        (endpoint) =>
          !hasNormalizedAccess(guardedAccess, endpointAccessKind(endpoint), endpointName(endpoint)),
      )
      .filter((endpoint) => !hasEndpointAuth(endpoint))
      .map((endpoint) => ({
        detail: [
          `method=${endpoint.method ?? 'ANY'}`,
          `path=${endpoint.path}`,
          `mount=${endpoint.mount ?? 'exact'}`,
          `auth=${endpointAuth(endpoint)}`,
          `csrf=${endpointCsrf(endpoint)}`,
        ].join(' '),
        kind: 'endpoint' as const,
        name: endpointName(endpoint),
      })),
    ...(input.mutations ?? [])
      .filter((mutation) => !hasNormalizedAccess(guardedAccess, 'mutation', mutation.key))
      .filter((mutation) => !hasMutationAuth(mutation))
      .map((mutation) => ({
        detail: [
          `guards=${list(mutation.guards)}`,
          mutation.auth === undefined ? '' : `auth=${mutationAuth(mutation)}`,
          `writes=${list(mutation.writes)}`,
          `invalidates=${list(mutation.invalidates)}`,
          `manual-invalidates=${list(mutation.manualInvalidates)}`,
        ]
          .filter(Boolean)
          .join(' '),
        kind: 'mutation' as const,
        name: mutation.key,
      })),
    ...(input.queries ?? [])
      .filter((query) => !hasNormalizedAccess(guardedAccess, 'query', query.query))
      .filter((query) => query.guards !== undefined && !hasAuthGuard(query.guards))
      .map((query) => ({
        detail: [`guards=${list(query.guards)}`, `reads=${list(query.domains)}`].join(' '),
        kind: 'query' as const,
        name: query.query,
      })),
    ...(input.pages ?? [])
      .filter((page) => !hasNormalizedAccess(guardedAccess, 'page', page.route))
      .filter((page) => page.guards !== undefined && !hasAuthGuard(page.guards))
      .map((page) => ({
        detail: [`guards=${list(page.guards)}`, `queries=${list(page.queries)}`].join(' '),
        kind: 'page' as const,
        name: page.route,
      })),
  ].sort(compareUnguardedAccess);
}

export function accessPostureSurfaces(input: CoreGraph.KovoExplainInput): UnguardedAccessFact[] {
  return [
    ...(input.endpoints ?? []).map((endpoint) => ({
      detail: '',
      kind: endpointAccessKind(endpoint),
      name: endpointName(endpoint),
    })),
    ...(input.mutations ?? []).map((mutation) => ({
      detail: '',
      kind: 'mutation' as const,
      name: mutation.key,
    })),
    ...(input.queries ?? []).map((query) => ({
      detail: '',
      kind: 'query' as const,
      name: query.query,
    })),
    ...(input.pages ?? []).map((page) => ({
      detail: '',
      kind: 'page' as const,
      name: page.route,
    })),
  ];
}

export function authPostureKey(fact: Pick<CoreGraph.AuthPostureFact, 'kind' | 'name'>): string {
  return `${fact.kind}\0${fact.name}`;
}

export function guardedAccessKeys(
  access: readonly CoreGraph.AccessExplainFact[],
): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const fact of access) {
    if (fact.decision === 'missing') continue;
    keys.add(normalizedAccessKey(fact.kind, fact.name));
  }
  return keys;
}

export function hasNormalizedAccess(
  guardedAccess: ReadonlySet<string>,
  kind: CoreGraph.AccessExplainFact['kind'],
  name: string,
): boolean {
  return guardedAccess.has(normalizedAccessKey(kind, name));
}

export function normalizedAccessKey(
  kind: CoreGraph.AccessExplainFact['kind'],
  name: string,
): string {
  return `${kind}\0${name}`;
}

export function unguardedLine(access: UnguardedAccessFact): string {
  return `${access.kind.toUpperCase()} ${access.name} ${access.detail}`;
}

export function endpointExplainLine(
  endpoint: CoreGraph.EndpointExplain,
  graph: CoreGraph.KovoExplainInput,
): string {
  const runMutations = endpoint.runMutations ?? [];
  const fields = [
    `ENDPOINT ${endpointName(endpoint)}`,
    `surface=${endpoint.surface ?? 'endpoint'}`,
    `method=${endpoint.method ?? 'ANY'}`,
    `path=${endpoint.path}`,
    `mount=${endpoint.mount ?? 'exact'}`,
    `auth=${endpointAuth(endpoint)}`,
    `csrf=${endpointCsrf(endpoint)}`,
    `cache=${endpoint.cache ?? '-'}`,
    `body=${endpoint.body ?? '-'}`,
    `bodySize=${endpoint.bodySize ?? '-'}`,
    `rateLimit=${endpoint.rateLimit ?? '-'}`,
    `headers=${list(endpoint.headers)}`,
    `files=${list(endpoint.files)}`,
    `dynamic=${list(endpoint.dynamicExports)}`,
    `writes=${list(endpointWrites(endpoint, graph))}`,
  ];
  if (runMutations.length > 0) fields.push(`runMutations=${list(runMutations)}`);
  return fields.join(' ');
}

export function endpointWrites(
  endpoint: CoreGraph.EndpointExplain,
  graph: CoreGraph.KovoExplainInput,
): readonly string[] | undefined {
  const writes = new Set(endpoint.writes ?? []);
  for (const mutationKey of endpoint.runMutations ?? []) {
    const mutation = (graph.mutations ?? []).find((candidate) => candidate.key === mutationKey);
    for (const domain of mutation?.writes ?? []) writes.add(domain);
  }
  return writes.size === 0 ? undefined : [...writes].sort();
}

export function trustEscapeLine(escape: CoreGraph.TrustEscapeExplain): string {
  return [
    'TRUST',
    `kind=${escape.kind}`,
    `site=${escape.site}`,
    `source=${escape.source ?? '-'}`,
    `owner=${escape.owner ?? '-'}`,
    `safePath=${escape.safePath ?? '-'}`,
    `justification=${stableValue(escape.justification)}`,
  ].join(' ');
}

/**
 * Collect the held dangerous-capability facts for `kovo explain --capabilities` (SPEC §6.6,
 * audit-only). Reads the explicit `graph.capabilities` rows produced by the merged slices AND folds
 * in two capability families already modeled elsewhere in the graph: audit-grade confidentiality
 * reveals (`graph.revealed` with `grade:'audit'`, i.e. `trustedReveal`) and the trustedReveal-class
 * `trustEscapes` — so a reviewer sees the entire capability surface in one table even before every
 * producer writes the unified `capabilities` field.
 */
export function collectCapabilityFacts(
  graph: CoreGraph.KovoExplainInput,
): readonly CoreGraph.CapabilityExplain[] {
  const collected: CoreGraph.CapabilityExplain[] = [...(graph.capabilities ?? [])];

  for (const reveal of graph.revealed ?? []) {
    if (reveal.grade !== 'audit') continue; // proof-grade server projections are not an escape.
    collected.push({
      kind: 'trustedReveal',
      ...(reveal.justification === undefined ? {} : { justification: reveal.justification }),
      target: `${reveal.query}.${reveal.path}`,
      site: reveal.site,
    });
  }

  return collected.sort(compareCapability);
}

export function compareCapability(
  a: CoreGraph.CapabilityExplain,
  b: CoreGraph.CapabilityExplain,
): number {
  return (
    a.kind.localeCompare(b.kind) ||
    a.site.localeCompare(b.site) ||
    (a.moduleSpecifier ?? '').localeCompare(b.moduleSpecifier ?? '') ||
    (a.target ?? '').localeCompare(b.target ?? '')
  );
}

export function capabilityLine(capability: CoreGraph.CapabilityExplain): string {
  return [
    'CAPABILITY',
    `kind=${capability.kind}`,
    `site=${capability.site}`,
    `module=${capability.moduleSpecifier ?? '-'}`,
    `target=${capability.target ?? '-'}`,
    `justification=${stableValue(capability.justification)}`,
  ].join(' ');
}

/** Stable root-to-authority proof rows for `kovo explain --capabilities` (SPEC §6.6). */
export function compareCapabilityClosureFact(
  left: CoreGraph.CapabilityClosureExplainFact,
  right: CoreGraph.CapabilityClosureExplainFact,
): number {
  return capabilityClosureSortKey(left).localeCompare(capabilityClosureSortKey(right));
}

export function capabilityClosureLine(fact: CoreGraph.CapabilityClosureExplainFact): string {
  if (fact.kind === 'root') {
    return [
      'ROOT',
      `kind=${fact.rootKind ?? '-'}`,
      `name=${stableValue(fact.name)}`,
      `module=${fact.module ?? '-'}`,
      `site=${fact.site}`,
    ].join(' ');
  }
  if (fact.kind === 'summary') {
    return [
      'PACKAGE-SUMMARY',
      `package=${fact.packageName ?? '-'}@${fact.packageVersion ?? '-'}`,
      `summary=${fact.summaryVersion ?? '-'}`,
      `status=${fact.status ?? '-'}`,
      `conditions=${list(fact.conditions)}`,
      `fingerprint=${fact.manifestFingerprint ?? '-'}`,
      `site=${fact.site}`,
    ].join(' ');
  }
  return [
    fact.kind === 'door' ? 'DOOR' : 'CLOSED',
    `root=${fact.rootKind ?? '-'}:${stableValue(fact.name)}`,
    `capability=${fact.capability ?? '-'}`,
    `module=${fact.module ?? '-'}`,
    `site=${fact.site}`,
    `path=${stableValue(fact.path?.join(' -> '))}`,
    `reason=${stableValue(fact.reason)}`,
  ].join(' ');
}

function capabilityClosureSortKey(fact: CoreGraph.CapabilityClosureExplainFact): string {
  return [
    fact.kind,
    fact.rootKind ?? '',
    fact.name ?? '',
    fact.module ?? '',
    fact.packageName ?? '',
    fact.packageVersion ?? '',
    fact.summaryVersion ?? '',
    fact.capability ?? '',
    fact.site,
    fact.path?.join('\0') ?? '',
  ].join('\u0001');
}

export function compareCookieDowngrade(
  a: CoreGraph.CookieDowngradeExplain,
  b: CoreGraph.CookieDowngradeExplain,
): number {
  return a.name.localeCompare(b.name) || (a.site ?? '').localeCompare(b.site ?? '');
}

export function cookieDowngradeLine(downgrade: CoreGraph.CookieDowngradeExplain): string {
  const weakened = [
    downgrade.downgrade.httpOnly === false ? 'httpOnly' : undefined,
    downgrade.downgrade.secure === false ? 'secure' : undefined,
    downgrade.downgrade.sameSite ? `sameSite=${downgrade.downgrade.sameSite}` : undefined,
  ].filter((value): value is string => value !== undefined);
  return [
    'COOKIE',
    `name=${downgrade.name}`,
    `class=${downgrade.class}`,
    `site=${downgrade.site ?? '-'}`,
    `downgrade=${weakened.length > 0 ? weakened.join('|') : '-'}`,
    `justification=${stableValue(downgrade.justification)}`,
  ].join(' ');
}

export function documentSourceSinkRows(): readonly DocumentSourceSinkRow[] {
  return frameworkSourceSinkInventory().filter((entry) => entry.sink === 'document.shell.output');
}

export function documentSinkLine(entry: DocumentSourceSinkRow): string {
  return [
    'SINK',
    `source=${entry.source}`,
    `sink=${entry.sink}`,
    `context=${entry.context}`,
    `schema=${entry.schema}`,
    `guard=${entry.guard}`,
    `escapeHatch=${entry.escapeHatch}`,
  ].join(' ');
}

export function documentTrustEscapes(
  escapes: readonly CoreGraph.TrustEscapeExplain[],
): readonly CoreGraph.TrustEscapeExplain[] {
  return escapes
    .filter(
      (escape) =>
        escape.owner?.includes('document') === true ||
        escape.safePath?.includes('Document') === true,
    )
    .sort(compareTrustEscape);
}

export function revealExplainLine(reveal: CoreGraph.RevealExplainFact): string {
  return [
    'REVEAL',
    `grade=${reveal.grade}`,
    `method=${reveal.method}`,
    `query=${reveal.query}`,
    `path=${reveal.path}`,
    `site=${reveal.site}`,
    `source=${reveal.source ?? '-'}`,
    `selectedSecret=${reveal.selectedSecret === true ? 'yes' : 'no'}`,
    `justification=${stableValue(reveal.justification)}`,
  ].join(' ');
}

export function revealSummary(revealed: readonly CoreGraph.RevealExplainFact[]): string {
  const audit = revealed.filter((reveal) => reveal.grade === 'audit').length;
  const proof = revealed.filter((reveal) => reveal.grade === 'proof').length;
  return `SUMMARY total=${revealed.length} proof=${proof} audit=${audit}`;
}

export function unguardedWarningLine(access: UnguardedAccessFact): string {
  if (access.kind === 'endpoint') {
    return `WARN UNGUARDED ${access.name} endpoint is reachable without an auth declaration.`;
  }

  if (access.kind === 'mutation') {
    return `WARN UNGUARDED ${access.name} mutation is reachable without an auth guard.`;
  }

  return `WARN UNGUARDED ${access.kind} ${access.name} is reachable without an auth guard.`;
}

export function compareUnguardedAccess(
  left: UnguardedAccessFact,
  right: UnguardedAccessFact,
): number {
  return left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name);
}

export function hasAuthGuard(guards: readonly string[]): boolean {
  return guards.some((guard) => guard === 'authed' || guard.startsWith('role:'));
}

export function hasMutationAuth(mutation: CoreGraph.MutationExplain): boolean {
  if (hasAuthGuard(mutation.guards ?? [])) return true;
  return mutationAuth(mutation) !== 'none';
}

export function mutationAuth(mutation: CoreGraph.MutationExplain): string {
  return mutation.auth ?? 'none';
}

export function hasEndpointAuth(endpoint: CoreGraph.EndpointExplain): boolean {
  if (hasAuthGuard(endpoint.guards ?? [])) return true;
  if (!endpoint.auth) return false;

  return (
    endpoint.auth === 'authed' ||
    endpoint.auth.startsWith('role:') ||
    endpoint.auth.startsWith('custom:') ||
    endpoint.auth.startsWith('verifier:')
  );
}

export function endpointName(endpoint: CoreGraph.EndpointExplain): string {
  return endpoint.name ?? endpoint.path;
}

export function endpointAccessKind(
  endpoint: CoreGraph.EndpointExplain,
): CoreGraph.AccessExplainFact['kind'] {
  return endpoint.surface === 'webhook' ? 'webhook' : 'endpoint';
}

export function compareEndpointExplain(
  left: CoreGraph.EndpointExplain,
  right: CoreGraph.EndpointExplain,
): number {
  return endpointName(left).localeCompare(endpointName(right));
}

export function compareTrustEscape(
  left: CoreGraph.TrustEscapeExplain,
  right: CoreGraph.TrustEscapeExplain,
): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.site.localeCompare(right.site) ||
    (left.source ?? '').localeCompare(right.source ?? '')
  );
}

export function compareRevealExplain(
  left: CoreGraph.RevealExplainFact,
  right: CoreGraph.RevealExplainFact,
): number {
  return (
    left.query.localeCompare(right.query) ||
    left.path.localeCompare(right.path) ||
    left.site.localeCompare(right.site)
  );
}

export function endpointAuth(endpoint: CoreGraph.EndpointExplain): string {
  if (endpoint.auth === 'none' && endpoint.authJustification) {
    return `none:${endpoint.authJustification}`;
  }
  if (endpoint.auth === undefined && endpoint.access?.kind === 'public') {
    return `public:${endpoint.access.reason}`;
  }
  return endpoint.auth ?? list(endpoint.guards);
}

export function endpointCsrf(endpoint: CoreGraph.EndpointExplain): string {
  const methodPosture = endpointDefaultCsrf(endpoint.method);
  if (methodPosture === 'safe:read-only') return methodPosture;
  if (endpoint.csrf !== 'exempt') return endpoint.csrf ?? methodPosture;
  return `exempt:${endpoint.csrfJustification ?? '-'}`;
}

function endpointDefaultCsrf(method: string | undefined): 'checked' | 'safe:read-only' {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
    ? 'safe:read-only'
    : 'checked';
}

/**
 * SPEC §6.6/§11.4: render a mutation's CSRF posture for the `--endpoints` audit. `checked`
 * (the default) verifies the synchronizer token before the guard chain; `exempt:<justification>`
 * is the `csrf: false` opt-out (KV418 guarantees such a mutation references no ambient session).
 */
export function mutationCsrf(mutation: CoreGraph.MutationExplain): string {
  if (mutation.csrf !== 'exempt') return mutation.csrf ?? 'checked';
  return `exempt:${mutation.csrfJustification ?? '-'}`;
}

/**
 * SPEC §11.4: every `mutation()` appears in the `kovo explain --endpoints` machine-ingress audit
 * alongside endpoints and webhooks, with its CSRF posture and session/guard authority. Mutations
 * dispatch as a single keyed POST (§9.5), so `method` is always POST. `auth` folds the guard chain
 * the same way `endpointAuth` does, and `session` surfaces the ambient-session read that KV418 gates.
 */
export function mutationEndpointExplainLine(mutation: CoreGraph.MutationExplain): string {
  return [
    `MUTATION ${mutation.key}`,
    `method=POST`,
    `auth=${mutation.auth ?? list(mutation.guards)}`,
    `csrf=${mutationCsrf(mutation)}`,
    `session=${mutation.session ?? '-'}`,
    `writes=${list(mutation.writes)}`,
  ].join(' ');
}

export function optimisticSummary(coverages: readonly CoreGraph.OptimisticCoverage[]): string {
  // SPEC.md §10.6: v2 adds `derived` to the status partition. PUNTED is a separate
  // dimension (derivation metadata that never counts as coverage), reported
  // alongside the status counts.
  const counts: Record<CoreGraph.OptimisticCoverage['status'], number> = {
    UNHANDLED: 0,
    'await-fragment': 0,
    derived: 0,
    'hand-written': 0,
  };
  let punted = 0;

  for (const coverage of coverages) {
    counts[coverage.status] += 1;
    if (coverage.derivation?.status === 'PUNTED') punted += 1;
  }

  return [
    'OPTIMISTIC-SUMMARY',
    `total=${coverages.length}`,
    `derived=${counts.derived}`,
    `hand-written=${counts['hand-written']}`,
    `await-fragment=${counts['await-fragment']}`,
    `UNHANDLED=${counts.UNHANDLED}`,
    `PUNTED=${punted}`,
  ].join(' ');
}

export function optimisticProofLine(query: string, proof: DerivationProof): string {
  return [
    'OPTIMISTIC-PROOF',
    query,
    `level=${proof.level}`,
    `private-scope=${list(proof.privateScope)}`,
  ].join(' ');
}

export function optimisticProofCheckLines(
  coverages: readonly CoreGraph.OptimisticCoverage[],
): string[] {
  return [...coverages]
    .sort(compareOptimisticCoverage)
    .map(optimisticProofCheckLine)
    .filter((line): line is string => line !== undefined);
}

export function optimisticProofCheckLine(
  coverage: CoreGraph.OptimisticCoverage,
): string | undefined {
  const derivation = coverage.derivation;
  if (!derivation?.proof && derivation?.status !== 'PUNTED') return undefined;

  return [
    'OPTIMISTIC-PROOF',
    `mutation=${coverage.mutation}`,
    `query=${coverage.query}`,
    `status=${coverage.status}`,
    derivation ? `derivation=${derivation.status}` : '',
    derivation?.proof ? `level=${derivation.proof.level}` : '',
    derivation?.proof ? `private-scope=${list(derivation.proof.privateScope)}` : '',
    derivation?.status === 'PUNTED'
      ? `reason=${JSON.stringify(puntReasonLabel(derivation.reason))}`
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export function compareOptimisticCoverage(
  left: CoreGraph.OptimisticCoverage,
  right: CoreGraph.OptimisticCoverage,
): number {
  return left.mutation.localeCompare(right.mutation) || left.query.localeCompare(right.query);
}

export function optimisticCoverageWarnings(
  components: readonly CoreGraph.ComponentExplain[],
  mutations: readonly CoreGraph.MutationExplain[],
  pages: readonly CoreGraph.PageExplain[],
  queries: readonly CoreGraph.QueryReadSet[],
  coverages: readonly CoreGraph.OptimisticCoverage[],
  touchGraph: CoreGraph.TouchGraph,
  updateCoverage: readonly CoreGraph.UpdateCoverageFact[],
): string[] {
  const clientQueries = optimisticClientQueryConsumers(components, pages, updateCoverage);
  const hasClientConsumerFacts =
    components.length > 0 || pages.length > 0 || updateCoverage.length > 0;
  const covered = new Map(
    coverages
      .filter(
        (coverage) =>
          coverage.status !== 'UNHANDLED' &&
          !optimisticTransformIsDead(coverage, clientQueries, hasClientConsumerFacts),
      )
      .map((coverage) => [`${coverage.mutation}\0${coverage.query}`, coverage.status]),
  );
  const warnings: string[] = [];
  const warned = new Set<string>();

  for (const coverage of coverages) {
    if (
      coverage.status !== 'UNHANDLED' &&
      !optimisticTransformIsDead(coverage, clientQueries, hasClientConsumerFacts)
    ) {
      continue;
    }

    pushOptimisticCoverageWarning(warnings, warned, coverage.mutation, coverage.query);
  }

  for (const mutation of mutations) {
    // SPEC §10.6: KV310 must consult the derived touch graph, not only declared
    // invalidates/writes. A mutation's touch-graph entry (keyed by mutation.key)
    // may expose domains that are absent from the declared invalidates/writes sets.
    const touchEntry = touchGraph[mutation.key];
    const touchDomains = touchEntry
      ? new Set(touchEntry.touches.map((touch) => touch.domain))
      : new Set<string>();
    const domains = new Set([...mutationAffectedDomains(mutation), ...touchDomains]);
    if (domains.size === 0) continue;

    for (const query of queries) {
      if (!query.domains.some((domain) => domains.has(domain))) continue;
      if (covered.has(`${mutation.key}\0${query.query}`)) continue;

      pushOptimisticCoverageWarning(warnings, warned, mutation.key, query.query);
    }
  }

  return warnings;
}

export function pushOptimisticCoverageWarning(
  warnings: string[],
  warned: Set<string>,
  mutation: string,
  query: string,
): void {
  const key = `${mutation}\0${query}`;
  if (warned.has(key)) return;
  warnings.push(optimisticCoverageWarning(mutation, query));
  warned.add(key);
}

export function optimisticClientQueryConsumers(
  components: readonly CoreGraph.ComponentExplain[],
  pages: readonly CoreGraph.PageExplain[],
  updateCoverage: readonly CoreGraph.UpdateCoverageFact[],
): ReadonlySet<string> {
  const clientQueries = new Set([
    ...components.flatMap((component) => component.queries ?? []),
    ...pages.flatMap((page) => page.queries ?? []),
  ]);
  if (updateCoverage.length === 0) {
    const fragmentOnlyComponentQueries = new Set<string>();
    const liveComponentQueries = new Set<string>();

    for (const component of components) {
      const queries = component.queries ?? [];
      if (queries.length === 0) continue;
      if ((component.fragments?.length ?? 0) > 0) {
        for (const query of queries) fragmentOnlyComponentQueries.add(query);
        continue;
      }
      for (const query of queries) liveComponentQueries.add(query);
    }

    for (const query of fragmentOnlyComponentQueries) {
      if (!liveComponentQueries.has(query)) clientQueries.delete(query);
    }

    return clientQueries;
  }

  const statusesByQuery = new Map<string, Set<CoreGraph.UpdateCoverageFact['status']>>();
  for (const fact of updateCoverage) {
    const statuses =
      statusesByQuery.get(fact.query) ?? new Set<CoreGraph.UpdateCoverageFact['status']>();
    statuses.add(fact.status);
    statusesByQuery.set(fact.query, statuses);
  }

  const fragmentOnlyQueries: string[] = [];
  for (const query of clientQueries) {
    const statuses = statusesByQuery.get(query);
    // SPEC §8 and §10.6: a fragment-only query consumer re-renders on the server fragment path,
    // so a hand-written client optimistic transform cannot discharge KV310 for that query.
    if (statuses && [...statuses].every((status) => status === 'fragment')) {
      fragmentOnlyQueries.push(query);
    }
  }
  for (const query of fragmentOnlyQueries) clientQueries.delete(query);

  return clientQueries;
}

export function optimisticTransformIsDead(
  coverage: CoreGraph.OptimisticCoverage,
  clientQueries: ReadonlySet<string>,
  hasClientConsumerFacts: boolean,
): boolean {
  return (
    hasClientConsumerFacts &&
    coverage.status === 'hand-written' &&
    !clientQueries.has(coverage.query)
  );
}

export function optimisticCoverageWarning(mutation: string, query: string): string {
  return `WARN KV310 ${mutation} -> ${query} ${diagnosticDefinitions.KV310.message}`;
}

export function sortedUpdateCoverage(
  coverage: readonly CoreGraph.UpdateCoverageFact[],
): CoreGraph.UpdateCoverageFact[] {
  return [...coverage].sort(compareUpdateCoverage);
}

export function updateCoverageLine(fact: CoreGraph.UpdateCoverageFact): string {
  if (fact.status === 'UNHANDLED') {
    return [
      'WARN KV311',
      `component=${fact.component}`,
      `query=${fact.query}`,
      fact.source ? `source=${fact.source}` : '',
      `position=${JSON.stringify(fact.position)}`,
      diagnosticDefinitions.KV311.message,
      fact.detail ?? '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  return [
    'COVERAGE',
    `component=${fact.component}`,
    `query=${fact.query}`,
    fact.source ? `source=${fact.source}` : '',
    `position=${JSON.stringify(fact.position)}`,
    `status=${fact.status}`,
    fact.detail ? `detail=${JSON.stringify(fact.detail)}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export interface RenderOnceInvalidationConflict {
  fact: CoreGraph.UpdateCoverageFact;
  invalidators: readonly string[];
}

export function renderOnceInvalidationConflicts(
  input: CoreGraph.KovoCheckInput,
): RenderOnceInvalidationConflict[] {
  const queries = input.queries ?? [];
  const conflicts: RenderOnceInvalidationConflict[] = [];

  for (const fact of input.updateCoverage ?? []) {
    if (fact.status !== 'renderOnce' || fact.source === 'state') continue;

    const invalidators = new Set<string>();
    for (const query of matchingQueriesForCoverageFact(fact, queries)) {
      for (const mutation of input.mutations ?? []) {
        const domains = mutationAffectedDomains(mutation);
        if (query.domains.some((domain) => domains.has(domain))) {
          invalidators.add(mutation.key);
        }
      }

      for (const [writeName, entry] of Object.entries(input.touchGraph ?? {})) {
        const domains = new Set(entry.touches.map((touch) => touch.domain));
        if (query.domains.some((domain) => domains.has(domain))) {
          invalidators.add(writeName);
        }
      }
    }

    if (invalidators.size > 0) {
      conflicts.push({ fact, invalidators: [...invalidators].sort() });
    }
  }

  return conflicts.sort((left, right) => compareUpdateCoverage(left.fact, right.fact));
}

export function matchingQueriesForCoverageFact(
  fact: CoreGraph.UpdateCoverageFact,
  queries: readonly CoreGraph.QueryReadSet[],
): CoreGraph.QueryReadSet[] {
  const root = queryRoot(fact.query);
  return queries.filter((query) => query.query === fact.query || query.query === root);
}

export function queryRoot(path: string): string {
  return path.split('.')[0] ?? path;
}

export function renderOnceInvalidationConflictLine(
  conflict: RenderOnceInvalidationConflict,
): string {
  const { fact, invalidators } = conflict;
  return [
    'ERROR KV314',
    `component=${fact.component}`,
    `query=${fact.query}`,
    `position=${JSON.stringify(fact.position)}`,
    `invalidatedBy=${invalidators.join(',')}`,
    diagnosticDefinitions.KV314.message,
  ].join(' ');
}

export function unscopedAccesses(input: CoreGraph.KovoCheckInput): CoreGraph.ScopeAuditFact[] {
  const ownerDomains = new Set((input.ownerDomains ?? []).map((owner) => owner.domain));
  const ownershipPosture = ownershipPostureFacts(input);

  return (
    (input.scopeAudits ?? [])
      .filter((fact) => ownerDomains.has(fact.domain))
      // SPEC §10.3: an owner-table access discharges KV414 when its key predicate is
      // session-traceable (scope 'session') OR an `owns()` ownership guard covers it.
      .filter((fact) => fact.scope !== 'session')
      .filter((fact) => !ownershipPostureCoversFact(ownershipPosture, fact))
      .sort(compareScopeAudit)
  );
}

export function ownershipPostureCoversFact(
  facts: readonly CoreGraph.OwnershipPostureFact[] | undefined,
  fact: CoreGraph.ScopeAuditFact,
): boolean {
  return (facts ?? []).some(
    (posture) =>
      posture.ownerGuarded &&
      posture.kind === fact.kind &&
      posture.name === fact.name &&
      posture.domain === fact.domain &&
      (posture.key ?? '') === (fact.key ?? ''),
  );
}

export function ownershipPostureFacts(
  input: CoreGraph.KovoCheckInput,
): readonly CoreGraph.OwnershipPostureFact[] {
  if (input.ownershipPosture !== undefined) return input.ownershipPosture;
  return deriveOwnershipPostureFacts({
    ...(input.mutations === undefined ? {} : { mutations: input.mutations }),
    ...(input.queries === undefined ? {} : { queries: input.queries }),
  });
}

export function sessionAuthorityFacts(
  input: CoreGraph.KovoCheckInput,
): readonly CoreGraph.SessionAuthorityFact[] {
  if (input.sessionAuthority !== undefined) return input.sessionAuthority;
  return deriveSessionAuthorityFacts({
    ...(input.endpoints === undefined ? {} : { endpoints: input.endpoints }),
    ...(input.mutations === undefined ? {} : { mutations: input.mutations }),
  });
}

export function endpointReferencesSessionAuthority(
  input: CoreGraph.KovoCheckInput,
  endpoint: CoreGraph.EndpointExplain,
): boolean {
  const kind = endpoint.surface === 'webhook' ? 'webhook' : 'endpoint';
  const name = endpointName(endpoint);
  const facts = sessionAuthorityFacts(input).filter(
    (candidate) => candidate.kind === kind && candidate.name === name,
  );
  if (facts.length === 0 && input.sessionAuthority !== undefined) return true;
  return facts.some((fact) => fact.referencesSession);
}

export function mutationReferencesSessionAuthority(
  input: CoreGraph.KovoCheckInput,
  mutation: CoreGraph.MutationExplain,
): boolean {
  const facts = sessionAuthorityFacts(input);
  if (
    facts.some(
      (candidate) =>
        candidate.kind === 'mutation' &&
        candidate.unresolvedName === true &&
        candidate.referencesSession,
    )
  ) {
    return true;
  }
  const matching = facts.filter(
    (candidate) => candidate.kind === 'mutation' && candidate.name === mutation.key,
  );
  if (matching.length === 0 && input.sessionAuthority !== undefined) return true;
  return matching.some((fact) => fact.referencesSession);
}

export function unscopedLine(fact: CoreGraph.ScopeAuditFact): string {
  return [
    'UNSCOPED',
    fact.kind.toUpperCase(),
    fact.name,
    `domain=${fact.domain}`,
    fact.key ? `key=${fact.key}` : '',
    `scope=${fact.scope}`,
    `site=${fact.site}`,
    fact.justification ? `justification=${fact.justification}` : '',
    fact.detail ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The enforced KV414 (IDOR) error line for an unscoped owner-table access (SPEC §10.3). */
export function unscopedKv414Line(fact: CoreGraph.ScopeAuditFact): string {
  return [
    'ERROR KV414',
    fact.kind.toUpperCase(),
    fact.name,
    `domain=${fact.domain}`,
    fact.key ? `key=${fact.key}` : '',
    `scope=${fact.scope}`,
    `site=${fact.site}`,
    diagnosticDefinitions.KV414.message,
    fact.detail ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The enforced KV438 (mass-assignment) error line for an input-reaching governed column write (SPEC §11.1). */
export function massAssignmentKv438Line(fact: CoreGraph.MassAssignmentFact): string {
  return [
    'ERROR KV438',
    'WRITE',
    fact.name,
    `domain=${fact.domain}`,
    `column=${fact.column}`,
    `via=${fact.via}`,
    `provenance=${fact.provenance}`,
    `site=${fact.site}`,
    diagnosticDefinitions.KV438.message,
    fact.detail ? `value=${fact.detail}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The enforced KV429 (lost-update) error line for an unguarded atomic read-then-write (SPEC §10.3). */
export function toctouKv429Line(fact: CoreGraph.ToctouFact): string {
  return [
    'ERROR KV429',
    'WRITE',
    fact.name ?? '<anonymous>',
    `table=${fact.table}`,
    `column=${fact.column}`,
    `site=${fact.site}`,
    diagnosticDefinitions.KV429.message,
  ].join(' ');
}

export function sortedToctou(
  facts: readonly CoreGraph.ToctouFact[],
): readonly CoreGraph.ToctouFact[] {
  return [...facts].sort(
    (left, right) =>
      left.site.localeCompare(right.site) ||
      left.table.localeCompare(right.table) ||
      left.column.localeCompare(right.column),
  );
}

/** The enforced query write-reachability error line for a read-only loader (SPEC §9.4). */
export function queryWriteReachabilityLine(fact: CoreGraph.QueryWriteReachabilityFact): string {
  if (fact.unresolved?.code === 'KV406') return queryWriteReachabilityKv406Line(fact);
  return queryWriteReachabilityKv433Line(fact);
}

export function queryWriteReachabilityForQuery(
  graph: CoreGraph.KovoExplainInput,
  query: string,
): readonly CoreGraph.QueryWriteReachabilityFact[] {
  return sortedQueryWriteReachability(graph.queryWriteReachability ?? []).filter(
    (fact) => fact.query === query,
  );
}

export function queryWriteReachabilityExplainLine(
  fact: CoreGraph.QueryWriteReachabilityFact,
): string {
  return [
    'WRITE-REACH',
    `operation=${fact.operationKind ?? fact.operation}`,
    `operationProvenance=${fact.operationProvenance ?? '-'}`,
    `target=${fact.canonicalTarget?.identity ?? fact.table}`,
    `targetProvenance=${fact.canonicalTarget?.provenance ?? '-'}`,
    `site=${fact.site}`,
    `status=${fact.unresolved ? 'unresolved' : 'resolved'}`,
    `diagnostic=${fact.unresolved?.code ?? 'KV433'}`,
  ].join(' ');
}

/** The enforced KV433 (read-only query) error line for a write-reaching loader (SPEC §9.4). */
export function queryWriteReachabilityKv433Line(
  fact: CoreGraph.QueryWriteReachabilityFact,
): string {
  return [
    'ERROR KV433',
    'QUERY',
    fact.query,
    `operation=${fact.operationKind ?? fact.operation}`,
    `table=${fact.canonicalTarget?.identity ?? fact.table}`,
    `site=${fact.site}`,
    diagnosticDefinitions.KV433.message,
  ].join(' ');
}

/** The enforced KV406 line for an unresolved write-shaped query loader site (SPEC §10.3). */
export function queryWriteReachabilityKv406Line(
  fact: CoreGraph.QueryWriteReachabilityFact,
): string {
  return [
    'ERROR KV406',
    'QUERY',
    fact.query,
    `operation=${fact.operationKind ?? fact.operation}`,
    `table=${fact.canonicalTarget?.identity ?? fact.table}`,
    `site=${fact.site}`,
    diagnosticDefinitions.KV406.message,
  ].join(' ');
}

export function sortedQueryWriteReachability(
  facts: readonly CoreGraph.QueryWriteReachabilityFact[],
): readonly CoreGraph.QueryWriteReachabilityFact[] {
  return [...facts].sort(
    (left, right) =>
      left.query.localeCompare(right.query) ||
      left.site.localeCompare(right.site) ||
      left.operation.localeCompare(right.operation),
  );
}

export function sortedMassAssignment(
  facts: readonly CoreGraph.MassAssignmentFact[],
): readonly CoreGraph.MassAssignmentFact[] {
  return [...facts].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.domain.localeCompare(right.domain) ||
      left.column.localeCompare(right.column) ||
      left.site.localeCompare(right.site) ||
      left.via.localeCompare(right.via),
  );
}

export function compareScopeAudit(
  left: CoreGraph.ScopeAuditFact,
  right: CoreGraph.ScopeAuditFact,
): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.name.localeCompare(right.name) ||
    left.domain.localeCompare(right.domain) ||
    (left.key ?? '').localeCompare(right.key ?? '') ||
    left.site.localeCompare(right.site) ||
    left.scope.localeCompare(right.scope)
  );
}

export function compareUpdateCoverage(
  left: CoreGraph.UpdateCoverageFact,
  right: CoreGraph.UpdateCoverageFact,
): number {
  return (
    left.component.localeCompare(right.component) ||
    left.query.localeCompare(right.query) ||
    (left.source ?? '').localeCompare(right.source ?? '') ||
    left.position.localeCompare(right.position) ||
    left.status.localeCompare(right.status)
  );
}

export function optimisticUnhandledFixLine(): string {
  return "  -> hand-write in the mutation module, or declare 'await-fragment'";
}

export function optimisticCoverageForMutation(
  mutation: CoreGraph.MutationExplain,
  input: CoreGraph.KovoExplainInput,
): CoreGraph.OptimisticCoverage[] {
  const affectedQueries = new Set(
    mutationAffectedQueries(mutation, input).map((query) => query.query),
  );
  const explicit =
    input.optimistic?.filter(
      (item) => item.mutation === mutation.key && affectedQueries.has(item.query),
    ) ?? [];
  const covered = new Set(explicit.map((coverage) => coverage.query));
  const derivedUnhandled = mutationAffectedQueries(mutation, input)
    .filter((query) => !covered.has(query.query))
    .map((query) => ({
      mutation: mutation.key,
      query: query.query,
      status: 'UNHANDLED' as const,
    }))
    .sort((left, right) => left.query.localeCompare(right.query));

  return [...explicit, ...derivedUnhandled];
}

export function mutationAffectedQueries(
  mutation: CoreGraph.MutationExplain,
  input: CoreGraph.KovoExplainInput,
): readonly CoreGraph.QueryReadSet[] {
  const domains = mutationAffectedDomains(mutation);
  if (domains.size === 0) return [];

  return (input.queries ?? []).filter((query) =>
    query.domains.some((domain) => domains.has(domain)),
  );
}

export function mutationAffectedDomains(mutation: CoreGraph.MutationExplain): Set<string> {
  return new Set([
    ...(mutation.writes ?? []),
    ...(mutation.invalidates ?? []),
    ...(mutation.manualInvalidates ?? []),
  ]);
}

export function fixpointFailures(
  checks: readonly CoreGraph.FixpointCheck[],
): CoreGraph.FixpointCheck[] {
  return checks
    .filter((check) => !check.ok)
    .sort((left, right) => left.artifact.localeCompare(right.artifact));
}

export function fixpointFailureLine(check: CoreGraph.FixpointCheck): string {
  const detail = stableText(check.detail ?? 'Generated output must compile to itself.');
  const diff =
    check.expected === undefined && check.actual === undefined
      ? ''
      : ` expected=${stableValue(check.expected)} actual=${stableValue(check.actual)}`;

  return `ERROR FIXPOINT ${check.artifact} ${detail}${diff}`;
}

export function renderEquivalenceFailures(
  checks: readonly CoreGraph.RenderEquivalenceCheck[],
): CoreGraph.RenderEquivalenceCheck[] {
  return checks
    .filter((check) => !check.ok)
    .sort((left, right) => left.artifact.localeCompare(right.artifact));
}

export function renderEquivalenceFailureLine(check: CoreGraph.RenderEquivalenceCheck): string {
  const detail = stableText(
    check.detail ?? 'Authored and lowered render output must match byte-for-byte.',
  );
  const diff =
    check.expected === undefined && check.actual === undefined
      ? ''
      : ` expected=${stableValue(check.expected)} actual=${stableValue(check.actual)}`;

  return `ERROR RENDER_EQUIV ${check.artifact} ${detail}${diff}`;
}

export function stableValue(value: string | undefined): string {
  return value === undefined ? '-' : JSON.stringify(value);
}

export function stableText(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(' ');
}

export function lintMessage(lint: CoreGraph.SemanticLint): string {
  const base = diagnosticDefinitions[lint.code].message;

  return lint.detail ? `${base} ${lint.detail}` : base;
}

export function semanticLintSeverity(lint: CoreGraph.SemanticLint): DiagnosticSeverity {
  return diagnosticDefinitions[lint.code].severity;
}

export function missedQueryInvalidations(
  queries: readonly (
    | CoreGraph.QueryReadSet
    | {
        query: string;
        readOnlyDomains?: readonly string[];
        reads: readonly string[];
      }
  )[],
  touchGraph: CoreGraph.TouchGraph,
  mutations: readonly CoreGraph.MutationExplain[],
): { domain: string; query: string }[] {
  const touchedDomains = new Set(
    Object.values(touchGraph).flatMap((entry) => entry.touches.map((touch) => touch.domain)),
  );
  const mutationDomains = new Set(
    mutations.flatMap((mutation) => [...mutationAffectedDomains(mutation)]),
  );

  return queries.flatMap((query) => {
    const readOnlyDomains = new Set(query.readOnlyDomains ?? []);
    const domains = 'domains' in query ? query.domains : query.reads;
    return domains
      .filter((domain) => !readOnlyDomains.has(domain))
      .filter((domain) => !touchedDomains.has(domain) && !mutationDomains.has(domain))
      .map((domain) => ({ domain, query: query.query }));
  });
}

export function isDeclaredReadOnlyDomain(
  query: CoreGraph.QueryReadSet | undefined,
  domain: string,
) {
  return query?.readOnlyDomains?.includes(domain) === true;
}

/**
 * Direct touch-graph-vs-declared-invalidates superset check (KV402). Fires when a
 * touch-graph entry whose key matches a declared mutation key touches a domain not
 * covered by the mutation's declared writes ∪ invalidates ∪ manualInvalidates.
 * This wires the KV402/KV407 gate to the touch graph end-to-end, bypassing the
 * derivedMutations compile-pipeline path that is currently unpopulated (E3 fix).
 * SPEC §11.1/§11.2.
 */
export function touchGraphMutationSupersetFailures(
  mutations: readonly CoreGraph.MutationExplain[],
  touchGraph: CoreGraph.TouchGraph,
): StaticSupersetFailure[] {
  const declaredByMutation = new Map(
    mutations.map((mutation) => [mutation.key, mutationAffectedDomains(mutation)]),
  );
  const failures: StaticSupersetFailure[] = [];

  for (const [writeName, entry] of Object.entries(touchGraph)) {
    const declaredDomains = declaredByMutation.get(writeName);
    if (declaredDomains === undefined) continue; // not a mutation key entry — skip

    for (const touch of entry.touches) {
      if (!declaredDomains.has(touch.domain)) {
        failures.push({ code: 'KV402', domain: touch.domain, mutation: writeName });
      }
    }
  }

  return failures.sort((left, right) => {
    const leftKey = 'query' in left ? left.query : left.mutation;
    const rightKey = 'query' in right ? right.query : right.mutation;
    return (
      left.code.localeCompare(right.code) ||
      leftKey.localeCompare(rightKey) ||
      left.domain.localeCompare(right.domain)
    );
  });
}

export type StaticSupersetFailure =
  | { code: 'KV402'; domain: string; mutation: string; site?: string }
  | { code: 'KV407'; domain: string; query: string };

export function staticSupersetFailures(input: CoreGraph.KovoCheckInput): StaticSupersetFailure[] {
  return [
    ...staticQueryReadSupersetFailures(input.queries ?? [], input.derivedQueries ?? []),
    ...staticMutationTouchSupersetFailures(input.mutations ?? [], input.derivedMutations ?? []),
  ].sort((left, right) => {
    const leftKey = 'query' in left ? left.query : left.mutation;
    const rightKey = 'query' in right ? right.query : right.mutation;
    return (
      left.code.localeCompare(right.code) ||
      leftKey.localeCompare(rightKey) ||
      left.domain.localeCompare(right.domain)
    );
  });
}

export function staticQueryReadSupersetFailures(
  declaredQueries: readonly CoreGraph.QueryReadSet[],
  derivedQueries: readonly CoreGraph.QueryReadSet[],
): StaticSupersetFailure[] {
  const declaredByQuery = new Map(declaredQueries.map((query) => [query.query, query]));
  const failures: StaticSupersetFailure[] = [];

  for (const derived of derivedQueries) {
    const declared = declaredByQuery.get(derived.query);
    const declaredDomains = new Set(declared?.domains ?? []);
    for (const domain of derived.domains) {
      if (isDeclaredReadOnlyDomain(derived, domain) || isDeclaredReadOnlyDomain(declared, domain)) {
        continue;
      }
      if (!declaredDomains.has(domain)) {
        failures.push({ code: 'KV407', domain, query: derived.query });
      }
    }
  }

  return failures;
}

export function staticMutationTouchSupersetFailures(
  declaredMutations: readonly CoreGraph.MutationExplain[],
  derivedMutations: readonly CoreGraph.DerivedMutationDomainSet[],
): StaticSupersetFailure[] {
  const declaredByMutation = new Map(
    declaredMutations.map((mutation) => [mutation.key, mutationAffectedDomains(mutation)]),
  );
  const failures: StaticSupersetFailure[] = [];

  for (const derived of derivedMutations) {
    const declaredDomains = declaredByMutation.get(derived.mutation) ?? new Set<string>();
    for (const domain of derived.domains) {
      if (!declaredDomains.has(domain)) {
        failures.push({
          code: 'KV402',
          domain,
          mutation: derived.mutation,
          ...(derived.site === undefined ? {} : { site: derived.site }),
        });
      }
    }
  }

  return failures;
}

export function staticSupersetFailureLine(failure: StaticSupersetFailure): string {
  if (failure.code === 'KV407') {
    return `ERROR KV407 ${failure.query} reads ${failure.domain}. ${diagnosticDefinitions.KV407.message} Derived read set is not covered by declared query domains.`;
  }

  const site = failure.site ? `${failure.site} ` : '';
  return `ERROR KV402 ${site}${failure.mutation} touches ${failure.domain}. ${diagnosticDefinitions.KV402.message} Derived touch set is not covered by declared mutation domains.`;
}

export function eventPayloadQueryLints(
  events: readonly CoreGraph.EventPayloadFact[],
  queries: readonly CoreGraph.QueryDataFact[],
): CoreGraph.SemanticLint[] {
  const queryFields = new Map<string, string[]>();

  for (const query of queries) {
    for (const field of query.fields) {
      const existing = queryFields.get(normalizePath(field)) ?? [];
      existing.push(query.query);
      queryFields.set(normalizePath(field), existing);
    }
  }

  return events.flatMap((event) =>
    event.fields.flatMap((field) => {
      const normalizedField = normalizePath(field);
      const queryNames = queryFields.get(normalizedField);
      if (!queryNames) return [];

      return [
        {
          code: 'KV320',
          detail: `event ${event.event} carries ${normalizedField} from query ${[
            ...new Set(queryNames),
          ]
            .sort()
            .join(',')}.`,
          site: event.site,
        },
      ] satisfies CoreGraph.SemanticLint[];
    }),
  );
}

export function normalizePath(path: string): string {
  return path
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('.');
}
