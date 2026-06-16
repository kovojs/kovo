import { diagnosticDefinitions, type DiagnosticCode, type TouchGraph } from '@kovojs/core';

import type { HarnessOperationVerifier } from './harness-operations.js';
import { createKovoTestHarness, type KovoTestContext } from './harness.js';
import type { DbVerificationConfig, ObservedDbOperation } from './verifier-observation.js';

export interface FakeDb {
  read(table: string, options?: { branch?: string; rowKey?: string }): unknown[];
  sql(statement: string): unknown[];
  write(table: string, value: unknown, options?: { branch?: string; rowKey?: string }): void;
}

export interface VerifiedFakeHarnessOptions {
  db?: FakeDb;
  request?: Record<string, unknown>;
  touchGraph?: TouchGraph;
  verification: DbVerificationConfig;
}

export interface RecordingOperationVerifier {
  coveredKey: string | undefined;
  reads: readonly string[] | undefined;
  readonly captured: readonly (readonly ObservedDbOperation[])[];
  verifier: HarnessOperationVerifier;
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

export function createVerifiedFakeHarness({
  db = createFakeDb(),
  request,
  touchGraph = {},
  verification,
}: VerifiedFakeHarnessOptions): KovoTestContext<FakeDb> {
  return createKovoTestHarness({
    db,
    ...(request === undefined ? {} : { request }),
    touchGraph,
    verification,
  });
}

export function createRecordingOperationVerifier(
  observed: readonly ObservedDbOperation[],
): RecordingOperationVerifier {
  const captured: (readonly ObservedDbOperation[])[] = [];
  const state: RecordingOperationVerifier = {
    captured,
    coveredKey: undefined,
    reads: undefined,
    verifier: {
      assertCoveredOperations(operations, touchGraphKey) {
        if (operations !== observed) throw new Error('Captured write operations were not reused.');
        state.coveredKey = touchGraphKey;
      },
      assertReadsCoveredOperations(operations, domains) {
        if (operations !== observed) throw new Error('Captured read operations were not reused.');
        state.reads = domains;
      },
      async capture(callback) {
        const result = await callback();
        captured.push(observed);
        return { observed, result };
      },
    },
  };

  return state;
}

export function deferred<T = void>(): {
  promise: Promise<T>;
  reject(reason?: unknown): void;
  resolve(value: T | PromiseLike<T>): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });

  return { promise, reject, resolve };
}

export function expectedDiagnostic(code: DiagnosticCode, detail: string): string {
  return `${code} ${expectedDiagnosticMessage(code).replace(/\.$/, '')}: ${detail}`;
}

export function expectedDiagnosticMessage(code: DiagnosticCode): string {
  return diagnosticDefinitions[code].message;
}
