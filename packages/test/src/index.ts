export type { DiagnosticCode } from '@jiso/core';

export interface JisoTestContext {
  exec: unknown;
  page: unknown;
  db: unknown;
}

export function jisoTest(_name: string, _fn: (ctx: JisoTestContext) => void | Promise<void>): void {
  throw new Error('jisoTest is not implemented yet.');
}
