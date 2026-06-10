#!/usr/bin/env node
export type { DiagnosticCode } from '@jiso/core';
import { readFileSync } from 'node:fs';

import { diagnosticDefinitions } from '@jiso/core';
import { diagnosticsForTouchGraph, type TouchGraph } from '@jiso/drizzle';

export interface FwCheckInput {
  lints?: SemanticLint[];
  mutations?: MutationExplain[];
  optimistic?: OptimisticCoverage[];
  queries?: QueryReadSet[];
  touchGraph?: TouchGraph;
}

export interface FwExplainInput extends FwCheckInput {
  components?: ComponentExplain[];
  mutations?: MutationExplain[];
  pages?: PageExplain[];
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

export interface QueryReadSet {
  domains: readonly string[];
  query: string;
}

export interface SemanticLint {
  code: 'FW301' | 'FW320' | 'FW330';
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
    const positional = args.slice(1).filter((arg) => arg !== '--optimistic');
    const [kind, target, inputPath] = positional;

    if (!isExplainKind(kind) || !target) {
      process.stderr.write(
        'fw: usage: fw explain component|mutation|query|page <target> [graph.json]\n',
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

export interface FwExplainOptions {
  kind: ExplainKind;
  optimistic?: boolean;
  target: string;
}

export function fwExplain(input: FwExplainInput, options: FwExplainOptions): FwCheckResult {
  const lines = [explainOutputVersion];

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
      for (const coverage of input.optimistic?.filter((item) => item.mutation === mutation.key) ??
        []) {
        lines.push(`OPTIMISTIC ${coverage.query} ${coverage.status}`);
      }
    }

    return ok(lines);
  }

  if (options.kind === 'query') {
    const query = input.queries?.find((item) => item.query === options.target);
    if (!query) return notFound(options);

    lines.push(`QUERY ${query.query}`);
    lines.push(`reads: ${list(query.domains)}`);
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

function notFound(options: FwExplainOptions): FwCheckResult {
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

function unguardedMutations(mutations: readonly MutationExplain[]): MutationExplain[] {
  return mutations.filter((mutation) => !hasAuthGuard(mutation.guards ?? []));
}

function hasAuthGuard(guards: readonly string[]): boolean {
  return guards.some((guard) => guard === 'authed' || guard.startsWith('role:'));
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

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
