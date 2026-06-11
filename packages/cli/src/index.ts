#!/usr/bin/env node
export type { DiagnosticCode } from '@jiso/core';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
  diagnosticDefinitionText,
  diagnosticDefinitions,
  validateFwExplainInput,
  type DiagnosticCode,
  type DiagnosticSeverity,
  type EndpointExplain,
  type EventPayloadFact,
  type FixpointCheck,
  type FwCheckInput,
  type FwExplainInput,
  type GraphInputValidationError,
  type MutationExplain,
  type OptimisticCoverage,
  type QueryReadSet,
  type QueryDataFact,
  type RenderEquivalenceCheck,
  type ScopeAuditFact,
  type SemanticLint,
  type StaticDiagnosticFact,
  type TouchGraph,
  type UpdateCoverageFact,
  type VerificationDiagnosticFact,
} from '@jiso/core';

export type { FwCheckInput, FwExplainInput } from '@jiso/core';

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

export interface FwCheckResult {
  exitCode: 0 | 1;
  output: string;
}

type FwCheckFamily = 'all' | 'coverage' | 'optimistic';

const outputVersion = 'fw-check/v1';
const explainOutputVersion = 'fw-explain/v1';
const auditOutputVersion = 'fw-audit/v1';

export function main(args: readonly string[] = process.argv.slice(2)): number {
  if (args.length === 0) {
    process.stdout.write('fw: explain, check, audit\n');
    return 0;
  }

  if (args[0] === 'check') {
    const parsed = parseCheckArgs(args.slice(1));
    if (!parsed.ok) return writeCheckUsageError(parsed);
    const { family, inputPath } = parsed;
    const input = readGraphInput(inputPath);
    if (!input.ok) return writeInputError(input.error);
    const result = fwCheck(input.value, { family });
    const stream = result.exitCode === 0 ? process.stdout : process.stderr;
    stream.write(result.output);
    return result.exitCode;
  }

  if (args[0] === 'audit') {
    const failOnFindings = args.includes('--fail-on-findings');
    const positional = args.slice(1).filter((arg) => arg !== '--fail-on-findings');
    if (positional.length > 1) {
      process.stderr.write('fw: usage: fw audit [--fail-on-findings] [graph.json]\n');
      return 1;
    }
    const [inputPath] = positional;
    const input = readGraphInput(inputPath);
    if (!input.ok) return writeInputError(input.error);
    const result = fwAudit(input.value, { failOnFindings });
    const stream = result.exitCode === 0 ? process.stdout : process.stderr;
    stream.write(result.output);
    return result.exitCode;
  }

  if (args[0] === 'explain') {
    const optimistic = args.includes('--optimistic');
    const endpoints = args.includes('--endpoints');
    const unscoped = args.includes('--unscoped');
    const unguarded = args.includes('--unguarded');
    const failOnFindings = args.includes('--fail-on-findings');
    const positional = args
      .slice(1)
      .filter(
        (arg) =>
          arg !== '--fail-on-findings' &&
          arg !== '--endpoints' &&
          arg !== '--optimistic' &&
          arg !== '--unguarded' &&
          arg !== '--unscoped',
      );

    if (endpoints) {
      const [inputPath] = positional;
      const input = readGraphInput(inputPath);
      if (!input.ok) return writeInputError(input.error);
      const result = fwExplain(input.value, { endpoints: true });
      const stream = result.exitCode === 0 ? process.stdout : process.stderr;
      stream.write(result.output);
      return result.exitCode;
    }

    if (unscoped) {
      const [inputPath] = positional;
      const input = readGraphInput(inputPath);
      if (!input.ok) return writeInputError(input.error);
      const result = fwExplain(input.value, { failOnFindings, unscoped: true });
      const stream = result.exitCode === 0 ? process.stdout : process.stderr;
      stream.write(result.output);
      return result.exitCode;
    }

    if (unguarded) {
      const [inputPath] = positional;
      const input = readGraphInput(inputPath);
      if (!input.ok) return writeInputError(input.error);
      const result = fwExplain(input.value, { failOnFindings, unguarded: true });
      const stream = result.exitCode === 0 ? process.stdout : process.stderr;
      stream.write(result.output);
      return result.exitCode;
    }

    const [kind, target, inputPath] = positional;

    if (!isExplainKind(kind) || !target) {
      process.stderr.write(
        'fw: usage: fw explain component|mutation|query|page <target> [graph.json] | fw explain --endpoints [graph.json] | fw explain --unguarded [--fail-on-findings] [graph.json] | fw explain --unscoped [--fail-on-findings] [graph.json]\n',
      );
      return 1;
    }

    const input = readGraphInput(inputPath);
    if (!input.ok) return writeInputError(input.error);
    const result = fwExplain(input.value, { kind, optimistic, target });
    const stream = result.exitCode === 0 ? process.stdout : process.stderr;
    stream.write(result.output);
    return result.exitCode;
  }

  process.stderr.write(`fw: command not implemented yet: ${args.join(' ')}\n`);
  return 1;
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

type InputReadResult = { ok: true; value: FwExplainInput } | { error: InputReadError; ok: false };

function readGraphInput(path: string | undefined): InputReadResult {
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

  const validationErrors = validateFwExplainInput(parsed);
  if (validationErrors.length > 0) {
    const validationError = validationErrors[0];
    if (validationError) {
      return { error: graphInputValidationReadError(validationError, path), ok: false };
    }
  }

  return { ok: true, value: parsed as FwExplainInput };
}

function writeInputError(error: InputReadError): 1 {
  const messages: Record<InputReadError['kind'], string> = {
    'invalid-field-shape': `fw: input JSON field ${error.field ?? '-'} must be an ${error.expected ?? 'object'}: ${error.path}`,
    'invalid-json': `fw: input file is not valid JSON: ${error.path}`,
    'invalid-shape': `fw: input JSON must be an object: ${error.path}`,
    'invalid-value': `fw: input JSON invalid: ${error.path}: ${error.field ?? '$'} ${error.message ?? 'is invalid'}`,
    'not-found': `fw: input file not found: ${error.path}`,
    'read-error': `fw: unable to read input file: ${error.path}`,
  };
  process.stderr.write(`${messages[error.kind]}\n`);
  return 1;
}

function graphInputValidationReadError(
  error: GraphInputValidationError,
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

export type ExplainKind = 'component' | 'mutation' | 'page' | 'query';

export type FwExplainOptions =
  | FwEndpointExplainOptions
  | FwTargetExplainOptions
  | FwUnguardedExplainOptions
  | FwUnscopedExplainOptions;

export interface FwEndpointExplainOptions {
  endpoints: true;
}

export interface FwTargetExplainOptions {
  kind: ExplainKind;
  optimistic?: boolean;
  target: string;
}

export interface FwUnguardedExplainOptions {
  failOnFindings?: boolean;
  unguarded: true;
}

export interface FwUnscopedExplainOptions {
  failOnFindings?: boolean;
  unscoped: true;
}

export function fwExplain(input: FwExplainInput, options: FwExplainOptions): FwCheckResult {
  const validationErrors = validateFwExplainInput(input);
  if (validationErrors.length > 0)
    return invalidGraphInputResult(explainOutputVersion, validationErrors);

  const lines = [explainOutputVersion];

  if ('unscoped' in options) {
    const findings = unscopedAccesses(input);
    lines.push('UNSCOPED');

    for (const finding of findings) {
      lines.push(unscopedLine(finding));
    }

    lines.push(`SUMMARY total=${findings.length}`);
    return explainAuditResult(lines, findings.length, options.failOnFindings);
  }

  if ('unguarded' in options) {
    const accesses = unguardedAccesses(input);
    lines.push('UNGUARDED');

    for (const access of accesses) {
      lines.push(unguardedLine(access));
    }

    lines.push(`SUMMARY total=${accesses.length}`);
    return explainAuditResult(lines, accesses.length, options.failOnFindings);
  }

  if ('endpoints' in options) {
    const endpoints = [...(input.endpoints ?? [])].sort(compareEndpointExplain);
    lines.push('ENDPOINTS');

    for (const endpoint of endpoints) {
      lines.push(endpointExplainLine(endpoint));
    }

    lines.push(`SUMMARY total=${endpoints.length}`);
    return ok(lines);
  }

  if (options.kind === 'component') {
    const component = input.components?.find((item) => item.name === options.target);
    if (!component) return notFound(options);

    lines.push(`COMPONENT ${component.name}`);
    lines.push(`queries: ${list(component.queries)}`);
    lines.push(`fragments: ${list(component.fragments)}`);

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

    return ok(lines);
  }

  if (options.kind === 'mutation') {
    const mutation = input.mutations?.find((item) => item.key === options.target);
    if (!mutation) return notFound(options);

    lines.push(`MUTATION ${mutation.key}`);
    lines.push(`guards: ${list(mutation.guards)}`);
    if (mutation.session) lines.push(`session: ${mutation.session}`);
    if (mutation.enctype) lines.push(`enctype: ${mutation.enctype}`);
    if (mutation.inputFields) lines.push(`input-fields: ${list(mutation.inputFields)}`);
    if (mutation.fileFields) lines.push(`file-fields: ${list(mutation.fileFields)}`);
    lines.push(`writes: ${list(mutation.writes)}`);
    lines.push(`invalidates: ${list(mutation.invalidates)}`);
    lines.push(`manual-invalidates: ${list(mutation.manualInvalidates)}`);
    lines.push(`updates: ${listMutationUpdates(mutationUpdates(mutation, input))}`);

    if (options.optimistic) {
      const coverages = optimisticCoverageForMutation(mutation, input);

      for (const coverage of coverages) {
        lines.push(`OPTIMISTIC ${coverage.query} ${coverage.status}`);
        if (coverage.status === 'UNHANDLED') {
          lines.push(optimisticUnhandledFixLine());
        }
      }

      lines.push(optimisticSummary(coverages));
    }

    return ok(lines);
  }

  if (options.kind === 'query') {
    const query = input.queries?.find((item) => item.query === options.target);
    if (!query) return notFound(options);

    lines.push(`QUERY ${query.query}`);
    lines.push(`reads: ${list(query.domains)}`);
    lines.push(`consumers: ${list(queryConsumers(query.query, input))}`);
    lines.push(`invalidated-by: ${list(invalidatedBy(query, input))}`);
    lines.push(`domain-writes: ${list(domainWritesFor(query, input))}`);
    return ok(lines);
  }

  const page = input.pages?.find((item) => item.route === options.target);
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
  lines.push(`view-transitions: ${list(page.viewTransitions)}`);
  return ok(lines);
}

export interface FwAuditOptions {
  failOnFindings?: boolean;
}

export function fwAudit(input: FwExplainInput, options: FwAuditOptions = {}): FwCheckResult {
  const validationErrors = validateFwExplainInput(input);
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

export function fwCheck(
  input: FwCheckInput,
  options: { family?: FwCheckFamily } = {},
): FwCheckResult {
  const validationErrors = validateFwExplainInput(input);
  if (validationErrors.length > 0) return invalidGraphInputResult(outputVersion, validationErrors);

  const lines = [outputVersion];
  const family = options.family ?? 'all';
  const includeAll = family === 'all';

  if (includeAll) {
    const diagnostics = diagnosticsForTouchGraph(input.touchGraph ?? {});

    for (const diagnostic of diagnostics) {
      lines.push(
        `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.site} ${diagnostic.message}`,
      );
    }

    for (const diagnostic of input.diagnostics ?? []) {
      lines.push(staticDiagnosticLine(diagnostic));
    }

    for (const diagnostic of input.verificationDiagnostics ?? []) {
      lines.push(verificationDiagnosticLine(diagnostic));
    }
  }

  if (includeAll || family === 'optimistic') {
    for (const warning of optimisticCoverageWarnings(
      input.mutations ?? [],
      input.queries ?? [],
      input.optimistic ?? [],
    )) {
      lines.push(warning);
    }
  }

  if (includeAll || family === 'coverage') {
    for (const line of updateCoverageLines(input.updateCoverage ?? [])) {
      lines.push(line);
    }
  }

  if (includeAll) {
    for (const finding of unscopedAccesses(input)) {
      lines.push(`WARN ${unscopedLine(finding)}`);
    }

    for (const lint of input.lints ?? []) {
      lines.push(`LINT ${lint.code} ${lint.site} ${lintMessage(lint)}`);
    }

    for (const lint of eventPayloadQueryLints(input.eventPayloads ?? [], input.queryData ?? [])) {
      lines.push(`LINT ${lint.code} ${lint.site} ${lintMessage(lint)}`);
    }

    for (const failure of fixpointFailures(input.fixpointChecks ?? [])) {
      lines.push(fixpointFailureLine(failure));
    }

    for (const failure of renderEquivalenceFailures(input.renderEquivalenceChecks ?? [])) {
      lines.push(renderEquivalenceFailureLine(failure));
    }

    for (const missed of missedQueryInvalidations(
      input.queries ?? [],
      input.touchGraph ?? {},
      input.mutations ?? [],
    )) {
      const message = diagnosticDefinitionText('FW407', { includeHelp: true });
      lines.push(`ERROR FW407 ${missed.query} reads ${missed.domain}. ${message}`);
    }

    for (const access of unguardedAccesses(input)) {
      lines.push(unguardedWarningLine(access));
    }

    for (const endpoint of input.endpoints ?? []) {
      if (endpoint.csrf === 'exempt' && !endpoint.csrfJustification) {
        lines.push(
          `WARN ENDPOINT ${endpointName(endpoint)} csrf exemption requires a named justification.`,
        );
      }
    }

    for (const mutation of input.mutations ?? []) {
      for (const domain of mutation.manualInvalidates ?? []) {
        lines.push(
          `WARN INVALIDATE ${mutation.key} -> ${domain} Manual invalidate escape hatch requires review.`,
        );
      }
    }
  }

  if (lines.length === 1) {
    lines.push('OK');
  }

  const failed = lines.some(isCheckFailureLine);
  return {
    exitCode: failed ? 1 : 0,
    output: `${lines.join('\n')}\n`,
  };
}

function invalidGraphInputResult(
  version: string,
  errors: readonly GraphInputValidationError[],
): FwCheckResult {
  const lines = [version, ...errors.map((error) => `ERROR INPUT ${error.path} ${error.message}`)];
  return {
    exitCode: 1,
    output: `${lines.join('\n')}\n`,
  };
}

function isCheckFailureLine(line: string): boolean {
  return (
    line.startsWith('ERROR ') || line.startsWith('WARN FW310 ') || line.startsWith('WARN FW311 ')
  );
}

function checkFamilyArg(value: string | undefined): FwCheckFamily {
  return value === 'optimistic' || value === 'coverage' ? value : 'all';
}

type CheckArgParseResult =
  | { family: FwCheckFamily; inputPath: string | undefined; ok: true }
  | { family: string | undefined; kind: 'too-many-args' | 'unsupported-family'; ok: false };

function parseCheckArgs(args: readonly string[]): CheckArgParseResult {
  const family = checkFamilyArg(args[0]);
  if (family !== 'all') {
    if (args.length > 2) return { family: args[0], kind: 'too-many-args', ok: false };
    return { family, inputPath: args[1], ok: true };
  }
  if (args.length > 1) return { family: args[0], kind: 'unsupported-family', ok: false };
  return { family, inputPath: args[0], ok: true };
}

function writeCheckUsageError(error: Extract<CheckArgParseResult, { ok: false }>): number {
  const message =
    error.kind === 'unsupported-family'
      ? `fw: unsupported check family ${stableValue(error.family)}. expected optimistic or coverage.\n`
      : 'fw: usage: fw check [optimistic|coverage] [graph.json]\n';
  process.stderr.write(message);
  return 1;
}

function ok(lines: string[]): FwCheckResult {
  return {
    exitCode: 0,
    output: `${lines.join('\n')}\n`,
  };
}

function explainAuditResult(
  lines: string[],
  findingCount: number,
  failOnFindings = false,
): FwCheckResult {
  return {
    exitCode: failOnFindings && findingCount > 0 ? 1 : 0,
    output: `${lines.join('\n')}\n`,
  };
}

function diagnosticsForTouchGraph(graph: TouchGraph): TouchGraphDiagnosticFact[] {
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
        code: 'FW409' as const,
        message: diagnosticDefinitions.FW409.message,
        severity: diagnosticDefinitions.FW409.severity,
        site: touch.site,
      })),
    ...(entry.reads ?? [])
      .filter((read) => read.predicate === 'non-eq')
      .map((read) => ({
        code: 'FW409' as const,
        message: diagnosticDefinitions.FW409.message,
        severity: diagnosticDefinitions.FW409.severity,
        site: read.site,
      })),
  ]);
}

function verificationDiagnosticLine(diagnostic: VerificationDiagnosticFact): string {
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

function staticDiagnosticLine(diagnostic: StaticDiagnosticFact): string {
  const definition = diagnosticDefinitions[diagnostic.code];
  const severity = diagnostic.severity ?? definition.severity;
  return `${severity.toUpperCase()} ${diagnostic.code} ${diagnosticSite(diagnostic)} ${diagnostic.message ?? definition.message}`;
}

function diagnosticSite(diagnostic: StaticDiagnosticFact): string {
  return diagnostic.start
    ? `${diagnostic.site}:${diagnostic.start.line}:${diagnostic.start.column}`
    : diagnostic.site;
}

function notFound(options: FwTargetExplainOptions): FwCheckResult {
  return {
    exitCode: 1,
    output: `${explainOutputVersion}\nERROR NOT_FOUND ${options.kind} ${options.target}\n`,
  };
}

function list(values: readonly string[] | undefined): string {
  return values && values.length > 0 ? values.join(',') : '-';
}

function isExplainKind(value: string | undefined): value is ExplainKind {
  return value === 'component' || value === 'mutation' || value === 'page' || value === 'query';
}

function invalidatedBy(query: QueryReadSet, input: FwExplainInput): string[] {
  const invalidators = new Set<string>();

  for (const mutation of input.mutations ?? []) {
    const domains = mutationAffectedDomains(mutation);

    if (query.domains.some((domain) => domains.has(domain))) {
      invalidators.add(mutation.key);
    }
  }

  return [...invalidators].sort();
}

function domainWritesFor(query: QueryReadSet, input: FwExplainInput): string[] {
  const writes = new Set<string>();

  for (const [writeName, entry] of Object.entries(input.touchGraph ?? {})) {
    if (entry.touches.some((touch) => query.domains.some((domain) => domain === touch.domain))) {
      writes.add(writeName);
    }
  }

  return [...writes].sort();
}

function queryConsumers(queryName: string, input: FwExplainInput): string[] {
  const components =
    input.components
      ?.filter((component) => component.queries?.includes(queryName))
      .map((component) => `component:${component.name}`) ?? [];
  const pages =
    input.pages
      ?.filter((page) => page.queries?.includes(queryName))
      .map((page) => `page:${page.route}`) ?? [];

  return [...components, ...pages].sort();
}

function mutationUpdates(
  mutation: MutationExplain,
  input: FwExplainInput,
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

function unguardedAccesses(input: FwExplainInput): UnguardedAccessFact[] {
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
      .filter((mutation) => !hasAuthGuard(mutation.guards ?? []))
      .map((mutation) => ({
        detail: [
          `guards=${list(mutation.guards)}`,
          `writes=${list(mutation.writes)}`,
          `invalidates=${list(mutation.invalidates)}`,
          `manual-invalidates=${list(mutation.manualInvalidates)}`,
        ].join(' '),
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

function endpointExplainLine(endpoint: EndpointExplain): string {
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

function hasEndpointAuth(endpoint: EndpointExplain): boolean {
  if (hasAuthGuard(endpoint.guards ?? [])) return true;
  if (!endpoint.auth) return false;

  return (
    endpoint.auth === 'authed' ||
    endpoint.auth.startsWith('role:') ||
    endpoint.auth.startsWith('custom:') ||
    endpoint.auth.startsWith('verifier:')
  );
}

function endpointName(endpoint: EndpointExplain): string {
  return endpoint.name ?? endpoint.path;
}

function compareEndpointExplain(left: EndpointExplain, right: EndpointExplain): number {
  return endpointName(left).localeCompare(endpointName(right));
}

function endpointAuth(endpoint: EndpointExplain): string {
  return endpoint.auth ?? list(endpoint.guards);
}

function endpointCsrf(endpoint: EndpointExplain): string {
  if (endpoint.csrf !== 'exempt') return endpoint.csrf ?? 'checked';
  return `exempt:${endpoint.csrfJustification ?? '-'}`;
}

function optimisticSummary(coverages: readonly OptimisticCoverage[]): string {
  const counts: Record<OptimisticCoverage['status'], number> = {
    UNHANDLED: 0,
    'await-fragment': 0,
    'hand-written': 0,
  };

  for (const coverage of coverages) {
    counts[coverage.status] += 1;
  }

  return [
    'OPTIMISTIC-SUMMARY',
    `total=${coverages.length}`,
    `hand-written=${counts['hand-written']}`,
    `await-fragment=${counts['await-fragment']}`,
    `UNHANDLED=${counts.UNHANDLED}`,
  ].join(' ');
}

function optimisticCoverageWarnings(
  mutations: readonly MutationExplain[],
  queries: readonly QueryReadSet[],
  coverages: readonly OptimisticCoverage[],
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
    const domains = mutationAffectedDomains(mutation);
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
  return `WARN FW310 ${mutation} -> ${query} ${diagnosticDefinitions.FW310.message}`;
}

function updateCoverageLines(coverage: readonly UpdateCoverageFact[]): string[] {
  return [...coverage]
    .sort(compareUpdateCoverage)
    .map((fact) =>
      fact.status === 'UNHANDLED'
        ? [
            'WARN FW311',
            `component=${fact.component}`,
            `query=${fact.query}`,
            `position=${JSON.stringify(fact.position)}`,
            diagnosticDefinitions.FW311.message,
            fact.detail ?? '',
          ]
            .filter(Boolean)
            .join(' ')
        : [
            'COVERAGE',
            `component=${fact.component}`,
            `query=${fact.query}`,
            `position=${JSON.stringify(fact.position)}`,
            `status=${fact.status}`,
            fact.detail ? `detail=${JSON.stringify(fact.detail)}` : '',
          ]
            .filter(Boolean)
            .join(' '),
    );
}

function unscopedAccesses(input: FwCheckInput): ScopeAuditFact[] {
  const ownerDomains = new Set((input.ownerDomains ?? []).map((owner) => owner.domain));

  return (input.scopeAudits ?? [])
    .filter((fact) => ownerDomains.has(fact.domain))
    .filter((fact) => fact.scope !== 'session')
    .sort(compareScopeAudit);
}

function unscopedLine(fact: ScopeAuditFact): string {
  return [
    'UNSCOPED',
    fact.kind.toUpperCase(),
    fact.name,
    `domain=${fact.domain}`,
    `scope=${fact.scope}`,
    `site=${fact.site}`,
    fact.detail ?? '',
  ]
    .filter(Boolean)
    .join(' ');
}

function compareScopeAudit(left: ScopeAuditFact, right: ScopeAuditFact): number {
  return (
    left.kind.localeCompare(right.kind) ||
    left.name.localeCompare(right.name) ||
    left.domain.localeCompare(right.domain) ||
    left.site.localeCompare(right.site) ||
    left.scope.localeCompare(right.scope)
  );
}

function compareUpdateCoverage(left: UpdateCoverageFact, right: UpdateCoverageFact): number {
  return (
    left.component.localeCompare(right.component) ||
    left.query.localeCompare(right.query) ||
    left.position.localeCompare(right.position) ||
    left.status.localeCompare(right.status)
  );
}

function optimisticUnhandledFixLine(): string {
  return "  -> hand-write in the mutation module, or declare 'await-fragment'";
}

function optimisticCoverageForMutation(
  mutation: MutationExplain,
  input: FwExplainInput,
): OptimisticCoverage[] {
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
  mutation: MutationExplain,
  input: FwExplainInput,
): readonly QueryReadSet[] {
  const domains = mutationAffectedDomains(mutation);
  if (domains.size === 0) return [];

  return (input.queries ?? []).filter((query) =>
    query.domains.some((domain) => domains.has(domain)),
  );
}

function mutationAffectedDomains(mutation: MutationExplain): Set<string> {
  return new Set([
    ...(mutation.writes ?? []),
    ...(mutation.invalidates ?? []),
    ...(mutation.manualInvalidates ?? []),
  ]);
}

function fixpointFailures(checks: readonly FixpointCheck[]): FixpointCheck[] {
  return checks
    .filter((check) => !check.ok)
    .sort((left, right) => left.artifact.localeCompare(right.artifact));
}

function fixpointFailureLine(check: FixpointCheck): string {
  const detail = stableText(check.detail ?? 'Generated output must compile to itself.');
  const diff =
    check.expected === undefined && check.actual === undefined
      ? ''
      : ` expected=${stableValue(check.expected)} actual=${stableValue(check.actual)}`;

  return `ERROR FIXPOINT ${check.artifact} ${detail}${diff}`;
}

function renderEquivalenceFailures(
  checks: readonly RenderEquivalenceCheck[],
): RenderEquivalenceCheck[] {
  return checks
    .filter((check) => !check.ok)
    .sort((left, right) => left.artifact.localeCompare(right.artifact));
}

function renderEquivalenceFailureLine(check: RenderEquivalenceCheck): string {
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

function lintMessage(lint: SemanticLint): string {
  const base = diagnosticDefinitions[lint.code].message;

  return lint.detail ? `${base} ${lint.detail}` : base;
}

function missedQueryInvalidations(
  queries: readonly QueryReadSet[],
  touchGraph: TouchGraph,
  mutations: readonly MutationExplain[],
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

function eventPayloadQueryLints(
  events: readonly EventPayloadFact[],
  queries: readonly QueryDataFact[],
): SemanticLint[] {
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
          code: 'FW320',
          detail: `event ${event.event} carries ${normalizedField} from query ${[
            ...new Set(queryNames),
          ]
            .sort()
            .join(',')}.`,
          site: event.site,
        },
      ] satisfies SemanticLint[];
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
