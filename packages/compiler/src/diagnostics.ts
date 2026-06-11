import { diagnosticDefinitions, type DiagnosticCode, type DiagnosticSeverity } from '@jiso/core';

export interface CompilerDiagnostic {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  fileName: string;
  help?: string;
  length?: number;
  start?: SourcePosition;
}

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
  return {
    code,
    fileName,
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
