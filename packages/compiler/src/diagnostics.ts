import { diagnosticDefinitions, type DiagnosticCode, type DiagnosticSeverity } from '@kovojs/core';

/**
 * @internal A teaching diagnostic the compiler emits during lowering (KV### code, severity,
 * message, source site, optional fix help). Carried inside {@link CompileResult}; in-repo
 * consumers read it but it is not part of the app-author surface (SPEC.md §5.2 rule 5).
 */
export interface CompilerDiagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  fileName: string;
  help?: string;
  length?: number;
  start?: SourcePosition;
}

/** @internal 1-based line/column source position carried by a {@link CompilerDiagnostic}. */
export interface SourcePosition {
  column: number;
  line: number;
}

export function diagnosticFor(
  fileName: string,
  code: DiagnosticCode,
  source?: string,
  offset?: number,
  length?: number,
): CompilerDiagnostic {
  const definition = diagnosticDefinitions[code];
  const help = 'help' in definition ? definition.help : undefined;
  return {
    code,
    fileName,
    ...(help === undefined ? {} : { help }),
    ...(source !== undefined && offset !== undefined
      ? {
          ...(length === undefined ? {} : { length }),
          start: offsetToPosition(source, offset),
        }
      : {}),
    message: definition.message,
    severity: definition.severity,
  };
}

export function offsetToPosition(source: string, offset: number): SourcePosition {
  const prefix = source.slice(0, Math.max(0, offset));
  const lineBreaks = prefix.match(/\n/g);
  const line = (lineBreaks?.length ?? 0) + 1;
  const lastLineBreak = prefix.lastIndexOf('\n');
  const column = offset - lastLineBreak;

  return { column, line };
}
