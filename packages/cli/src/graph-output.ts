import type * as CoreGraph from '@kovojs/core/internal/graph';
import { diagnosticDefinitionText } from '@kovojs/core/internal/diagnostics';
import { puntReasonLabel } from '@kovojs/core/internal/derivation';
import { validateKovoExplainInput } from '@kovojs/core/internal/graph';
import { isParanoidSecurityAdvisoryCode } from '@kovojs/core/internal/security-markers';

import type { KovoCheckFamily, KovoExplainOptions } from './graph-args.js';
import {
  accessDecisions,
  accessKv436Line,
  accessLine,
  accessSummary,
  capabilityClosureLine,
  capabilityLine,
  collectCapabilityFacts,
  compareCapabilityClosureFact,
  compareCookieDowngrade,
  compareEndpointExplain,
  compareRevealExplain,
  compareTrustEscape,
  componentPrefixProvenance,
  cookieDowngradeLine,
  diagnosticSeverity,
  diagnosticsForTouchGraph,
  domainWritesFor,
  documentSinkLine,
  documentSourceSinkRows,
  documentTrustEscapes,
  endpointExplainLine,
  endpointMetadataDiagnostics,
  endpointMetadataKv423Line,
  endpointName,
  endpointPostureVerificationLines,
  endpointReferencesSessionAuthority,
  eventPayloadQueryLints,
  explicitAccessDecisions,
  fixpointFailureLine,
  fixpointFailures,
  findComponentExplain,
  handlerWriteSinkCheckLines,
  handlerWriteSinkExplainLine,
  hasStaticHandlerWriteSinkDiagnostic,
  invalidatedBy,
  lintMessage,
  list,
  listMutationUpdates,
  massAssignmentKv438Line,
  missedQueryInvalidations,
  missingEndpointPostureLines,
  mutationEndpointExplainLine,
  mutationReferencesSessionAuthority,
  mutationUpdates,
  notFound,
  optimisticCoverageForMutation,
  optimisticCoverageWarnings,
  optimisticProofCheckLines,
  optimisticProofLine,
  optimisticSummary,
  optimisticUnhandledFixLine,
  queryWriteReachabilityExplainLine,
  queryWriteReachabilityForQuery,
  queryWriteReachabilityLine,
  queryConsumers,
  renderEquivalenceFailureLine,
  renderEquivalenceFailures,
  renderOnceInvalidationConflictLine,
  renderOnceInvalidationConflicts,
  revealExplainLine,
  revealSummary,
  semanticLintSeverity,
  sortedHandlerWriteSinks,
  sortedMassAssignment,
  sortedQueryWriteReachability,
  sortedTasks,
  sortedToctou,
  sortedUpdateCoverage,
  sqlSafetyDiagnostics,
  sqlSafetyFactsForTarget,
  sqlSafetyKv422Line,
  sqlSafetyLine,
  staticDiagnosticLine,
  staticSupersetFailureLine,
  staticSupersetFailures,
  taskSummaryLine,
  toctouKv429Line,
  touchGraphMutationSupersetFailures,
  trustEscapeLine,
  unguardedAccesses,
  unguardedLine,
  unguardedWarningLine,
  unregisteredSinkLine,
  unscopedAccesses,
  unscopedKv414Line,
  unscopedLine,
  updateCoverageLine,
  verificationCoverageGapLine,
  verificationDiagnosticLine,
} from './graph-explain-format.js';
export type {
  ExplainKind,
  KovoAccessExplainOptions,
  KovoDocumentExplainOptions,
  KovoEndpointExplainOptions,
  KovoExplainOptions,
  KovoRevealedExplainOptions,
  KovoSourcesSinksExplainOptions,
  KovoTargetExplainOptions,
  KovoTasksExplainOptions,
  KovoUnguardedExplainOptions,
  KovoUnscopedExplainOptions,
  KovoCheckFamily,
} from './graph-args.js';
export {
  checkFamilyArg,
  isExplainKind,
  parseAuditArgs,
  parseCheckArgs,
  parseExplainArgs,
  writeCheckUsageError,
} from './graph-args.js';
export { inputErrorMessage, readGraphInput, runGraphCommand } from './graph-input.js';
import type { KovoCheckResult } from './shared.js';
import { sourcesSinksCheckResult, sourcesSinksExplainResult } from './sources-sinks.js';
import {
  graphVerifierSecurityFailure,
  snapshotGraphVerifierInvocation,
} from './graph-security-boundary.js';

export const outputVersion = 'kovo-check/v1';
export const explainOutputVersion = 'kovo-explain/v1';
export const auditOutputVersion = 'kovo-audit/v1';

/**
 * Opaque graph input accepted by `kovoCheck`.
 *
 * Kovo validates this value at runtime before reading graph fields, so the
 * public CLI facade does not expose the internal verifier graph declarations
 * (SPEC.md §11.4; rules/api-surface.md recursive publicness).
 */
export type KovoCheckInput = unknown;

/**
 * Opaque graph input accepted by `kovoExplain`.
 *
 * Kovo validates this value at runtime before reading graph fields, so the
 * public CLI facade does not expose the internal verifier graph declarations
 * (SPEC.md §11.4; rules/api-surface.md recursive publicness).
 */
export type KovoExplainInput = unknown;

/**
 * Run the `kovo explain` verifier in-process against an extracted graph.
 *
 * Prints the stable `kovo-explain/v1` graph view selected by `options`: a single
 * component, mutation, query, or page subject; the `--endpoints` machine-ingress
 * audit; or an access audit (SPEC.md §5.3 and §11.4).
 * The printed format is stable so agents and graph queries can answer intent-level
 * questions over it (SPEC.md §1.1 proof claims). Returns the text plus an exit
 * code that is non-zero only when an audit ran with `failOnFindings` and findings
 * were present.
 */
export function kovoExplain(input: KovoExplainInput, options: KovoExplainOptions): KovoCheckResult {
  const invocation = snapshotGraphVerifierInvocation(input, options);
  if (!invocation.ok) return graphVerifierSecurityFailure(explainOutputVersion);
  input = invocation.input;
  options = invocation.options;
  const validationErrors = validateKovoExplainInput(input);
  if (validationErrors.length > 0)
    return invalidGraphInputResult(explainOutputVersion, validationErrors);

  const graph = input as CoreGraph.KovoExplainInput;
  const lines = [explainOutputVersion];

  if ('access' in options) {
    const access = accessDecisions(graph);
    const missing = access.filter((fact) => fact.decision === 'missing').length;
    lines.push('ACCESS');

    for (const fact of access) {
      lines.push(accessLine(fact));
    }

    lines.push(accessSummary(access));
    return explainAuditResult(lines, missing, options.failOnFindings);
  }

  if ('unscoped' in options) {
    const findings = unscopedAccesses(graph);
    lines.push('UNSCOPED');

    for (const finding of findings) {
      lines.push(unscopedLine(finding));
    }

    lines.push(`SUMMARY total=${findings.length}`);
    return explainAuditResult(lines, findings.length, options.failOnFindings);
  }

  if ('unguarded' in options) {
    const accesses = unguardedAccesses(graph);
    lines.push('UNGUARDED');

    for (const access of accesses) {
      lines.push(unguardedLine(access));
    }

    lines.push(`SUMMARY total=${accesses.length}`);
    return explainAuditResult(lines, accesses.length, options.failOnFindings);
  }

  if ('endpoints' in options) {
    // SPEC §11.4: the machine-ingress audit lists every endpoint and webhook PLUS every
    // mutation(), each with its CSRF posture, so review can answer "what can reach this app, and
    // what can it touch?" without executing a browser. A `csrf: false` mutation appears with
    // posture `exempt:<justification>`; KV418 (§6.6) guarantees it references no ambient session.
    const endpoints = [...(graph.endpoints ?? [])].sort(compareEndpointExplain);
    const mutations = [...(graph.mutations ?? [])].sort((left, right) =>
      left.key.localeCompare(right.key),
    );
    const writeSinks = sortedHandlerWriteSinks(graph.handlerWriteSinks ?? []);
    lines.push('ENDPOINTS');

    for (const endpoint of endpoints) {
      lines.push(endpointExplainLine(endpoint, graph));
    }
    for (const mutation of mutations) {
      lines.push(mutationEndpointExplainLine(mutation));
    }
    for (const sink of writeSinks) {
      lines.push(handlerWriteSinkExplainLine(sink));
    }

    lines.push(
      [
        `SUMMARY total=${endpoints.length + mutations.length}`,
        writeSinks.length > 0 ? `writeSinks=${writeSinks.length}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
    return ok(lines);
  }

  if ('document' in options) {
    const sinks = documentSourceSinkRows();
    const escapes = documentTrustEscapes(graph.trustEscapes ?? []);
    lines.push('DOCUMENT');

    for (const sink of sinks) {
      lines.push(documentSinkLine(sink));
    }
    for (const escape of escapes) {
      lines.push(trustEscapeLine(escape));
    }

    lines.push(`SUMMARY sinks=${sinks.length} trustEscapes=${escapes.length}`);
    return ok(lines);
  }

  if ('revealed' in options) {
    const revealed = [...(graph.revealed ?? [])].sort(compareRevealExplain);
    lines.push('REVEALED');

    for (const reveal of revealed) {
      lines.push(revealExplainLine(reveal));
    }

    lines.push(revealSummary(revealed));
    return ok(lines);
  }

  if ('sourcesSinks' in options) return sourcesSinksExplainResult(explainOutputVersion);

  if ('tasks' in options) {
    const tasks = sortedTasks(graph.tasks ?? []);
    lines.push('TASKS');

    for (const task of tasks) {
      lines.push(taskSummaryLine(task));
    }

    lines.push(`SUMMARY total=${tasks.length}`);
    return ok(lines);
  }

  if ('trust' in options) {
    const escapes = [...(graph.trustEscapes ?? [])].sort(compareTrustEscape);
    lines.push('TRUST');

    for (const escape of escapes) {
      lines.push(trustEscapeLine(escape));
    }

    lines.push(`SUMMARY total=${escapes.length}`);
    return ok(lines);
  }

  if ('capabilities' in options) {
    // SPEC §6.6 (audit-only): a diffable table of every HELD dangerous capability collected from the
    // merged slices — publishToClient secret-emit escapes (KV437), egress `allowInternal` private-
    // network entries, confidentiality `trustedReveal`s, and serverValue/unsafeCookie/accept.unverified
    // escapes, each with its recorded justification. Surfacing informs review; it enforces nothing.
    const capabilities = collectCapabilityFacts(graph);
    lines.push('CAPABILITIES');

    for (const capability of capabilities) {
      lines.push(capabilityLine(capability));
    }

    const closure = [...(graph.capabilityClosure ?? [])].sort(compareCapabilityClosureFact);
    if (closure.length > 0) {
      lines.push('CAPABILITY-CLOSURE');
      for (const fact of closure) lines.push(capabilityClosureLine(fact));
      lines.push(
        [
          'CLOSURE-SUMMARY',
          `roots=${closure.filter((fact) => fact.kind === 'root').length}`,
          `doors=${closure.filter((fact) => fact.kind === 'door').length}`,
          `packages=${closure.filter((fact) => fact.kind === 'summary').length}`,
          `closed=${closure.filter((fact) => fact.kind === 'closed').length}`,
        ].join(' '),
      );
    }

    lines.push(`SUMMARY total=${capabilities.length}`);
    return ok(lines);
  }

  if ('cookies' in options) {
    // SPEC §6.6/§9.1 (audit-only): every recorded insecure cookie downgrade (drained from
    // `drainCookieDowngradeFacts` at the serializeCookie sink and carried into the graph), with the
    // justification a reviewer needs to sign off on the weakened credential-cookie floor.
    const downgrades = [...(graph.cookieDowngrades ?? [])].sort(compareCookieDowngrade);
    lines.push('COOKIES');

    for (const downgrade of downgrades) {
      lines.push(cookieDowngradeLine(downgrade));
    }

    lines.push(`SUMMARY total=${downgrades.length}`);
    return ok(lines);
  }

  if (options.kind === 'context') {
    const provider = graph.requestProviders?.find((item) => item.kind === options.target);
    if (!provider) return notFound(options);

    lines.push(`CONTEXT ${provider.kind}`);
    lines.push(`fields: ${list(provider.fields)}`);
    lines.push(`consumers: ${list(provider.consumers)}`);
    lines.push(`source: ${provider.source ?? '-'}`);
    return ok(lines);
  }

  if (options.kind === 'component') {
    const component = findComponentExplain(graph.components, options.target);
    if (!component) return notFound(options);
    const provenance = componentPrefixProvenance(component, options.target, graph);

    lines.push(`COMPONENT ${component.name}`);
    if (provenance) lines.push(provenance);
    lines.push(`queries: ${list(component.queries)}`);
    lines.push(`fragments: ${list(component.fragments)}`);
    if (component.domName) lines.push(`dom-name: ${component.domName}`);
    if (component.disambiguatedDomName) {
      lines.push(`effective-dom-name: ${component.disambiguatedDomName}`);
    }

    for (const rule of component.styleRules ?? []) {
      lines.push(
        [
          'STYLE',
          `class=${rule.className}`,
          `source=${rule.source}`,
          `style-ref=${rule.styleRef}`,
        ].join(' '),
      );
    }

    for (const clock of component.clocks ?? []) {
      lines.push(`CLOCK ${clock.name} cadence=${clock.cadence}`);
    }

    for (const handler of component.handlers ?? []) {
      lines.push(
        [
          `HANDLER ${handler.event}`,
          `export=${handler.exportName}`,
          `ref=${handler.ref}`,
          `captures=${list(handler.captures)}`,
          `params=${list(handler.params)}`,
          `substitution=${handler.substitution ?? '-'}`,
        ].join(' '),
      );
    }

    for (const operation of component.securityOperations ?? []) {
      lines.push(
        [
          `OPERATION ${operation.kind}`,
          `door=${operation.door}`,
          `target=${operation.target ?? '-'}`,
          `justification=${operation.justification ?? '-'}`,
        ].join(' '),
      );
    }

    for (const substitution of component.platformSubstitutions ?? []) {
      lines.push(
        [
          `SUBSTITUTION ${substitution.kind}`,
          `tag=${substitution.tag}`,
          `event=${substitution.event}`,
          `target=${substitution.target}`,
          `action=${substitution.action}`,
        ].join(' '),
      );
    }

    for (const derive of component.derives ?? []) {
      lines.push(
        [
          `DERIVE ${derive.name}`,
          `inputs=${list(derive.inputs)}`,
          `ref=${derive.ref}`,
          `target=${derive.target}`,
        ].join(' '),
      );
    }

    for (const trigger of component.triggers ?? []) {
      lines.push(
        [
          `TRIGGER ${trigger.trigger}`,
          `export=${trigger.exportName}`,
          `ref=${trigger.ref}`,
          `deps=${list(trigger.deps)}`,
          `justification=${trigger.justification ?? '-'}`,
        ].join(' '),
      );
    }

    for (const merge of component.attributeMerges ?? []) {
      lines.push(
        [
          `MERGE ${merge.element}`,
          `attr=${merge.attr}`,
          `rule=${merge.rule}`,
          `decision=${merge.decision}`,
          `diagnostics=${list(merge.diagnostics)}`,
        ].join(' '),
      );
    }

    for (const form of component.mutationForms ?? []) {
      lines.push(
        [
          `FORM ${form.slot}`,
          `mutation=${form.mutation}`,
          `fields=${list(form.fields)}`,
          `field-errors=${list(form.fieldErrors?.map((field) => `${field.name}:${field.id ?? '-'}`))}`,
          `form-errors=${list(form.formErrors?.map((error) => error.code ?? '-'))}`,
        ].join(' '),
      );
    }

    return ok(lines);
  }

  if (options.kind === 'mutation') {
    const mutation = graph.mutations?.find((item) => item.key === options.target);
    if (!mutation) return notFound(options);

    lines.push(`MUTATION ${mutation.key}`);
    lines.push(`guards: ${list(mutation.guards)}`);
    if (mutation.auth) lines.push(`auth: ${mutation.auth}`);
    if (mutation.session) lines.push(`session: ${mutation.session}`);
    if (mutation.enctype) lines.push(`enctype: ${mutation.enctype}`);
    if (mutation.inputFields) lines.push(`input-fields: ${list(mutation.inputFields)}`);
    if (mutation.fileFields) lines.push(`file-fields: ${list(mutation.fileFields)}`);
    lines.push(`writes: ${list(mutation.writes)}`);
    lines.push(`invalidates: ${list(mutation.invalidates)}`);
    lines.push(`manual-invalidates: ${list(mutation.manualInvalidates)}`);
    lines.push(`updates: ${listMutationUpdates(mutationUpdates(mutation, graph))}`);
    for (const fact of sqlSafetyFactsForTarget(graph, 'mutation', mutation.key)) {
      lines.push(sqlSafetyLine(fact));
    }

    if (options.optimistic) {
      const coverages = optimisticCoverageForMutation(mutation, graph);

      for (const coverage of coverages) {
        // SPEC.md §10.5/§10.6: report transform coverage (status, incl. `derived`)
        // plus the derivation trace. A PUNTED derivation is metadata, not coverage,
        // so it renders as a separate OPTIMISTIC-PUNT line with its named reason and
        // the pair keeps its real status (UNHANDLED still shows the fix line).
        lines.push(`OPTIMISTIC ${coverage.query} ${coverage.status}`);
        if (coverage.derivation?.proof) {
          lines.push(optimisticProofLine(coverage.query, coverage.derivation.proof));
        }
        if (coverage.derivation?.status === 'PUNTED') {
          // Field form (`<key>: <value>`) so the named reason's own colons stay in
          // the value; the key carries the query.
          lines.push(
            `OPTIMISTIC-PUNT ${coverage.query}: ${puntReasonLabel(coverage.derivation.reason)}`,
          );
        }
        if (coverage.status === 'UNHANDLED') {
          lines.push(optimisticUnhandledFixLine());
        }
      }

      lines.push(optimisticSummary(coverages));
    }

    return ok(lines);
  }

  if (options.kind === 'task') {
    const task = graph.tasks?.find((item) => item.key === options.target);
    if (!task) return notFound(options);

    lines.push(`TASK ${task.key}`);
    lines.push(`cron: ${task.cron ?? '-'}`);
    lines.push(`run-mutations: ${list(task.runMutations)}`);
    lines.push(`run-queries: ${list(task.runQueries)}`);
    lines.push(`schedules: ${list(task.schedules)}`);
    return ok(lines);
  }

  if (options.kind === 'query') {
    const query = graph.queries?.find((item) => item.query === options.target);
    if (!query) return notFound(options);

    lines.push(`QUERY ${query.query}`);
    lines.push(`reads: ${list(query.domains)}`);
    lines.push(`consumers: ${list(queryConsumers(query.query, graph))}`);
    lines.push(`invalidated-by: ${list(invalidatedBy(query, graph))}`);
    lines.push(`domain-writes: ${list(domainWritesFor(query, graph))}`);
    for (const fact of queryWriteReachabilityForQuery(graph, query.query)) {
      lines.push(queryWriteReachabilityExplainLine(fact));
    }
    for (const fact of sqlSafetyFactsForTarget(graph, 'query', query.query)) {
      lines.push(sqlSafetyLine(fact));
    }
    return ok(lines);
  }

  const page = graph.pages?.find((item) => item.route === options.target);
  if (!page) return notFound(options);

  lines.push(`PAGE ${page.route}`);
  lines.push(`prefetch: ${page.prefetch ?? false}`);
  if (page.meta) {
    lines.push(
      [
        'meta:',
        `title=${page.meta.title ?? '-'}`,
        `description=${page.meta.description ?? '-'}`,
        `image=${page.meta.image ?? '-'}`,
      ].join(' '),
    );
  }
  if (page.i18n) lines.push(`i18n: ${list(page.i18n)}`);
  lines.push(`modulepreloads: ${list(page.modulepreloads)}`);
  lines.push(`stylesheets: ${list(page.stylesheets)}`);
  lines.push(`queries: ${list(page.queries)}`);
  if (options.layouts) {
    lines.push(`layouts: ${list(page.layouts?.map((layout) => layout.name))}`);
    for (const layout of page.layouts ?? []) {
      lines.push(`layout: ${layout.name} queries=${list(layout.queries)}`);
    }
    lines.push(
      `navigation-segments: ${list(page.navigationSegments?.map((segment) => segment.id))}`,
    );
    for (const segment of page.navigationSegments ?? []) {
      lines.push(
        [
          `segment: ${segment.kind}`,
          `id=${segment.id}`,
          `name=${segment.name}`,
          `queries=${list(segment.queries)}`,
          `components=${list(segment.components)}`,
        ].join(' '),
      );
    }
  }
  lines.push(`view-transitions: ${list(page.viewTransitions)}`);
  return ok(lines);
}

/** @internal Options for the internal `kovo audit` command; not a public API. */
export interface KovoAuditOptions {
  failOnFindings?: boolean;
}

/** @internal Backs the internal `kovo audit` command; not a public API. */
export function kovoAudit(
  input: CoreGraph.KovoExplainInput,
  options: KovoAuditOptions = {},
): KovoCheckResult {
  const invocation = snapshotGraphVerifierInvocation(input, options);
  if (!invocation.ok) return graphVerifierSecurityFailure(auditOutputVersion);
  input = invocation.input;
  options = invocation.options;
  const validationErrors = validateKovoExplainInput(input);
  if (validationErrors.length > 0)
    return invalidGraphInputResult(auditOutputVersion, validationErrors);

  const unguarded = unguardedAccesses(input);
  const manualInvalidates = (input.mutations ?? []).filter(
    (mutation) => (mutation.manualInvalidates?.length ?? 0) > 0,
  );
  const lines = [auditOutputVersion];

  if (unguarded.length > 0) {
    lines.push('UNGUARDED');

    for (const access of unguarded) {
      lines.push(unguardedLine(access));
    }
  }

  if (manualInvalidates.length > 0) {
    lines.push('MANUAL-INVALIDATES');

    for (const mutation of manualInvalidates) {
      lines.push(`MUTATION ${mutation.key} domains=${list(mutation.manualInvalidates)}`);
    }
  }

  if (lines.length === 1) {
    lines.push('OK');
  } else {
    lines.push(
      `SUMMARY unguarded=${unguarded.length} manual-invalidates=${manualInvalidates.length}`,
    );
  }

  const findingCount = unguarded.length + manualInvalidates.length;
  return {
    exitCode: options.failOnFindings && findingCount > 0 ? 1 : 0,
    output: `${lines.join('\n')}\n`,
  };
}

/**
 * Run the `kovo check` verifier in-process against an extracted graph.
 *
 * Reports the consistency and exhaustiveness findings of SPEC.md §11.4: touch-graph
 * diagnostics, optimistic exhaustiveness (KV310), update coverage (KV311), fixpoint
 * and render-equivalence invariants, and the unguarded/unscoped audits. The
 * optional `family` selects the `optimistic`, `coverage`, `endpoint-posture`,
 * or `sources-sinks` slice (default `all`).
 * Returns the stable `kovo-check/v1` text plus an exit code that is non-zero when
 * any error-severity finding is present (SPEC.md §1.1 proof claims).
 */
export function kovoCheck(
  input: KovoCheckInput,
  options: { family?: KovoCheckFamily; paranoidStaticAdvisory?: boolean } = {},
): KovoCheckResult {
  const invocation = snapshotGraphVerifierInvocation(input, options);
  if (!invocation.ok) return graphVerifierSecurityFailure(outputVersion);
  input = invocation.input;
  options = invocation.options;
  if (options.family === 'sources-sinks') return sourcesSinksCheckResult(outputVersion);

  const validationErrors = validateKovoExplainInput(input);
  if (validationErrors.length > 0) return invalidGraphInputResult(outputVersion, validationErrors);

  const graph = input as CoreGraph.KovoCheckInput;
  const lines = [outputVersion];
  const family = options.family ?? 'all';
  const includeAll = family === 'all';
  let failed = false;
  const staticFindingFails = (code: string): boolean =>
    !(options.paranoidStaticAdvisory === true && isParanoidSecurityAdvisoryCode(code));

  const pushFinding = (line: string, fail = false): void => {
    lines.push(line);
    failed ||= fail;
  };

  if (includeAll) {
    const diagnostics = diagnosticsForTouchGraph(graph.touchGraph ?? {});

    for (const diagnostic of diagnostics) {
      pushFinding(
        `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.site} ${diagnostic.message}`,
        diagnostic.severity === 'error',
      );
    }

    for (const diagnostic of graph.diagnostics ?? []) {
      pushFinding(
        staticDiagnosticLine(diagnostic),
        diagnosticSeverity(diagnostic) === 'error' && staticFindingFails(diagnostic.code),
      );
    }

    // SPEC §10.2/§11.2: KV422 SQL-injection findings from the static analyzer
    // (analyzeSqlSafetyFromProject, @kovojs/drizzle/internal/static) gate `kovo check`. The analysis
    // is by-construction over AST symbol-identity provenance (§6.6); an error-severity finding here
    // means unproven/request-derived data could reach executable SQL text on a managed DB handle, so
    // the check fails (nonzero exit). The diagnostics ride into the check graph as a
    // `sqlSafetyDiagnostics` field assembled by the compile/build pipeline.
    for (const diagnostic of sqlSafetyDiagnostics(graph)) {
      pushFinding(
        sqlSafetyKv422Line(diagnostic),
        diagnosticSeverity(diagnostic) === 'error' && staticFindingFails(diagnostic.code),
      );
    }

    for (const diagnostic of graph.verificationDiagnostics ?? []) {
      pushFinding(
        verificationDiagnosticLine(diagnostic),
        diagnosticSeverity(diagnostic) === 'error',
      );
    }

    if (!hasStaticHandlerWriteSinkDiagnostic(graph.diagnostics ?? [])) {
      for (const line of handlerWriteSinkCheckLines(graph.handlerWriteSinks ?? [])) {
        pushFinding(line, !line.startsWith('ERROR KV406 ') || staticFindingFails('KV406'));
      }
    }

    for (const sink of graph.unregisteredSinks ?? []) {
      pushFinding(unregisteredSinkLine(sink), true);
    }

    for (const diagnostic of endpointMetadataDiagnostics(graph.endpoints ?? [])) {
      pushFinding(endpointMetadataKv423Line(diagnostic), true);
    }

    for (const coverage of graph.verificationCoverage ?? []) {
      if (!coverage.observed) pushFinding(verificationCoverageGapLine(coverage), true);
    }
  }

  if (includeAll || family === 'endpoint-posture') {
    for (const fact of graph.endpointPosture ?? []) {
      for (const line of endpointPostureVerificationLines(fact)) {
        pushFinding(line, line.startsWith('ERROR '));
      }
    }
    if (family === 'endpoint-posture') {
      for (const line of missingEndpointPostureLines(
        graph.endpoints ?? [],
        graph.endpointPosture ?? [],
      )) {
        pushFinding(line, true);
      }
    }
  }

  if (includeAll || family === 'optimistic') {
    if (family === 'optimistic') {
      for (const line of optimisticProofCheckLines(graph.optimistic ?? [])) {
        pushFinding(line);
      }
    }

    for (const warning of optimisticCoverageWarnings(
      graph.components ?? [],
      graph.mutations ?? [],
      graph.pages ?? [],
      graph.queries ?? [],
      graph.optimistic ?? [],
      graph.touchGraph ?? {},
      graph.updateCoverage ?? [],
    )) {
      pushFinding(warning, true);
    }
  }

  if (includeAll || family === 'coverage') {
    for (const conflict of renderOnceInvalidationConflicts(graph)) {
      pushFinding(renderOnceInvalidationConflictLine(conflict), true);
    }

    for (const fact of sortedUpdateCoverage(graph.updateCoverage ?? [])) {
      pushFinding(updateCoverageLine(fact), fact.status === 'UNHANDLED');
    }
  }

  if (includeAll) {
    for (const access of explicitAccessDecisions(graph).filter(
      (fact) => fact.decision === 'missing',
    )) {
      pushFinding(accessKv436Line(access), true);
    }

    for (const finding of unscopedAccesses(graph)) {
      // SPEC §10.3: a recorded public-read justification suppresses the enforced
      // KV414 (the access is still surfaced by `kovo explain --unscoped`).
      if (finding.justification) continue;
      pushFinding(unscopedKv414Line(finding), true);
    }

    // SPEC §11.1 / secure-framework Phase 3: a write reaching a governed column with
    // request-input (or fail-closed unprovable) provenance is the blocking KV438
    // mass-assignment error. serverValue/trustedAssign discharges never reach here.
    for (const finding of sortedMassAssignment(graph.massAssignmentFacts ?? [])) {
      pushFinding(massAssignmentKv438Line(finding), staticFindingFails('KV438'));
    }

    // SPEC §6.6/§9.4 / secure-framework Phase 5: query write-reachability facts are the
    // canonical Drizzle-produced surface. Resolved direct writes are KV433; unresolved
    // write-shaped loader sites fail closed as KV406 instead of disappearing.
    for (const finding of sortedQueryWriteReachability(graph.queryWriteReachability ?? [])) {
      pushFinding(
        queryWriteReachabilityLine(finding),
        finding.unresolved?.code === 'KV406' ? staticFindingFails('KV406') : true,
      );
    }

    // SPEC §10.3/§11.1 / secure-framework Phase 6: a single-row self-referential write to a
    // declared atomic column without a CAS/version guard is the blocking KV429 lost-update.
    for (const finding of sortedToctou(graph.toctouFacts ?? [])) {
      pushFinding(toctouKv429Line(finding), true);
    }

    for (const lint of graph.lints ?? []) {
      const severity = semanticLintSeverity(lint);
      pushFinding(
        `${severity.toUpperCase()} ${lint.code} ${lint.site} ${lintMessage(lint)}`,
        severity === 'error',
      );
    }

    for (const lint of eventPayloadQueryLints(graph.eventPayloads ?? [], graph.queryData ?? [])) {
      const severity = semanticLintSeverity(lint);
      pushFinding(
        `${severity.toUpperCase()} ${lint.code} ${lint.site} ${lintMessage(lint)}`,
        severity === 'error',
      );
    }

    for (const failure of fixpointFailures(graph.fixpointChecks ?? [])) {
      pushFinding(fixpointFailureLine(failure), true);
    }

    for (const failure of renderEquivalenceFailures(graph.renderEquivalenceChecks ?? [])) {
      pushFinding(renderEquivalenceFailureLine(failure), true);
    }

    for (const missed of staticSupersetFailures(graph)) {
      pushFinding(staticSupersetFailureLine(missed), true);
    }

    // SPEC §11.1/§11.2: KV402 derived-superset cross-check wired to the touch graph.
    // staticSupersetFailures consumes derivedMutations which the compile pipeline may not
    // populate; this direct check fires KV402 whenever the touch graph entry for a mutation
    // key touches a domain that is absent from the mutation's declared domain set (E3 fix).
    for (const failure of touchGraphMutationSupersetFailures(
      graph.mutations ?? [],
      graph.touchGraph ?? {},
    )) {
      pushFinding(staticSupersetFailureLine(failure), true);
    }

    for (const missed of missedQueryInvalidations(
      graph.queries ?? [],
      graph.touchGraph ?? {},
      graph.mutations ?? [],
    )) {
      const message = diagnosticDefinitionText('KV407', { includeHelp: true });
      pushFinding(`ERROR KV407 ${missed.query} reads ${missed.domain}. ${message}`, true);
    }

    for (const access of unguardedAccesses(graph)) {
      pushFinding(unguardedWarningLine(access));
    }

    for (const endpoint of graph.endpoints ?? []) {
      if (endpoint.csrf === 'exempt' && !endpoint.csrfJustification) {
        pushFinding(
          `WARN ENDPOINT ${endpointName(endpoint)} csrf exemption requires a named justification.`,
        );
      }
      // SPEC §9.1: KV418 — a csrf-exempt endpoint must not depend on the session (auth:'authed'
      // or a session/cookie-derived guard: authed, role(), owns()); CSRF protection is what makes
      // session auth safe, so a session-dependent endpoint that opts out of it is a contradiction.
      // A signature/verifier-authed webhook (auth:'verifier:*') is the legitimate exempt pattern.
      if (endpoint.csrf === 'exempt' && endpointReferencesSessionAuthority(graph, endpoint)) {
        const message = diagnosticDefinitionText('KV418', { includeHelp: true });
        pushFinding(
          `ERROR KV418 ENDPOINT ${endpointName(endpoint)} csrf-exempt endpoint runs a session-derived guard. ${message}`,
          true,
        );
      }
    }

    for (const mutation of graph.mutations ?? []) {
      if (mutation.csrf === 'exempt' && !mutation.csrfJustification) {
        pushFinding(`WARN MUTATION ${mutation.key} csrf exemption requires a named justification.`);
      }
      // SPEC §6.6/§9.1: KV418 — a `csrf: false` mutation MUST NOT reference ambient browser
      // authority. It skips the synchronizer-token check yet still rides the victim's ambient
      // cookie, so reading `req.session` (surfaced as `mutation.session`) or running a
      // session/cookie-derived guard (authed, role(), owns()) is the unsound exemption §9.1
      // forbids. The exemption is sound only by construction: a `csrf: false` mutation is served
      // with no ambient session (cookies uninterpreted). Truly non-browser writes belong in
      // endpoint()/webhook(). Fails closed — any session-authority signal raises KV418.
      if (mutation.csrf === 'exempt' && mutationReferencesSessionAuthority(graph, mutation)) {
        const message = diagnosticDefinitionText('KV418', { includeHelp: true });
        pushFinding(
          `ERROR KV418 MUTATION ${mutation.key} csrf-exempt mutation references ambient session authority. ${message}`,
          true,
        );
      }
      for (const domain of mutation.manualInvalidates ?? []) {
        pushFinding(
          `WARN INVALIDATE ${mutation.key} -> ${domain} Manual invalidate escape hatch requires review.`,
        );
      }
    }
  }

  if (lines.length === 1) {
    lines.push('OK');
  }

  return {
    exitCode: failed ? 1 : 0,
    output: `${lines.join('\n')}\n`,
  };
}

function invalidGraphInputResult(
  version: string,
  errors: readonly CoreGraph.GraphInputValidationError[],
): KovoCheckResult {
  const lines = [version, ...errors.map((error) => `ERROR INPUT ${error.path} ${error.message}`)];
  return {
    exitCode: 1,
    output: `${lines.join('\n')}\n`,
  };
}

function ok(lines: string[]): KovoCheckResult {
  return {
    exitCode: 0,
    output: `${lines.join('\n')}\n`,
  };
}

function explainAuditResult(
  lines: string[],
  findingCount: number,
  failOnFindings = false,
): KovoCheckResult {
  return {
    exitCode: failOnFindings && findingCount > 0 ? 1 : 0,
    output: `${lines.join('\n')}\n`,
  };
}
