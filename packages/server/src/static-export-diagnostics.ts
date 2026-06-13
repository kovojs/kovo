import { diagnosticDefinitions, type DiagnosticCode } from '@jiso/core';

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

export function assertStaticExportCompileDiagnostics(
  diagnostics: readonly StaticExportCompileDiagnostic[],
): void {
  const blockingDiagnostics = blockingStaticExportDiagnostics(diagnostics);
  if (blockingDiagnostics.length > 0) throw new StaticExportError(blockingDiagnostics);
}

export function blockingStaticExportDiagnostics(
  diagnostics: readonly StaticExportCompileDiagnostic[],
): StaticExportDiagnostic[] {
  // SPEC §11.3: error diagnostics block static export before output is written.
  return diagnostics
    .filter((diagnostic) => diagnosticDefinitions[diagnostic.code].severity === 'error')
    .map((diagnostic) => ({
      code: diagnostic.code,
      message: staticExportCompileDiagnosticMessage(diagnostic),
      routePath: diagnostic.fileName,
    }));
}

function stableDiagnosticText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function staticExportCompileDiagnosticMessage(diagnostic: StaticExportCompileDiagnostic): string {
  const site = diagnostic.start
    ? `${diagnostic.fileName}:${diagnostic.start.line}:${diagnostic.start.column}`
    : diagnostic.fileName;
  const help = diagnostic.help?.trim();
  const message = `Static export refused error diagnostic ${diagnostic.code} at ${site}. ${diagnostic.message}`;

  return help ? `${message}\n${help}` : message;
}
