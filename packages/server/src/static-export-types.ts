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

export type StaticExportInventoryItem =
  | {
      headers: Record<string, string>;
      kind: 'route-document';
      path: string;
      status: number;
    }
  | {
      headers: Record<string, string>;
      href: string;
      kind: 'client-module';
      path: string;
      status: number;
    }
  | {
      headers: Record<string, string>;
      kind: 'static-asset';
      path: string;
      source: string;
      status: number;
    };

export interface StaticExportDiagnostic {
  code: DiagnosticCode | 'FW229';
  message: string;
  routePath: string;
}

export type StaticExportDiagnosticSeverity = 'ERROR' | 'WARN';

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

export function isStaticExportDiagnostic(value: unknown): value is StaticExportDiagnostic {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StaticExportDiagnostic).code === 'string' &&
    typeof (value as StaticExportDiagnostic).message === 'string' &&
    typeof (value as StaticExportDiagnostic).routePath === 'string'
  );
}

export function isStaticExportDiagnosticError(
  error: unknown,
): error is { diagnostics: readonly StaticExportDiagnostic[] } {
  return (
    typeof error === 'object' &&
    error !== null &&
    Array.isArray((error as { diagnostics?: unknown }).diagnostics) &&
    (error as { diagnostics: unknown[] }).diagnostics.every(isStaticExportDiagnostic)
  );
}

export function formatStaticExportDiagnostic(
  diagnostic: StaticExportDiagnostic,
  severity: StaticExportDiagnosticSeverity,
): string {
  return `${severity} ${diagnostic.code} route=${diagnostic.routePath} ${stableDiagnosticText(
    diagnostic.message,
  )}`;
}

export function formatStaticExportDiagnostics(
  diagnostics: readonly StaticExportDiagnostic[],
  severity: StaticExportDiagnosticSeverity,
): string[] {
  return diagnostics.map((diagnostic) => formatStaticExportDiagnostic(diagnostic, severity));
}

// SPEC §9.5: dry-run export task wiring inspects the same route/module/asset set
// that a write export would publish, without reaching into replay internals.
export function staticExportInventory(result: {
  artifacts: readonly StaticExportArtifact[];
  assets: readonly StaticExportAssetArtifact[];
  clientModules: readonly StaticExportClientModuleArtifact[];
}): StaticExportInventoryItem[] {
  return [
    ...result.artifacts.map((artifact) => ({
      headers: artifact.headers,
      kind: 'route-document' as const,
      path: artifact.path,
      status: artifact.status,
    })),
    ...result.clientModules.map((artifact) => ({
      headers: artifact.headers,
      href: artifact.href,
      kind: 'client-module' as const,
      path: artifact.path,
      status: artifact.status,
    })),
    ...result.assets.map((artifact) => ({
      headers: artifact.headers,
      kind: 'static-asset' as const,
      path: artifact.path,
      source: artifact.source,
      status: artifact.status,
    })),
  ];
}

export function sortedHeaders(headers: Headers): Record<string, string> {
  return Object.fromEntries(
    [...headers.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function stableDiagnosticText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
