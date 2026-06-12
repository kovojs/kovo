import { diagnosticDefinitions, type DiagnosticCode } from '@jiso/core';

export interface FakeDb {
  read(table: string, options?: { branch?: string; rowKey?: string }): unknown[];
  sql(statement: string): unknown[];
  write(table: string, value: unknown, options?: { branch?: string; rowKey?: string }): void;
}

export function createFakeDb(): FakeDb {
  const tables = new Map<string, unknown[]>();

  return {
    read(table) {
      return tables.get(table) ?? [];
    },
    sql() {
      return [];
    },
    write(table, value) {
      tables.set(table, [...(tables.get(table) ?? []), value]);
    },
  };
}

export function expectedDiagnostic(code: DiagnosticCode, detail: string): string {
  return `${code} ${expectedDiagnosticMessage(code).replace(/\.$/, '')}: ${detail}`;
}

export function expectedDiagnosticMessage(code: DiagnosticCode): string {
  return diagnosticDefinitions[code].message;
}
