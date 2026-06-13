import { diagnosticDefinitions, type DiagnosticCode, type TouchGraph } from '@jiso/core';

import { createJisoTestHarness, type JisoTestContext } from './harness.js';
import type { DbVerificationConfig } from './verifier-observation.js';

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
}: VerifiedFakeHarnessOptions): JisoTestContext<FakeDb> {
  return createJisoTestHarness({
    db,
    ...(request === undefined ? {} : { request }),
    touchGraph,
    verification,
  });
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
