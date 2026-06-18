import { diagnosticDefinitions, type DiagnosticCode } from '@kovojs/core';

/**
 * Route-level diagnostic emitted when a request-shell route cannot be represented
 * by static export output (SPEC §11.3).
 */
export interface StaticExportDiagnostic {
  code: DiagnosticCode | 'KV229';
  message: string;
  routePath: string;
}

/** Severity label used when formatting static-export diagnostics. */
export type StaticExportDiagnosticSeverity = 'ERROR' | 'WARN';

export interface StaticExportCompileDiagnostic {
  code: DiagnosticCode;
  fileName: string;
  help?: string;
  message: string;
  start?: { column: number; line: number };
}

/** Error thrown when static export is configured to fail on non-exportable routes. */
export class StaticExportError extends Error {
  readonly code: DiagnosticCode | 'KV229';
  readonly diagnostics: readonly StaticExportDiagnostic[];

  constructor(diagnostics: readonly StaticExportDiagnostic[]) {
    super(
      diagnostics.length === 1
        ? diagnostics[0]?.message
        : `KV229 static export found ${diagnostics.length} non-exportable routes.`,
    );
    this.name = 'StaticExportError';
    this.code = diagnostics[0]?.code ?? 'KV229';
    this.diagnostics = diagnostics;
  }
}

export function staticExportDiagnostic(routePath: string, message: string): StaticExportDiagnostic {
  return { code: 'KV229', message, routePath };
}

/**
 * @internal Static-export diagnostic shape guard for framework export tooling (SPEC.md §9.5).
 */
export function isStaticExportDiagnostic(value: unknown): value is StaticExportDiagnostic {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StaticExportDiagnostic).code === 'string' &&
    typeof (value as StaticExportDiagnostic).message === 'string' &&
    typeof (value as StaticExportDiagnostic).routePath === 'string'
  );
}

/**
 * @internal Static-export diagnostic error guard for framework export tooling (SPEC.md §9.5).
 */
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

/**
 * @internal Stable static-export diagnostic formatter for framework export tooling (SPEC.md §9.5).
 */
export function formatStaticExportDiagnostic(
  diagnostic: StaticExportDiagnostic,
  severity: StaticExportDiagnosticSeverity,
): string {
  return `${severity} ${diagnostic.code} route=${diagnostic.routePath} ${stableDiagnosticText(
    diagnostic.message,
  )}`;
}

/**
 * @internal Stable static-export diagnostic formatter for framework export tooling (SPEC.md §9.5).
 */
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
