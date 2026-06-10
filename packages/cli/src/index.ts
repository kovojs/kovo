#!/usr/bin/env node
export type { DiagnosticCode } from '@jiso/core';
import { readFileSync } from 'node:fs';

import { diagnosticsForTouchGraph, type TouchGraph } from '@jiso/drizzle';

export interface FwCheckInput {
  optimistic?: OptimisticCoverage[];
  queries?: QueryReadSet[];
  touchGraph?: TouchGraph;
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

export interface FwCheckResult {
  exitCode: 0 | 1;
  output: string;
}

const outputVersion = 'fw-check/v1';

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

  process.stderr.write(`fw: command not implemented yet: ${args.join(' ')}\n`);
  return 1;
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

  for (const missed of missedQueryInvalidations(input.queries ?? [], input.touchGraph ?? {})) {
    lines.push(
      `ERROR FW407 ${missed.query} reads ${missed.domain} but no mutation touch graph writes that domain.`,
    );
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
