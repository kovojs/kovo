#!/usr/bin/env node
export type { DiagnosticCode } from '@jiso/core';
import { readFileSync } from 'node:fs';

import { diagnosticDefinitions } from '@jiso/core';
import { diagnosticsForTouchGraph, type TouchGraph } from '@jiso/drizzle';

export interface FwCheckInput {
  eventPayloads?: readonly EventPayloadFact[];
  lints?: readonly SemanticLint[];
  mutations?: readonly MutationExplain[];
  optimistic?: readonly OptimisticCoverage[];
  queryData?: readonly QueryDataFact[];
  queries?: readonly QueryReadSet[];
  touchGraph?: TouchGraph;
}

export interface FwExplainInput extends FwCheckInput {
  components?: readonly ComponentExplain[];
  mutations?: readonly MutationExplain[];
  pages?: readonly PageExplain[];
}

export interface ComponentExplain {
  fragments?: readonly string[];
  handlers?: readonly HandlerExplain[];
  name: string;
  queries?: readonly string[];
}

export interface HandlerExplain {
  event: string;
  exportName: string;
  params?: readonly string[];
  ref: string;
  substitution?: string;
}

export interface MutationExplain {
  guards?: readonly string[];
  invalidates?: readonly string[];
  key: string;
  manualInvalidates?: readonly string[];
  writes?: readonly string[];
}

export interface PageExplain {
  modulepreloads?: readonly string[];
  prefetch?: 'conservative' | 'moderate' | false;
  queries?: readonly string[];
  route: string;
}

export interface OptimisticCoverage {
  mutation: string;
  query: string;
  status: 'UNHANDLED' | 'await-fragment' | 'hand-written';
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
  query: string;
}

export interface SemanticLint {
  code: 'FW301' | 'FW302' | 'FW320' | 'FW330';
  detail?: string;
  site: string;
}

export interface FwCheckResult {
  exitCode: 0 | 1;
  output: string;
}

const outputVersion = 'fw-check/v1';
const explainOutputVersion = 'fw-explain/v1';

export function main(args: readonly string[] = process.argv.slice(2)): number {
  if (args.length === 0) {
    process.stdout.write('fw: explain, check, audit\n');
    return 0;
  }

  if (args[0] === 'check') {
    const inputPath = args[1];
    const input = inputPath ? JSON.parse(readFileSync(inputPath, 'utf8')) : {};
    const result = fwCheck(input);
    const stream = result.exitCode === 0 ? process.stdout : process.stderr;
    stream.write(result.output);
    return result.exitCode;
  }

  if (args[0] === 'explain') {
    const optimistic = args.includes('--optimistic');
    const unguarded = args.includes('--unguarded');
    const positional = args
      .slice(1)
      .filter((arg) => arg !== '--optimistic' && arg !== '--unguarded');

    if (unguarded) {
      const [inputPath] = positional;
      const input = inputPath ? JSON.parse(readFileSync(inputPath, 'utf8')) : {};
      const result = fwExplain(input, { unguarded: true });
      const stream = result.exitCode === 0 ? process.stdout : process.stderr;
      stream.write(result.output);
      return result.exitCode;
    }

    const [kind, target, inputPath] = positional;

    if (!isExplainKind(kind) || !target) {
      process.stderr.write(
        'fw: usage: fw explain component|mutation|query|page <target> [graph.json] | fw explain --unguarded [graph.json]\n',
      );
      return 1;
    }

    const input = inputPath ? JSON.parse(readFileSync(inputPath, 'utf8')) : {};
    const result = fwExplain(input, { kind, optimistic, target });
    const stream = result.exitCode === 0 ? process.stdout : process.stderr;
    stream.write(result.output);
    return result.exitCode;
  }

  process.stderr.write(`fw: command not implemented yet: ${args.join(' ')}\n`);
  return 1;
}

export type ExplainKind = 'component' | 'mutation' | 'page' | 'query';

export type FwExplainOptions = FwTargetExplainOptions | FwUnguardedExplainOptions;

export interface FwTargetExplainOptions {
  kind: ExplainKind;
  optimistic?: boolean;
  target: string;
}

export interface FwUnguardedExplainOptions {
  unguarded: true;
}

export function fwExplain(input: FwExplainInput, options: FwExplainOptions): FwCheckResult {
  const lines = [explainOutputVersion];

  if ('unguarded' in options) {
    const mutations = unguardedMutations(input.mutations ?? []);
    lines.push('UNGUARDED');

    for (const mutation of mutations) {
      lines.push(
        [
          `MUTATION ${mutation.key}`,
          `guards=${list(mutation.guards)}`,
          `writes=${list(mutation.writes)}`,
          `invalidates=${list(mutation.invalidates)}`,
          `manual-invalidates=${list(mutation.manualInvalidates)}`,
        ].join(' '),
      );
    }

    lines.push(`SUMMARY total=${mutations.length}`);
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
          `params=${list(handler.params)}`,
          `substitution=${handler.substitution ?? '-'}`,
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
    lines.push(`writes: ${list(mutation.writes)}`);
    lines.push(`invalidates: ${list(mutation.invalidates)}`);
    lines.push(`manual-invalidates: ${list(mutation.manualInvalidates)}`);

    if (options.optimistic) {
      const coverages = input.optimistic?.filter((item) => item.mutation === mutation.key) ?? [];

      for (const coverage of coverages) {
        lines.push(`OPTIMISTIC ${coverage.query} ${coverage.status}`);
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
    lines.push(`invalidated-by: ${list(invalidatedBy(query, input.touchGraph ?? {}))}`);
    return ok(lines);
  }

  const page = input.pages?.find((item) => item.route === options.target);
  if (!page) return notFound(options);

  lines.push(`PAGE ${page.route}`);
  lines.push(`prefetch: ${page.prefetch ?? false}`);
  lines.push(`modulepreloads: ${list(page.modulepreloads)}`);
  lines.push(`queries: ${list(page.queries)}`);
  return ok(lines);
}

export function fwCheck(input: FwCheckInput): FwCheckResult {
  const lines = [outputVersion];
  const diagnostics = diagnosticsForTouchGraph(input.touchGraph ?? {});

  for (const diagnostic of diagnostics) {
    lines.push(
      `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${diagnostic.site} ${diagnostic.message}`,
    );
  }

  for (const coverage of input.optimistic ?? []) {
    if (coverage.status !== 'UNHANDLED') continue;

    lines.push(
      `WARN FW310 ${coverage.mutation} -> ${coverage.query} Invalidated query lacks optimistic transform.`,
    );
  }

  for (const lint of input.lints ?? []) {
    lines.push(`LINT ${lint.code} ${lint.site} ${lintMessage(lint)}`);
  }

  for (const lint of eventPayloadQueryLints(input.eventPayloads ?? [], input.queryData ?? [])) {
    lines.push(`LINT ${lint.code} ${lint.site} ${lintMessage(lint)}`);
  }

  for (const missed of missedQueryInvalidations(input.queries ?? [], input.touchGraph ?? {})) {
    lines.push(
      `ERROR FW407 ${missed.query} reads ${missed.domain} but no mutation touch graph writes that domain.`,
    );
  }

  for (const mutation of unguardedMutations(input.mutations ?? [])) {
    lines.push(`WARN UNGUARDED ${mutation.key} mutation is reachable without an auth guard.`);
  }

  for (const mutation of input.mutations ?? []) {
    for (const domain of mutation.manualInvalidates ?? []) {
      lines.push(
        `WARN INVALIDATE ${mutation.key} -> ${domain} Manual invalidate escape hatch requires review.`,
      );
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

function ok(lines: string[]): FwCheckResult {
  return {
    exitCode: 0,
    output: `${lines.join('\n')}\n`,
  };
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

function invalidatedBy(query: QueryReadSet, touchGraph: TouchGraph): string[] {
  return Object.entries(touchGraph)
    .filter(([, entry]) =>
      entry.touches.some((touch) => query.domains.some((domain) => domain === touch.domain)),
    )
    .map(([writeName]) => writeName);
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

function unguardedMutations(mutations: readonly MutationExplain[]): MutationExplain[] {
  return mutations.filter((mutation) => !hasAuthGuard(mutation.guards ?? []));
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

function lintMessage(lint: SemanticLint): string {
  const base = diagnosticDefinitions[lint.code].message;

  return lint.detail ? `${base} ${lint.detail}` : base;
}

function missedQueryInvalidations(
  queries: readonly QueryReadSet[],
  touchGraph: TouchGraph,
): { domain: string; query: string }[] {
  const touchedDomains = new Set(
    Object.values(touchGraph).flatMap((entry) => entry.touches.map((touch) => touch.domain)),
  );

  return queries.flatMap((query) =>
    query.domains
      .filter((domain) => !touchedDomains.has(domain))
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
