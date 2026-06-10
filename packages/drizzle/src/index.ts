export type { DiagnosticCode } from '@jiso/core';
import { diagnosticDefinitions, type DiagnosticCode, type DiagnosticSeverity } from '@jiso/core';

export interface JisoTableAnnotation {
  domain: string;
  key?: string;
}

export function jiso(annotation: JisoTableAnnotation): JisoTableAnnotation {
  return annotation;
}

export interface TouchSite {
  branch?: string;
  domain: string;
  keys: null | string;
  predicate?: 'eq' | 'non-eq';
  site: string;
  via: string;
}

export interface ReadSite {
  branch?: string;
  domain: string;
  keys: null | string;
  predicate?: 'eq' | 'non-eq';
  site: string;
  source: string;
  via: string;
}

export interface UnresolvedWriteSite {
  code: 'FW406';
  domain?: string;
  message: string;
  site: string;
}

export interface TouchGraphEntry {
  reads?: readonly ReadSite[];
  touches: readonly TouchSite[];
  unresolved: readonly UnresolvedWriteSite[];
}

export type TouchGraph = Readonly<Record<string, TouchGraphEntry>>;

export interface DomainRegistryInput {
  table: JisoTableAnnotation & { name: string };
}

export interface WriteSummaryInput {
  branch?: string;
  operation: string;
  predicate?: 'eq' | 'non-eq';
  site: string;
  table: JisoTableAnnotation & { name: string };
  writeKey?: string;
}

export interface ReadSummaryInput {
  branch?: string;
  operation: 'insert-select' | 'update-from' | (string & {});
  predicate?: 'eq' | 'non-eq';
  readKey?: string;
  site: string;
  table: JisoTableAnnotation & { name: string };
}

export interface UnresolvedSummaryInput {
  domain?: string;
  operation: string;
  site: string;
}

export interface TouchGraphDiagnostic {
  code: DiagnosticCode;
  message: string;
  severity: DiagnosticSeverity;
  site: string;
}

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
      code: 'FW406',
      ...(site.domain === undefined ? {} : { domain: site.domain }),
      message: diagnosticDefinitions.FW406.message,
      site: site.site,
    })),
  };
}

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
        `      { code: 'FW406', site: ${JSON.stringify(unresolved.site)}, message: ${JSON.stringify(unresolved.message)}${unresolved.domain === undefined ? '' : `, domain: ${JSON.stringify(unresolved.domain)}`} },`,
      );
    }
    lines.push('    ],');
    lines.push('  },');
  }

  lines.push('} as const;');
  return `${lines.join('\n')}\n`;
}

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
        code: 'FW409' as const,
        message: diagnosticDefinitions.FW409.message,
        severity: diagnosticDefinitions.FW409.severity,
        site: touch.site,
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
