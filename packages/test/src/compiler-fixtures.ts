export interface CompilerDiagnosticLike {
  code: string;
  fileName?: string;
  help?: string;
  message: string;
  severity: string;
  [field: string]: unknown;
}

export interface CompilerDiagnosticFact {
  code: string;
  fileName?: string;
  help?: string;
  message: string;
  severity: string;
}

export interface CompilerUpdateCoverageLike {
  component?: string;
  componentName?: string;
  detail?: string;
  position: string;
  query: string;
  status: string;
  [field: string]: unknown;
}

export interface CompilerUpdateCoverageFact {
  component: string;
  detail?: string;
  position: string;
  query: string;
  status: string;
}

export function compilerDiagnosticFacts(
  diagnostics: readonly CompilerDiagnosticLike[],
  codes?: readonly string[],
): CompilerDiagnosticFact[] {
  const codeSet = codes ? new Set(codes) : undefined;
  return diagnostics
    .filter((diagnostic) => codeSet === undefined || codeSet.has(diagnostic.code))
    .map((diagnostic) => ({
      code: diagnostic.code,
      ...(diagnostic.fileName === undefined ? {} : { fileName: diagnostic.fileName }),
      ...(diagnostic.help === undefined ? {} : { help: diagnostic.help }),
      message: diagnostic.message,
      severity: diagnostic.severity,
    }));
}

export function compilerUpdateCoverageFacts(
  coverage: readonly CompilerUpdateCoverageLike[],
): CompilerUpdateCoverageFact[] {
  return coverage.map((entry) => ({
    component: entry.component ?? entry.componentName ?? '',
    ...(entry.detail === undefined ? {} : { detail: entry.detail }),
    position: entry.position,
    query: entry.query,
    status: entry.status,
  }));
}
