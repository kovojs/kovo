import type { DiagnosticCode, RegisteredDiagnostic } from '@kovojs/core';
import {
  assertRegisteredDiagnostic,
  createRegisteredDiagnostic,
  deriveRegisteredDiagnostic,
  diagnosticDefinitions,
  isDiagnosticCode,
  isRegisteredDiagnostic,
} from '@kovojs/core/internal/diagnostics';
import { buildOwnDataProperty, snapshotBuildArray } from './build-security-intrinsics.js';
import { witnessArrayAppend, witnessFreeze } from './security-witness-intrinsics.js';

/**
 * Route-level diagnostic emitted when a request-shell route cannot be represented
 * by static export output (SPEC §11.3).
 *
 * `concretePath`, when present, names the single non-exportable concrete URL the
 * diagnostic describes (e.g. a param route's individual `staticPaths` entry). SPEC
 * §9.5 `skip` policy publishes the exportable subset, so skip must suppress only the
 * exact non-exportable concrete target — not every sibling that shares the route
 * pattern (`routePath`). Route-level diagnostics with no single concrete target leave
 * `concretePath` undefined.
 */
export interface StaticExportDiagnostic extends RegisteredDiagnostic<DiagnosticCode> {
  concretePath?: string;
  routePath: string;
}

/** Severity label used when formatting static-export diagnostics. */
export type StaticExportDiagnosticSeverity = 'ERROR' | 'WARN';

/**
 * A compiler-emitted diagnostic evaluated against the static-export gate (SPEC §11.3):
 * its `code`, source `fileName`, optional `start` position and `help`, and `message`.
 * Input to the public {@link assertStaticExportCompileDiagnostics} and
 * {@link blockingStaticExportDiagnostics}, which fail static export on error-severity codes.
 */
export interface StaticExportCompileDiagnostic extends RegisteredDiagnostic<DiagnosticCode> {
  fileName: string;
  help?: string;
  start?: { column: number; line: number };
}

/** Error thrown when static export is configured to fail on non-exportable routes. */
export class StaticExportError extends Error {
  readonly code: DiagnosticCode | 'KV229';
  readonly diagnostics: readonly StaticExportDiagnostic[];

  constructor(diagnostics: readonly StaticExportDiagnostic[]) {
    const registered = registeredStaticExportDiagnostics(diagnostics, 'static-export error');
    super(
      registered.length === 1
        ? registered[0]!.message
        : `KV229 static export found ${registered.length} non-exportable routes.`,
    );
    this.name = 'StaticExportError';
    this.code = registered[0]?.code ?? 'KV229';
    this.diagnostics = witnessFreeze(registered);
  }
}

export function staticExportDiagnostic(
  routePath: string,
  message: string,
  concretePath?: string,
): StaticExportDiagnostic {
  return concretePath === undefined
    ? createRegisteredDiagnostic('KV229', { routePath }, { message })
    : createRegisteredDiagnostic('KV229', { concretePath, routePath }, { message });
}

/**
 * @internal Static-export diagnostic shape guard for framework export tooling (SPEC.md §9.5).
 */
export function isStaticExportDiagnostic(value: unknown): value is StaticExportDiagnostic {
  if (!isRegisteredDiagnostic(value)) return false;
  const concretePath = (value as StaticExportDiagnostic | null)?.concretePath;
  const code = (value as StaticExportDiagnostic | null)?.code;
  return (
    typeof value === 'object' &&
    value !== null &&
    isDiagnosticCode(code) &&
    typeof (value as StaticExportDiagnostic).message === 'string' &&
    typeof (value as StaticExportDiagnostic).routePath === 'string' &&
    (value as StaticExportDiagnostic).severity === diagnosticDefinitions[code].severity &&
    (concretePath === undefined || typeof concretePath === 'string')
  );
}

/**
 * @internal Static-export diagnostic error guard for framework export tooling (SPEC.md §9.5).
 */
export function isStaticExportDiagnosticError(
  error: unknown,
): error is { diagnostics: readonly StaticExportDiagnostic[] } {
  if (typeof error !== 'object' || error === null) return false;
  let diagnostics: ReturnType<typeof buildOwnDataProperty>;
  try {
    diagnostics = buildOwnDataProperty(error, 'diagnostics', 'static-export error diagnostics');
  } catch {
    return false;
  }
  if (!diagnostics.present) return false;
  let source: readonly unknown[];
  try {
    source = snapshotBuildArray(
      diagnostics.value as readonly unknown[],
      'static-export error diagnostics',
    );
  } catch {
    return false;
  }
  for (let index = 0; index < source.length; index += 1) {
    if (!isStaticExportDiagnostic(source[index])) return false;
  }
  return true;
}

/**
 * @internal Stable static-export diagnostic formatter for framework export tooling (SPEC.md §9.5).
 */
export function formatStaticExportDiagnostic(
  diagnostic: StaticExportDiagnostic,
  severity: StaticExportDiagnosticSeverity,
): string {
  assertRegisteredDiagnostic(diagnostic, 'Static-export diagnostic formatter input');
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
  const source = snapshotBuildArray(diagnostics, 'static-export diagnostics');
  const formatted: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    witnessArrayAppend(
      formatted,
      formatStaticExportDiagnostic(source[index]!, severity),
      'Server packages/server/src/static-export-diagnostics.ts collection',
    );
  }
  return formatted;
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
  // SPEC §6.6: app evaluation precedes export, so this gate must not dispatch through a mutable
  // Array.filter/map. Snapshot the complete compiler ledger and construct blocking rows directly.
  const source = snapshotBuildArray(diagnostics, 'static-export compile diagnostics');
  const blocking: StaticExportDiagnostic[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const diagnostic = source[index]!;
    assertRegisteredDiagnostic(diagnostic, `Static-export compile diagnostics[${index}]`);
    if (diagnosticDefinitions[diagnostic.code].severity !== 'error') continue;
    witnessArrayAppend(
      blocking,
      blockingStaticExportDiagnostic(diagnostic),
      'Server packages/server/src/static-export-diagnostics.ts collection',
    );
  }
  return blocking;
}

function registeredStaticExportDiagnostics(
  diagnostics: readonly StaticExportDiagnostic[],
  label: string,
): StaticExportDiagnostic[] {
  const source = snapshotBuildArray(diagnostics, `${label} diagnostics`);
  const registered: StaticExportDiagnostic[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const diagnostic = source[index];
    assertRegisteredDiagnostic(diagnostic, `${label} diagnostics[${index}]`);
    witnessArrayAppend(
      registered,
      diagnostic,
      'Server packages/server/src/static-export-diagnostics.ts collection',
    );
  }
  return registered;
}

function blockingStaticExportDiagnostic(
  diagnostic: StaticExportCompileDiagnostic,
): StaticExportDiagnostic {
  return deriveRegisteredDiagnostic(
    diagnostic,
    { routePath: diagnostic.fileName },
    { message: staticExportCompileDiagnosticMessage(diagnostic) },
  );
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
