import type { DiagnosticCode } from '@jiso/core';

export interface StaticExportArtifact {
  body: string;
  headers: Record<string, string>;
  path: string;
  status: number;
}

export interface StaticExportClientModuleArtifact {
  body: string;
  headers: Record<string, string>;
  href: string;
  path: string;
  status: number;
}

export interface StaticExportAssetInput {
  contentType?: string;
  headers?: HeadersInit;
  path: string;
  source: string | URL;
}

export interface StaticExportAssetArtifact {
  headers: Record<string, string>;
  path: string;
  source: string;
  status: number;
}

export interface StaticExportDiagnostic {
  code: DiagnosticCode | 'FW229';
  message: string;
  routePath: string;
}

export interface StaticExportCompileDiagnostic {
  code: DiagnosticCode;
  fileName: string;
  help?: string;
  message: string;
  start?: { column: number; line: number };
}

export type StaticExportHtmlPathStyle = 'directory' | 'flat';

export class StaticExportError extends Error {
  readonly code: DiagnosticCode | 'FW229';
  readonly diagnostics: readonly StaticExportDiagnostic[];

  constructor(diagnostics: readonly StaticExportDiagnostic[]) {
    super(
      diagnostics.length === 1
        ? diagnostics[0]?.message
        : `FW229 static export found ${diagnostics.length} non-exportable routes.`,
    );
    this.name = 'StaticExportError';
    this.code = diagnostics[0]?.code ?? 'FW229';
    this.diagnostics = diagnostics;
  }
}

export function staticExportDiagnostic(routePath: string, message: string): StaticExportDiagnostic {
  return { code: 'FW229', message, routePath };
}

export function sortedHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(
    [...headers.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}
