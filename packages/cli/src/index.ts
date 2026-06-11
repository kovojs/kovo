#!/usr/bin/env node
export type { DiagnosticCode } from '@jiso/core';
import { readFileSync } from 'node:fs';

import {
  diagnosticDefinitions,
  type DiagnosticCode,
  type DiagnosticSeverity,
  type TouchGraph,
} from '@jiso/core';

export interface FwCheckInput {
  diagnostics?: readonly StaticDiagnosticFact[];
  eventPayloads?: readonly EventPayloadFact[];
  fixpointChecks?: readonly FixpointCheck[];
  lints?: readonly SemanticLint[];
  mutations?: readonly MutationExplain[];
  optimistic?: readonly OptimisticCoverage[];
  ownerDomains?: readonly OwnerDomainFact[];
  pages?: readonly PageExplain[];
  queryData?: readonly QueryDataFact[];
  queries?: readonly QueryReadSet[];
  scopeAudits?: readonly ScopeAuditFact[];
  touchGraph?: TouchGraph;
  updateCoverage?: readonly UpdateCoverageFact[];
  verificationDiagnostics?: readonly VerificationDiagnosticFact[];
}

export interface FwExplainInput extends FwCheckInput {
  components?: readonly ComponentExplain[];
  mutations?: readonly MutationExplain[];
  pages?: readonly PageExplain[];
}

export interface ComponentExplain {
  attributeMerges?: readonly AttributeMergeExplain[];
  derives?: readonly DeriveExplain[];
  fragments?: readonly string[];
  handlers?: readonly HandlerExplain[];
  name: string;
  platformSubstitutions?: readonly PlatformSubstitutionExplain[];
  queries?: readonly string[];
  triggers?: readonly TriggerExplain[];
}

export interface AttributeMergeExplain {
  attr: string;
  decision: string;
  diagnostics?: readonly DiagnosticCode[];
  element: string;
  rule: string;
}

export interface DeriveExplain {
  inputs: readonly string[];
  name: string;
  ref: string;
  target: string;
}

export interface HandlerExplain {
  captures?: readonly CaptureChannel[];
  event: string;
  exportName: string;
  params?: readonly string[];
  ref: string;
  substitution?: string;
}

export type CaptureChannel = 'ctx' | 'element-params' | 'module-scope';

export interface TriggerExplain {
  deps?: readonly string[];
  exportName: string;
  justification?: string;
  ref: string;
  trigger: 'idle' | 'load' | 'visible';
}

export interface PlatformSubstitutionExplain {
  action: string;
  event: string;
  kind: 'details' | 'dialog' | 'popover';
  tag: string;
  target: string;
}

export interface MutationExplain {
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

export interface PageMetaExplain {
  description?: string;
  image?: string;
  title?: string;
}

export interface PageExplain {
  guards?: readonly string[];
  i18n?: readonly string[];
  meta?: PageMetaExplain;
  modulepreloads?: readonly string[];
  prefetch?: 'conservative' | 'moderate' | false;
  queries?: readonly string[];
  route: string;
  stylesheets?: readonly string[];
  viewTransitions?: readonly string[];
}

export interface OptimisticCoverage {
  mutation: string;
  query: string;
  status: 'UNHANDLED' | 'await-fragment' | 'hand-written';
}

export interface OwnerDomainFact {
  domain: string;
  owner: string;
}

export interface ScopeAuditFact {
  detail?: string;
  domain: string;
  kind: 'query' | 'write';
  name: string;
  scope: 'args' | 'session' | 'unscoped' | 'unknown';
  site: string;
}

export interface UpdateCoverageFact {
  component: string;
  detail?: string;
  position: string;
  query: string;
  status: 'UNHANDLED' | 'fragment' | 'isomorphic' | 'plan' | 'renderOnce';
}

export interface FixpointCheck {
  actual?: string;
  artifact: string;
  detail?: string;
  expected?: string;
  ok: boolean;
}

export interface EventPayloadFact {
  event: string;
  fields: readonly string[];
  site: string;
}

export interface QueryDataFact {
  fields: readonly string[];
  query: string;
}

export interface QueryReadSet {
  domains: readonly string[];
  guards?: readonly string[];
  query: string;
}

export interface SemanticLint {
  code: DiagnosticCode;
  detail?: string;
  site: string;
}

export interface VerificationDiagnosticFact {
  branch?: string;
  code: DiagnosticCode;
  detail?: string;
  domain?: string;
  message?: string;
  severity?: DiagnosticSeverity;
  site?: string;
}

export interface StaticDiagnosticFact {
  code: DiagnosticCode;
  length?: number;
  message?: string;
  severity?: DiagnosticSeverity;
  site: string;
  start?: SourcePosition;
}

export interface SourcePosition {
  column: number;
  line: number;
}

interface TouchGraphDiagnosticFact {
  code: DiagnosticCode;
  message: string;
  severity: DiagnosticSeverity;
  site: string;
}

interface UnguardedAccessFact {
  detail: string;
  kind: 'mutation' | 'page' | 'query';
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
    const family = checkFamilyArg(args[1]);
    const inputPath = family === 'all' ? args[1] : args[2];
    const input = readGraphInput(inputPath);
    if (!input.ok) return writeInputError(input.error);
    const result = fwCheck(input.value, { family });
    const stream = result.exitCode === 0 ? process.stdout : process.stderr;
    stream.write(result.output);
    return result.exitCode;
  }

  if (args[0] === 'audit') {
    const inputPath = args[1];
    const input = readGraphInput(inputPath);
    if (!input.ok) return writeInputError(input.error);
    const result = fwAudit(input.value);
    const stream = result.exitCode === 0 ? process.stdout : process.stderr;
    stream.write(result.output);
    return result.exitCode;
  }

  if (args[0] === 'explain') {
    const optimistic = args.includes('--optimistic');
    const unscoped = args.includes('--unscoped');
    const unguarded = args.includes('--unguarded');
    const positional = args
      .slice(1)
      .filter((arg) => arg !== '--optimistic' && arg !== '--unguarded' && arg !== '--unscoped');

    if (unscoped) {
      const [inputPath] = positional;
      const input = readGraphInput(inputPath);
      if (!input.ok) return writeInputError(input.error);
      const result = fwExplain(input.value, { unscoped: true });
      const stream = result.exitCode === 0 ? process.stdout : process.stderr;
      stream.write(result.output);
      return result.exitCode;
    }

    if (unguarded) {
      const [inputPath] = positional;
      const input = readGraphInput(inputPath);
      if (!input.ok) return writeInputError(input.error);
      const result = fwExplain(input.value, { unguarded: true });
      const stream = result.exitCode === 0 ? process.stdout : process.stderr;
      stream.write(result.output);
      return result.exitCode;
    }

    const [kind, target, inputPath] = positional;

    if (!isExplainKind(kind) || !target) {
      process.stderr.write(
        'fw: usage: fw explain component|mutation|query|page <target> [graph.json] | fw explain --unguarded [graph.json] | fw explain --unscoped [graph.json]\n',
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
  kind: 'invalid-json' | 'invalid-shape' | 'not-found' | 'read-error';
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

  return { ok: true, value: parsed as FwExplainInput };
}

function writeInputError(error: InputReadError): 1 {
  const messages: Record<InputReadError['kind'], string> = {
    'invalid-json': `fw: input file is not valid JSON: ${error.path}`,
    'invalid-shape': `fw: input JSON must be an object: ${error.path}`,
    'not-found': `fw: input file not found: ${error.path}`,
    'read-error': `fw: unable to read input file: ${error.path}`,
  };
  process.stderr.write(`${messages[error.kind]}\n`);
  return 1;
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
  | FwTargetExplainOptions
  | FwUnguardedExplainOptions
  | FwUnscopedExplainOptions;

export interface FwTargetExplainOptions {
  kind: ExplainKind;
  optimistic?: boolean;
  target: string;
}

export interface FwUnguardedExplainOptions {
  unguarded: true;
}

export interface FwUnscopedExplainOptions {
  unscoped: true;
}

export function fwExplain(input: FwExplainInput, options: FwExplainOptions): FwCheckResult {
  const lines = [explainOutputVersion];

  if ('unscoped' in options) {
    const findings = unscopedAccesses(input);
    lines.push('UNSCOPED');

    for (const finding of findings) {
      lines.push(unscopedLine(finding));
    }

    lines.push(`SUMMARY total=${findings.length}`);
    return ok(lines);
  }

  if ('unguarded' in options) {
    const accesses = unguardedAccesses(input);
    lines.push('UNGUARDED');

    for (const access of accesses) {
      lines.push(unguardedLine(access));
    }

    lines.push(`SUMMARY total=${accesses.length}`);
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

export function fwAudit(input: FwExplainInput): FwCheckResult {
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

  return ok(lines);
}

export function fwCheck(
  input: FwCheckInput,
  options: { family?: FwCheckFamily } = {},
): FwCheckResult {
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

    for (const missed of missedQueryInvalidations(
      input.queries ?? [],
      input.touchGraph ?? {},
      input.mutations ?? [],
    )) {
      lines.push(
        `ERROR FW407 ${missed.query} reads ${missed.domain} but no mutation touch graph writes that domain.`,
      );
    }

    for (const access of unguardedAccesses(input)) {
      lines.push(unguardedWarningLine(access));
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

  const failed = lines.some((line) => line.startsWith('ERROR '));
  return {
    exitCode: failed ? 1 : 0,
    output: `${lines.join('\n')}\n`,
  };
}

function checkFamilyArg(value: string | undefined): FwCheckFamily {
  return value === 'optimistic' || value === 'coverage' ? value : 'all';
}

function ok(lines: string[]): FwCheckResult {
  return {
    exitCode: 0,
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

function unguardedWarningLine(access: UnguardedAccessFact): string {
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
  return `WARN FW310 ${mutation} -> ${query} Invalidated query lacks optimistic transform.`;
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

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
