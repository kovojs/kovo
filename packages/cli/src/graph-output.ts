import { readFileSync } from 'node:fs';

import type { DiagnosticCode, DiagnosticSeverity } from '@kovojs/core';
import {
  diagnosticDefinitionText,
  diagnosticDefinitions,
} from '@kovojs/core/internal/diagnostics';
import { puntReasonLabel } from '@kovojs/core/internal/derivation';
import type * as CoreGraph from '@kovojs/core/internal/graph';
import { validateKovoExplainInput } from '@kovojs/core/internal/graph';

import { AUDIT_USAGE, CHECK_USAGE, EXPLAIN_USAGE_LINE } from './commands-manifest.js';
import { type CliCommandResult, type KovoCheckResult } from './shared.js';

interface TouchGraphDiagnosticFact {
  code: DiagnosticCode;
  message: string;
  severity: DiagnosticSeverity;
  site: string;
}

interface UnguardedAccessFact {
  detail: string;
  kind: 'endpoint' | 'mutation' | 'page' | 'query';
  name: string;
}

export type KovoCheckFamily = 'all' | 'coverage' | 'optimistic';

export const outputVersion = 'kovo-check/v1';
export const explainOutputVersion = 'kovo-explain/v1';
export const auditOutputVersion = 'kovo-audit/v1';

export function runGraphCommand(
  inputPath: string | undefined,
  run: (input: CoreGraph.KovoExplainInput) => KovoCheckResult,
): CliCommandResult {
  const input = readGraphInput(inputPath);
  if (!input.ok) return { error: inputErrorMessage(input.error), exitCode: 1 };
  return run(input.value);
}

interface InputReadError {
  expected?: 'array' | 'object';
  field?: string;
  kind:
    | 'invalid-field-shape'
    | 'invalid-json'
    | 'invalid-shape'
    | 'invalid-value'
    | 'not-found'
    | 'read-error';
  message?: string;
  path: string;
}

type InputReadResult =
  | { ok: true; value: CoreGraph.KovoExplainInput }
  | { error: InputReadError; ok: false };

export function readGraphInput(path: string | undefined): InputReadResult {
  if (!path) return { ok: true, value: {} };

  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch (error) {
    return {
      error: { kind: isNodeErrorCode(error, 'ENOENT') ? 'not-found' : 'read-error', path },
      ok: false,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { error: { kind: 'invalid-json', path }, ok: false };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: { kind: 'invalid-shape', path }, ok: false };
  }

  const validationErrors = validateKovoExplainInput(parsed);
  if (validationErrors.length > 0) {
    const validationError = validationErrors[0];
    if (validationError) {
      return { error: graphInputValidationReadError(validationError, path), ok: false };
    }
  }

  return { ok: true, value: parsed as CoreGraph.KovoExplainInput };
}

export function inputErrorMessage(error: InputReadError): string {
  const messages: Record<InputReadError['kind'], string> = {
    'invalid-field-shape': `kovo: input JSON field ${error.field ?? '-'} must be an ${error.expected ?? 'object'}: ${error.path}`,
    'invalid-json': `kovo: input file is not valid JSON: ${error.path}`,
    'invalid-shape': `kovo: input JSON must be an object: ${error.path}`,
    'invalid-value': `kovo: input JSON invalid: ${error.path}: ${error.field ?? '$'} ${error.message ?? 'is invalid'}`,
    'not-found': `kovo: input file not found: ${error.path}`,
    'read-error': `kovo: unable to read input file: ${error.path}`,
  };
  return messages[error.kind];
}

function writeUsageError(message: string): 1 {
  process.stderr.write(`${message}\n`);
  return 1;
}

function graphInputValidationReadError(
  error: CoreGraph.GraphInputValidationError,
  path: string,
): InputReadError {
  const arrayShape = /^([A-Za-z]+) must be an array$/.exec(error.message);
  const arrayField = arrayShape?.[1];
  if (arrayField) {
    return { expected: 'array', field: arrayField, kind: 'invalid-field-shape', path };
  }
  if (error.message === 'touchGraph must be an object') {
    return { expected: 'object', field: 'touchGraph', kind: 'invalid-field-shape', path };
  }
  if (error.path === '$') return { kind: 'invalid-shape', path };

  return { field: error.path, kind: 'invalid-value', message: error.message, path };
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

/**
 * The kind of graph subject a targeted `kovo explain` describes — a component,
 * request context, mutation, query, or page (SPEC.md §5.3).
 */
export type ExplainKind = 'component' | 'context' | 'mutation' | 'page' | 'query';

/**
 * Options selecting which `kovo explain` view `kovoExplain` produces: a targeted
 * component/mutation/query/page subject, the `--endpoints` machine-ingress audit,
 * or the `--unguarded`/`--unscoped` access audits (SPEC.md §5.3 and §11.4).
 */
export type KovoExplainOptions =
  | KovoEndpointExplainOptions
  | KovoTargetExplainOptions
  | KovoUnguardedExplainOptions
  | KovoUnscopedExplainOptions;

/**
 * `kovo explain --endpoints` options: emit the stable machine-ingress audit table
 * of every declared endpoint, webhook, and file/stream route (SPEC.md §11.4).
 */
export interface KovoEndpointExplainOptions {
  endpoints: true;
}

/**
 * Targeted `kovo explain` options: describe one graph subject of the given `kind`
 * and `target`, optionally including optimistic transform coverage for mutations
 * (SPEC.md §5.3).
 */
export interface KovoTargetExplainOptions {
  kind: ExplainKind;
  layouts?: boolean;
  optimistic?: boolean;
  target: string;
}

/**
 * `kovo explain --unguarded` options: audit every mutation, route, and query
 * reachable without an `authed` guard, optionally failing when findings exist
 * (SPEC.md §11.4).
 */
export interface KovoUnguardedExplainOptions {
  failOnFindings?: boolean;
  unguarded: true;
}

/**
 * `kovo explain --unscoped` options: audit every query or write touching an
 * owner-annotated domain without an owner scope, optionally failing when findings
 * exist (SPEC.md §11.4).
 */
export interface KovoUnscopedExplainOptions {
  failOnFindings?: boolean;
  unscoped: true;
}

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
 * audit; or the `--unguarded`/`--unscoped` access audits (SPEC.md §5.3 and §11.4).
 * The printed format is stable so agents and graph queries can answer intent-level
 * questions over it (SPEC.md §1.1 proof claims). Returns the text plus an exit
 * code that is non-zero only when an audit ran with `failOnFindings` and findings
 * were present.
 */
export function kovoExplain(input: KovoExplainInput, options: KovoExplainOptions): KovoCheckResult {
  const validationErrors = validateKovoExplainInput(input);
  if (validationErrors.length > 0)
    return invalidGraphInputResult(explainOutputVersion, validationErrors);

  const graph = input as CoreGraph.KovoExplainInput;
  const lines = [explainOutputVersion];

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
    const endpoints = [...(graph.endpoints ?? [])].sort(compareEndpointExplain);
    lines.push('ENDPOINTS');

    for (const endpoint of endpoints) {
      lines.push(endpointExplainLine(endpoint));
    }

    lines.push(`SUMMARY total=${endpoints.length}`);
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

    if (options.optimistic) {
      const coverages = optimisticCoverageForMutation(mutation, graph);

      for (const coverage of coverages) {
        // SPEC.md §10.5/§10.6: report transform coverage (status, incl. `derived`)
        // plus the derivation trace. A PUNTED derivation is metadata, not coverage,
        // so it renders as a separate OPTIMISTIC-PUNT line with its named reason and
        // the pair keeps its real status (UNHANDLED still shows the fix line).
        lines.push(`OPTIMISTIC ${coverage.query} ${coverage.status}`);
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

  if (options.kind === 'query') {
    const query = graph.queries?.find((item) => item.query === options.target);
    if (!query) return notFound(options);

    lines.push(`QUERY ${query.query}`);
    lines.push(`reads: ${list(query.domains)}`);
    lines.push(`consumers: ${list(queryConsumers(query.query, graph))}`);
    lines.push(`invalidated-by: ${list(invalidatedBy(query, graph))}`);
    lines.push(`domain-writes: ${list(domainWritesFor(query, graph))}`);
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
 * optional `family` selects the `optimistic` or `coverage` slice (default `all`).
 * Returns the stable `kovo-check/v1` text plus an exit code that is non-zero when
 * any error-severity finding is present (SPEC.md §1.1 proof claims).
 */
export function kovoCheck(
  input: KovoCheckInput,
  options: { family?: 'all' | 'coverage' | 'optimistic' } = {},
): KovoCheckResult {
  const validationErrors = validateKovoExplainInput(input);
  if (validationErrors.length > 0) return invalidGraphInputResult(outputVersion, validationErrors);

  const graph = input as CoreGraph.KovoCheckInput;
  const lines = [outputVersion];
  const family = options.family ?? 'all';
  const includeAll = family === 'all';
  let failed = false;

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
      pushFinding(staticDiagnosticLine(diagnostic), diagnosticSeverity(diagnostic) === 'error');
    }

    for (const diagnostic of graph.verificationDiagnostics ?? []) {
      pushFinding(
        verificationDiagnosticLine(diagnostic),
        diagnosticSeverity(diagnostic) === 'error',
      );
    }

    for (const coverage of graph.verificationCoverage ?? []) {
      if (!coverage.observed) pushFinding(verificationCoverageGapLine(coverage), true);
    }
  }

  if (includeAll || family === 'optimistic') {
    for (const warning of optimisticCoverageWarnings(
      graph.mutations ?? [],
      graph.queries ?? [],
      graph.optimistic ?? [],
      graph.touchGraph ?? {},
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
    for (const finding of unscopedAccesses(graph)) {
      // SPEC §10.3: a recorded public-read justification suppresses the enforced
      // KV414 (the access is still surfaced by `kovo explain --unscoped`).
      if (finding.justification) continue;
      pushFinding(unscopedKv414Line(finding), true);
    }

    for (const lint of graph.lints ?? []) {
      pushFinding(`LINT ${lint.code} ${lint.site} ${lintMessage(lint)}`);
    }

    for (const lint of eventPayloadQueryLints(graph.eventPayloads ?? [], graph.queryData ?? [])) {
      pushFinding(`LINT ${lint.code} ${lint.site} ${lintMessage(lint)}`);
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
      if (
        endpoint.csrf === 'exempt' &&
        (endpoint.auth === 'authed' ||
          (endpoint.guards ?? []).some(
            (guard) => guard === 'authed' || guard.startsWith('role:') || isOwnsGuard(guard),
          ))
      ) {
        const message = diagnosticDefinitionText('KV418', { includeHelp: true });
        pushFinding(
          `ERROR KV418 ENDPOINT ${endpointName(endpoint)} csrf-exempt endpoint runs a session-derived guard. ${message}`,
          true,
        );
      }
    }

    for (const mutation of graph.mutations ?? []) {
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

function diagnosticSeverity(
  diagnostic: Pick<CoreGraph.StaticDiagnosticFact, 'code' | 'severity'>,
): DiagnosticSeverity {
  return diagnostic.severity ?? diagnosticDefinitions[diagnostic.code].severity;
}

export function checkFamilyArg(value: string | undefined): KovoCheckFamily {
  return value === 'optimistic' || value === 'coverage' ? value : 'all';
}

type CheckArgParseResult =
  | { family: KovoCheckFamily; inputPath: string | undefined; ok: true }
  | { family: string | undefined; kind: 'too-many-args' | 'unsupported-family'; ok: false };

export function parseCheckArgs(args: readonly string[]): CheckArgParseResult {
  const family = checkFamilyArg(args[0]);
  if (family !== 'all') {
    if (args.length > 2) return { family: args[0], kind: 'too-many-args', ok: false };
    return { family, inputPath: args[1], ok: true };
  }
  if (args.length > 1) return { family: args[0], kind: 'unsupported-family', ok: false };
  return { family, inputPath: args[0], ok: true };
}

export function writeCheckUsageError(error: Extract<CheckArgParseResult, { ok: false }>): number {
  const message =
    error.kind === 'unsupported-family'
      ? `kovo: unsupported check family ${stableValue(error.family)}. expected optimistic or coverage.\n`
      : `kovo: ${CHECK_USAGE}\n`;
  process.stderr.write(message);
  return 1;
}

type AuditArgParseResult =
  | { failOnFindings: boolean; inputPath: string | undefined; ok: true }
  | { message: string; ok: false };

export function parseAuditArgs(args: readonly string[]): AuditArgParseResult {
  const parsed = parseFlaggedArgs(args, ['--fail-on-findings']);
  if (!parsed.ok) return parsed;
  if (parsed.positional.length > 1) {
    return { message: `kovo: ${AUDIT_USAGE}`, ok: false };
  }

  return {
    failOnFindings: parsed.flags.has('--fail-on-findings'),
    inputPath: parsed.positional[0],
    ok: true,
  };
}

type ExplainArgParseResult =
  | { inputPath: string | undefined; ok: true; options: KovoExplainOptions }
  | { message: string; ok: false };

export function parseExplainArgs(args: readonly string[]): ExplainArgParseResult {
  const parsed = parseFlaggedArgs(args, [
    '--endpoints',
    '--fail-on-findings',
    '--layouts',
    '--optimistic',
    '--unguarded',
    '--unscoped',
  ]);
  if (!parsed.ok) return parsed;

  const { flags, positional } = parsed;
  const modeFlags = ['--endpoints', '--unguarded', '--unscoped'].filter((flag) => flags.has(flag));
  if (modeFlags.length > 1) return explainUsage();

  if (flags.has('--endpoints')) {
    if (
      flags.has('--fail-on-findings') ||
      flags.has('--layouts') ||
      flags.has('--optimistic') ||
      positional.length > 1
    ) {
      return explainUsage();
    }
    return { inputPath: positional[0], ok: true, options: { endpoints: true } };
  }

  if (flags.has('--unguarded') || flags.has('--unscoped')) {
    if (flags.has('--layouts') || flags.has('--optimistic') || positional.length > 1) {
      return explainUsage();
    }
    const options = flags.has('--unguarded')
      ? ({ failOnFindings: flags.has('--fail-on-findings'), unguarded: true } as const)
      : ({ failOnFindings: flags.has('--fail-on-findings'), unscoped: true } as const);
    return { inputPath: positional[0], ok: true, options };
  }

  if (flags.has('--fail-on-findings')) return explainUsage();

  const [kind, target, inputPath, extra] = positional;
  if (!isExplainKind(kind) || !target || extra) return explainUsage();
  if (flags.has('--layouts') && kind !== 'page') return explainUsage();
  if (flags.has('--optimistic') && kind !== 'mutation') return explainUsage();

  return {
    inputPath,
    ok: true,
    options: {
      kind,
      layouts: flags.has('--layouts'),
      optimistic: flags.has('--optimistic'),
      target,
    },
  };
}

function explainUsage(): ExplainArgParseResult {
  return {
    message: `kovo: usage: ${EXPLAIN_USAGE_LINE}`,
    ok: false,
  };
}

type FlagParseResult =
  | { flags: Set<string>; ok: true; positional: string[] }
  | { message: string; ok: false };

function parseFlaggedArgs(
  args: readonly string[],
  allowedFlags: readonly string[],
): FlagParseResult {
  const allowed = new Set(allowedFlags);
  const flags = new Set<string>();
  const positional: string[] = [];

  for (const arg of args) {
    if (arg.startsWith('--')) {
      if (!allowed.has(arg))
        return { message: `kovo: unknown flag ${stableValue(arg)}`, ok: false };
      flags.add(arg);
    } else {
      positional.push(arg);
    }
  }

  return { flags, ok: true, positional };
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

function diagnosticsForTouchGraph(graph: CoreGraph.TouchGraph): TouchGraphDiagnosticFact[] {
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

function verificationDiagnosticLine(diagnostic: CoreGraph.VerificationDiagnosticFact): string {
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

function verificationCoverageGapLine(coverage: CoreGraph.VerificationCoverageFact): string {
  const site = coverage.site ? `${coverage.site} ` : '';
  return `ERROR VERIFY ${site}${coverage.kind} ${coverage.key} has no verifier coverage.`;
}

function staticDiagnosticLine(diagnostic: CoreGraph.StaticDiagnosticFact): string {
  const definition = diagnosticDefinitions[diagnostic.code];
  const severity = diagnostic.severity ?? definition.severity;
  return `${severity.toUpperCase()} ${diagnostic.code} ${diagnosticSite(diagnostic)} ${diagnostic.message ?? definition.message}`;
}

function diagnosticSite(diagnostic: CoreGraph.StaticDiagnosticFact): string {
  return diagnostic.start
    ? `${diagnostic.site}:${diagnostic.start.line}:${diagnostic.start.column}`
    : diagnostic.site;
}

function notFound(options: KovoTargetExplainOptions): KovoCheckResult {
  return {
    exitCode: 1,
    output: `${explainOutputVersion}\nERROR NOT_FOUND ${options.kind} ${options.target}\n`,
  };
}

function list(values: readonly string[] | undefined): string {
  return values && values.length > 0 ? values.join(',') : '-';
}

function findComponentExplain(
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

function componentPrefixProvenance(
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

function packagePrefixOwner(
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

function componentWireName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();
}

export function isExplainKind(value: string | undefined): value is ExplainKind {
  return (
    value === 'component' ||
    value === 'context' ||
    value === 'mutation' ||
    value === 'page' ||
    value === 'query'
  );
}

function invalidatedBy(query: CoreGraph.QueryReadSet, input: CoreGraph.KovoExplainInput): string[] {
  const invalidators = new Set<string>();

  for (const mutation of input.mutations ?? []) {
    const domains = mutationAffectedDomains(mutation);

    if (query.domains.some((domain) => domains.has(domain))) {
      invalidators.add(mutation.key);
    }
  }

  return [...invalidators].sort();
}

function domainWritesFor(
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

function queryConsumers(queryName: string, input: CoreGraph.KovoExplainInput): string[] {
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

function mutationUpdates(
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

function listMutationUpdates(
  updates: readonly { consumers: readonly string[]; query: string }[],
): string {
  if (updates.length === 0) return '-';

  return updates.map((update) => `${update.query}->${list(update.consumers)}`).join('; ');
}

function unguardedAccesses(input: CoreGraph.KovoExplainInput): UnguardedAccessFact[] {
  return [
    ...(input.endpoints ?? [])
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
      .filter((query) => query.guards !== undefined && !hasAuthGuard(query.guards))
      .map((query) => ({
        detail: [`guards=${list(query.guards)}`, `reads=${list(query.domains)}`].join(' '),
        kind: 'query' as const,
        name: query.query,
      })),
    ...(input.pages ?? [])
      .filter((page) => page.guards !== undefined && !hasAuthGuard(page.guards))
      .map((page) => ({
        detail: [`guards=${list(page.guards)}`, `queries=${list(page.queries)}`].join(' '),
        kind: 'page' as const,
        name: page.route,
      })),
  ].sort(compareUnguardedAccess);
}

function unguardedLine(access: UnguardedAccessFact): string {
  return `${access.kind.toUpperCase()} ${access.name} ${access.detail}`;
}

function endpointExplainLine(endpoint: CoreGraph.EndpointExplain): string {
  return [
    `ENDPOINT ${endpointName(endpoint)}`,
    `method=${endpoint.method ?? 'ANY'}`,
    `path=${endpoint.path}`,
    `mount=${endpoint.mount ?? 'exact'}`,
    `auth=${endpointAuth(endpoint)}`,
    `csrf=${endpointCsrf(endpoint)}`,
    `writes=${list(endpoint.writes)}`,
  ].join(' ');
}

function unguardedWarningLine(access: UnguardedAccessFact): string {
  if (access.kind === 'endpoint') {
    return `WARN UNGUARDED ${access.name} endpoint is reachable without an auth declaration.`;
  }

  if (access.kind === 'mutation') {
    return `WARN UNGUARDED ${access.name} mutation is reachable without an auth guard.`;
  }

  return `WARN UNGUARDED ${access.kind} ${access.name} is reachable without an auth guard.`;
}

function compareUnguardedAccess(left: UnguardedAccessFact, right: UnguardedAccessFact): number {
  return left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name);
}

function hasAuthGuard(guards: readonly string[]): boolean {
  return guards.some((guard) => guard === 'authed' || guard.startsWith('role:'));
}

function hasMutationAuth(mutation: CoreGraph.MutationExplain): boolean {
  if (hasAuthGuard(mutation.guards ?? [])) return true;
  return mutationAuth(mutation) !== 'none';
}

function mutationAuth(mutation: CoreGraph.MutationExplain): string {
  return mutation.auth ?? 'none';
}

function hasEndpointAuth(endpoint: CoreGraph.EndpointExplain): boolean {
  if (hasAuthGuard(endpoint.guards ?? [])) return true;
  if (!endpoint.auth) return false;

  return (
    endpoint.auth === 'authed' ||
    endpoint.auth.startsWith('role:') ||
    endpoint.auth.startsWith('custom:') ||
    endpoint.auth.startsWith('verifier:')
  );
}

function endpointName(endpoint: CoreGraph.EndpointExplain): string {
  return endpoint.name ?? endpoint.path;
}

function compareEndpointExplain(
  left: CoreGraph.EndpointExplain,
  right: CoreGraph.EndpointExplain,
): number {
  return endpointName(left).localeCompare(endpointName(right));
}

function endpointAuth(endpoint: CoreGraph.EndpointExplain): string {
  return endpoint.auth ?? list(endpoint.guards);
}

function endpointCsrf(endpoint: CoreGraph.EndpointExplain): string {
  if (endpoint.csrf !== 'exempt') return endpoint.csrf ?? 'checked';
  return `exempt:${endpoint.csrfJustification ?? '-'}`;
}

function optimisticSummary(coverages: readonly CoreGraph.OptimisticCoverage[]): string {
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

function optimisticCoverageWarnings(
  mutations: readonly CoreGraph.MutationExplain[],
  queries: readonly CoreGraph.QueryReadSet[],
  coverages: readonly CoreGraph.OptimisticCoverage[],
  touchGraph: CoreGraph.TouchGraph,
): string[] {
  const covered = new Map(
    coverages.map((coverage) => [`${coverage.mutation}\0${coverage.query}`, coverage.status]),
  );
  const warnings: string[] = [];

  for (const coverage of coverages) {
    if (coverage.status !== 'UNHANDLED') continue;

    warnings.push(optimisticCoverageWarning(coverage.mutation, coverage.query));
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

      warnings.push(optimisticCoverageWarning(mutation.key, query.query));
    }
  }

  return warnings;
}

function optimisticCoverageWarning(mutation: string, query: string): string {
  return `WARN KV310 ${mutation} -> ${query} ${diagnosticDefinitions.KV310.message}`;
}

function sortedUpdateCoverage(
  coverage: readonly CoreGraph.UpdateCoverageFact[],
): CoreGraph.UpdateCoverageFact[] {
  return [...coverage].sort(compareUpdateCoverage);
}

function updateCoverageLine(fact: CoreGraph.UpdateCoverageFact): string {
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

interface RenderOnceInvalidationConflict {
  fact: CoreGraph.UpdateCoverageFact;
  invalidators: readonly string[];
}

function renderOnceInvalidationConflicts(
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

function matchingQueriesForCoverageFact(
  fact: CoreGraph.UpdateCoverageFact,
  queries: readonly CoreGraph.QueryReadSet[],
): CoreGraph.QueryReadSet[] {
  const root = queryRoot(fact.query);
  return queries.filter((query) => query.query === fact.query || query.query === root);
}

function queryRoot(path: string): string {
  return path.split('.')[0] ?? path;
}

function renderOnceInvalidationConflictLine(conflict: RenderOnceInvalidationConflict): string {
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

function unscopedAccesses(input: CoreGraph.KovoCheckInput): CoreGraph.ScopeAuditFact[] {
  const ownerDomains = new Set((input.ownerDomains ?? []).map((owner) => owner.domain));
  const ownsGuarded = ownsGuardedNames(input);

  return (
    (input.scopeAudits ?? [])
      .filter((fact) => ownerDomains.has(fact.domain))
      // SPEC §10.3: an owner-table access discharges KV414 when its key predicate is
      // session-traceable (scope 'session') OR an `owns()` ownership guard covers it.
      .filter((fact) => fact.scope !== 'session')
      .filter((fact) => !ownsGuarded.has(fact.name))
      .sort(compareScopeAudit)
  );
}

/** Query/mutation names whose guard chain includes an `owns()` ownership guard (SPEC §10.3). */
function ownsGuardedNames(input: CoreGraph.KovoCheckInput): Set<string> {
  const names = new Set<string>();
  for (const query of input.queries ?? []) {
    if ((query.guards ?? []).some(isOwnsGuard)) names.add(query.query);
  }
  for (const mutation of input.mutations ?? []) {
    if ((mutation.guards ?? []).some(isOwnsGuard)) names.add(mutation.key);
  }
  return names;
}

function isOwnsGuard(guard: string): boolean {
  return guard === 'owns' || guard.startsWith('owns(') || guard.startsWith('owns:');
}

function unscopedLine(fact: CoreGraph.ScopeAuditFact): string {
  return [
    'UNSCOPED',
    fact.kind.toUpperCase(),
    fact.name,
    `domain=${fact.domain}`,
    `scope=${fact.scope}`,
    `site=${fact.site}`,
    fact.justification ? `justification=${fact.justification}` : '',
    fact.detail ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The enforced KV414 (IDOR) error line for an unscoped owner-table access (SPEC §10.3). */
function unscopedKv414Line(fact: CoreGraph.ScopeAuditFact): string {
  return [
    'ERROR KV414',
    fact.kind.toUpperCase(),
    fact.name,
    `domain=${fact.domain}`,
    `scope=${fact.scope}`,
    `site=${fact.site}`,
    diagnosticDefinitions.KV414.message,
    fact.detail ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

function compareScopeAudit(
  left: CoreGraph.ScopeAuditFact,
  right: CoreGraph.ScopeAuditFact,
): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.name.localeCompare(right.name) ||
    left.domain.localeCompare(right.domain) ||
    left.site.localeCompare(right.site) ||
    left.scope.localeCompare(right.scope)
  );
}

function compareUpdateCoverage(
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

function optimisticUnhandledFixLine(): string {
  return "  -> hand-write in the mutation module, or declare 'await-fragment'";
}

function optimisticCoverageForMutation(
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

function mutationAffectedQueries(
  mutation: CoreGraph.MutationExplain,
  input: CoreGraph.KovoExplainInput,
): readonly CoreGraph.QueryReadSet[] {
  const domains = mutationAffectedDomains(mutation);
  if (domains.size === 0) return [];

  return (input.queries ?? []).filter((query) =>
    query.domains.some((domain) => domains.has(domain)),
  );
}

function mutationAffectedDomains(mutation: CoreGraph.MutationExplain): Set<string> {
  return new Set([
    ...(mutation.writes ?? []),
    ...(mutation.invalidates ?? []),
    ...(mutation.manualInvalidates ?? []),
  ]);
}

function fixpointFailures(checks: readonly CoreGraph.FixpointCheck[]): CoreGraph.FixpointCheck[] {
  return checks
    .filter((check) => !check.ok)
    .sort((left, right) => left.artifact.localeCompare(right.artifact));
}

function fixpointFailureLine(check: CoreGraph.FixpointCheck): string {
  const detail = stableText(check.detail ?? 'Generated output must compile to itself.');
  const diff =
    check.expected === undefined && check.actual === undefined
      ? ''
      : ` expected=${stableValue(check.expected)} actual=${stableValue(check.actual)}`;

  return `ERROR FIXPOINT ${check.artifact} ${detail}${diff}`;
}

function renderEquivalenceFailures(
  checks: readonly CoreGraph.RenderEquivalenceCheck[],
): CoreGraph.RenderEquivalenceCheck[] {
  return checks
    .filter((check) => !check.ok)
    .sort((left, right) => left.artifact.localeCompare(right.artifact));
}

function renderEquivalenceFailureLine(check: CoreGraph.RenderEquivalenceCheck): string {
  const detail = stableText(
    check.detail ?? 'Authored and lowered render output must match byte-for-byte.',
  );
  const diff =
    check.expected === undefined && check.actual === undefined
      ? ''
      : ` expected=${stableValue(check.expected)} actual=${stableValue(check.actual)}`;

  return `ERROR RENDER_EQUIV ${check.artifact} ${detail}${diff}`;
}

function stableValue(value: string | undefined): string {
  return value === undefined ? '-' : JSON.stringify(value);
}

function stableText(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(' ');
}

function lintMessage(lint: CoreGraph.SemanticLint): string {
  const base = diagnosticDefinitions[lint.code].message;

  return lint.detail ? `${base} ${lint.detail}` : base;
}

function missedQueryInvalidations(
  queries: readonly CoreGraph.QueryReadSet[],
  touchGraph: CoreGraph.TouchGraph,
  mutations: readonly CoreGraph.MutationExplain[],
): { domain: string; query: string }[] {
  const touchedDomains = new Set(
    Object.values(touchGraph).flatMap((entry) => entry.touches.map((touch) => touch.domain)),
  );
  const mutationDomains = new Set(
    mutations.flatMap((mutation) => [...mutationAffectedDomains(mutation)]),
  );

  return queries.flatMap((query) =>
    query.domains
      .filter((domain) => !touchedDomains.has(domain) && !mutationDomains.has(domain))
      .map((domain) => ({ domain, query: query.query })),
  );
}

/**
 * Direct touch-graph-vs-declared-invalidates superset check (KV402). Fires when a
 * touch-graph entry whose key matches a declared mutation key touches a domain not
 * covered by the mutation's declared writes ∪ invalidates ∪ manualInvalidates.
 * This wires the KV402/KV407 gate to the touch graph end-to-end, bypassing the
 * derivedMutations compile-pipeline path that is currently unpopulated (E3 fix).
 * SPEC §11.1/§11.2.
 */
function touchGraphMutationSupersetFailures(
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

type StaticSupersetFailure =
  | { code: 'KV402'; domain: string; mutation: string; site?: string }
  | { code: 'KV407'; domain: string; query: string };

function staticSupersetFailures(input: CoreGraph.KovoCheckInput): StaticSupersetFailure[] {
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

function staticQueryReadSupersetFailures(
  declaredQueries: readonly CoreGraph.QueryReadSet[],
  derivedQueries: readonly CoreGraph.QueryReadSet[],
): StaticSupersetFailure[] {
  const declaredByQuery = new Map(
    declaredQueries.map((query) => [query.query, new Set(query.domains)]),
  );
  const failures: StaticSupersetFailure[] = [];

  for (const derived of derivedQueries) {
    const declaredDomains = declaredByQuery.get(derived.query) ?? new Set<string>();
    for (const domain of derived.domains) {
      if (!declaredDomains.has(domain)) {
        failures.push({ code: 'KV407', domain, query: derived.query });
      }
    }
  }

  return failures;
}

function staticMutationTouchSupersetFailures(
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

function staticSupersetFailureLine(failure: StaticSupersetFailure): string {
  if (failure.code === 'KV407') {
    return `ERROR KV407 ${failure.query} reads ${failure.domain}. ${diagnosticDefinitions.KV407.message} Derived read set is not covered by declared query domains.`;
  }

  const site = failure.site ? `${failure.site} ` : '';
  return `ERROR KV402 ${site}${failure.mutation} touches ${failure.domain}. ${diagnosticDefinitions.KV402.message} Derived touch set is not covered by declared mutation domains.`;
}

function eventPayloadQueryLints(
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

function normalizePath(path: string): string {
  return path
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .join('.');
}
