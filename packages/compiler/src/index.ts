export type { DiagnosticCode } from '@jiso/core';

export interface CompileResult {
  files: Map<string, string>;
}

export function createEmptyCompileResult(): CompileResult {
  return { files: new Map<string, string>() };
}
