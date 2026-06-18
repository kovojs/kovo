import type { DiagnosticCode, DiagnosticSeverity } from '@kovojs/core';
import { diagnosticDefinitions } from '@kovojs/core/internal/diagnostics';
import type { ReadSite, TouchGraph, TouchGraphEntry, TouchSite } from '@kovojs/core/internal/graph';

interface GraphDomainTableAnnotation {
  domain: string;
  key?: string;
}

/** @internal */
export interface DomainRegistryInput {
  table: GraphDomainTableAnnotation & { name: string };
}

/** @internal */
export interface WriteSummaryInput {
  branch?: string;
  operation: string;
  predicate?: 'eq' | 'non-eq';
  site: string;
  table: GraphDomainTableAnnotation & { name: string };
  writeKey?: string;
}

/** @internal */
export interface ReadSummaryInput {
  branch?: string;
  operation:
    | 'delete-predicate'
    | 'insert-select'
    | 'update-from'
    | 'update-predicate'
    | (string & {});
  predicate?: 'eq' | 'non-eq';
  readKey?: string;
  site: string;
  table: GraphDomainTableAnnotation & { name: string };
}

/** @internal */
export interface UnresolvedSummaryInput {
  code?: 'KV404' | 'KV406';
  domain?: string;
  operation: string;
  site: string;
}

/** @internal */
export interface TouchGraphDiagnostic {
  code: DiagnosticCode;
  message: string;
  severity: DiagnosticSeverity;
  site: string;
}

/** @internal */
export function serializeDomainRegistry(tables: readonly DomainRegistryInput[]): string {
  const rows = [...tables].sort((left, right) => left.table.name.localeCompare(right.table.name));
  const domains = [...new Set(rows.map((row) => row.table.domain))].sort();
  const domainKey = domains.map((domain) => JSON.stringify(domain)).join(' | ') || 'never';
  const lines = [`export type DomainKey = ${domainKey};`, '', 'export const tableDomains = {'];

  for (const row of rows) {
    lines.push(`  ${JSON.stringify(row.table.name)}: ${JSON.stringify(row.table.domain)},`);
  }

  lines.push('} as const satisfies Record<string, DomainKey>;');
  return `${lines.join('\n')}\n`;
}

/** @internal */
export function createTouchGraphEntry(input: {
  reads?: readonly ReadSummaryInput[];
  unresolved?: readonly UnresolvedSummaryInput[];
  writes?: readonly WriteSummaryInput[];
}): TouchGraphEntry {
  return {
    reads: [...(input.reads ?? [])]
      .map((read) => ({
        ...(read.branch === undefined ? {} : { branch: read.branch }),
        domain: read.table.domain,
        keys: read.readKey ?? null,
        ...(read.predicate === undefined ? {} : { predicate: read.predicate }),
        site: read.site,
        source: read.operation,
        via: read.table.name,
      }))
      .sort(compareReadSites),
    touches: [...(input.writes ?? [])]
      .map((write) => ({
        ...(write.branch === undefined ? {} : { branch: write.branch }),
        domain: write.table.domain,
        keys: write.writeKey ?? null,
        ...(write.predicate === undefined ? {} : { predicate: write.predicate }),
        site: write.site,
        via: write.table.name,
      }))
      .sort(compareTouchSites),
    unresolved: [...(input.unresolved ?? [])].map((site) => ({
      code: site.code ?? 'KV406',
      ...(site.domain === undefined ? {} : { domain: site.domain }),
      message: unresolvedMessage(site),
      site: site.site,
    })),
  };
}

function unresolvedMessage(site: UnresolvedSummaryInput): string {
  if (site.code === 'KV404') return diagnosticDefinitions.KV404.message;

  // SPEC §11.1: write read sources are separate visible surfaces from the write target. Keep
  // their KV406 diagnostics explicit when the source table cannot be proven.
  if (site.operation === 'insert-select') {
    return `${diagnosticDefinitions.KV406.message} Insert-select read source could not be resolved to a Drizzle table.`;
  }
  if (site.operation === 'update-from') {
    return `${diagnosticDefinitions.KV406.message} Update-from read source could not be resolved to a Drizzle table.`;
  }
  if (site.operation === 'update-predicate') {
    return `${diagnosticDefinitions.KV406.message} Update predicate read source could not be resolved to a Drizzle table.`;
  }
  if (site.operation === 'delete-predicate') {
    return `${diagnosticDefinitions.KV406.message} Delete predicate read source could not be resolved to a Drizzle table.`;
  }
  return diagnosticDefinitions.KV406.message;
}

/** @internal */
export function serializeTouchGraph(graph: TouchGraph): string {
  const lines = ['export const touchGraph = {'];

  for (const [writeName, entry] of Object.entries(graph).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`  ${JSON.stringify(writeName)}: {`);
    lines.push('    touches: [');
    for (const touch of entry.touches) {
      lines.push(
        `      { domain: ${JSON.stringify(touch.domain)}, via: ${JSON.stringify(touch.via)}, site: ${JSON.stringify(touch.site)}, keys: ${JSON.stringify(touch.keys)}${touch.branch === undefined ? '' : `, branch: ${JSON.stringify(touch.branch)}`}${touch.predicate === undefined ? '' : `, predicate: ${JSON.stringify(touch.predicate)}`} },`,
      );
    }
    lines.push('    ],');
    lines.push('    reads: [');
    for (const read of entry.reads ?? []) {
      lines.push(
        `      { domain: ${JSON.stringify(read.domain)}, via: ${JSON.stringify(read.via)}, site: ${JSON.stringify(read.site)}, keys: ${JSON.stringify(read.keys)}, source: ${JSON.stringify(read.source)}${read.branch === undefined ? '' : `, branch: ${JSON.stringify(read.branch)}`}${read.predicate === undefined ? '' : `, predicate: ${JSON.stringify(read.predicate)}`} },`,
      );
    }
    lines.push('    ],');
    lines.push('    unresolved: [');
    for (const unresolved of entry.unresolved) {
      lines.push(
        `      { code: '${unresolved.code}', site: ${JSON.stringify(unresolved.site)}, message: ${JSON.stringify(unresolved.message)}${unresolved.domain === undefined ? '' : `, domain: ${JSON.stringify(unresolved.domain)}`} },`,
      );
    }
    lines.push('    ],');
    lines.push('  },');
  }

  lines.push('} as const;');
  return `${lines.join('\n')}\n`;
}

/** @internal */
export function diagnosticsForTouchGraph(graph: TouchGraph): TouchGraphDiagnostic[] {
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

function compareTouchSites(left: TouchSite, right: TouchSite): number {
  return (
    left.domain.localeCompare(right.domain) ||
    left.via.localeCompare(right.via) ||
    (left.branch ?? '').localeCompare(right.branch ?? '') ||
    (left.predicate ?? '').localeCompare(right.predicate ?? '') ||
    left.site.localeCompare(right.site)
  );
}

function compareReadSites(left: ReadSite, right: ReadSite): number {
  return (
    left.domain.localeCompare(right.domain) ||
    left.via.localeCompare(right.via) ||
    left.source.localeCompare(right.source) ||
    (left.branch ?? '').localeCompare(right.branch ?? '') ||
    (left.predicate ?? '').localeCompare(right.predicate ?? '') ||
    left.site.localeCompare(right.site)
  );
}
