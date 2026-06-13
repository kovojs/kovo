import { diagnosticDefinitions } from '@jiso/core';

import {
  StaticExportError,
  type StaticExportCompileDiagnostic,
  type StaticExportDiagnostic,
} from './static-export-types.js';

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

function staticExportCompileDiagnosticMessage(diagnostic: StaticExportCompileDiagnostic): string {
  const site = diagnostic.start
    ? `${diagnostic.fileName}:${diagnostic.start.line}:${diagnostic.start.column}`
    : diagnostic.fileName;
  const help = diagnostic.help?.trim();
  const message = `Static export refused error diagnostic ${diagnostic.code} at ${site}. ${diagnostic.message}`;

  return help ? `${message}\n${help}` : message;
}
