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
  domain: string;
  keys: null | string;
  site: string;
  via: string;
}

export interface UnresolvedWriteSite {
  code: 'FW406';
  message: string;
  site: string;
}

export interface TouchGraphEntry {
  touches: TouchSite[];
  unresolved: UnresolvedWriteSite[];
}

export type TouchGraph = Record<string, TouchGraphEntry>;

export interface WriteSummaryInput {
  operation: string;
  site: string;
  table: JisoTableAnnotation & { name: string };
  writeKey?: string;
}

export interface UnresolvedSummaryInput {
  operation: string;
  site: string;
}

export interface TouchGraphDiagnostic {
  code: DiagnosticCode;
  message: string;
  severity: DiagnosticSeverity;
  site: string;
}

export function createTouchGraphEntry(input: {
  unresolved?: readonly UnresolvedSummaryInput[];
  writes?: readonly WriteSummaryInput[];
}): TouchGraphEntry {
  return {
    touches: [...(input.writes ?? [])]
      .map((write) => ({
        domain: write.table.domain,
        keys: write.writeKey ?? null,
        site: write.site,
        via: write.table.name,
      }))
      .sort(compareTouchSites),
    unresolved: [...(input.unresolved ?? [])].map((site) => ({
      code: 'FW406',
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
        `      { domain: ${JSON.stringify(touch.domain)}, via: ${JSON.stringify(touch.via)}, site: ${JSON.stringify(touch.site)}, keys: ${JSON.stringify(touch.keys)} },`,
      );
    }
    lines.push('    ],');
    lines.push('    unresolved: [');
    for (const unresolved of entry.unresolved) {
      lines.push(
        `      { code: 'FW406', site: ${JSON.stringify(unresolved.site)}, message: ${JSON.stringify(unresolved.message)} },`,
      );
    }
    lines.push('    ],');
    lines.push('  },');
  }

  lines.push('} as const;');
  return `${lines.join('\n')}\n`;
}

export function diagnosticsForTouchGraph(graph: TouchGraph): TouchGraphDiagnostic[] {
  return Object.values(graph).flatMap((entry) =>
    entry.unresolved.map((unresolved) => ({
      code: unresolved.code,
      message: unresolved.message,
      severity: diagnosticDefinitions[unresolved.code].severity,
      site: unresolved.site,
    })),
  );
}

function compareTouchSites(left: TouchSite, right: TouchSite): number {
  return (
    left.domain.localeCompare(right.domain) ||
    left.via.localeCompare(right.via) ||
    left.site.localeCompare(right.site)
  );
}
