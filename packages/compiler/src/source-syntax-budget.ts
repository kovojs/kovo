import type * as TS from 'typescript';
import { typescriptRuntime as typescript } from './ts-api.js';

const nativeCreateSourceFile = typescript.createSourceFile;
const nativeForEachChild = typescript.forEachChild;

/** @internal General pre-compile syntax budget result for finite machine adapters. */
export interface CompilerSourceSyntaxBudgetResult {
  readonly maxDepth: number;
  readonly nodeCount: number;
  readonly ok: boolean;
  readonly reason?: 'depth' | 'nodes' | 'parser';
}

/**
 * Count the complete TypeScript structural AST iteratively before expensive compiler passes.
 *
 * Subsystem-specific semantic budgets still own fail-closed verdicts. This outer budget instead
 * gives finite machine transports a whole-source CPU/memory ceiling before lowering runs.
 *
 * @internal
 */
export function compilerSourceSyntaxBudget(
  fileName: string,
  source: string,
  limits: Readonly<{ maxDepth: number; maxNodes: number }>,
): CompilerSourceSyntaxBudgetResult {
  if (
    !Number.isSafeInteger(limits.maxDepth) ||
    limits.maxDepth < 1 ||
    !Number.isSafeInteger(limits.maxNodes) ||
    limits.maxNodes < 1
  ) {
    throw new TypeError('Compiler source syntax limits must be positive safe integers.');
  }
  let sourceFile: TS.SourceFile;
  try {
    sourceFile = nativeCreateSourceFile(
      fileName,
      source,
      typescript.ScriptTarget.Latest,
      false,
      typescript.ScriptKind.TSX,
    );
  } catch {
    // Some malformed operator chains exhaust TypeScript's recursive parser before an AST exists.
    // Keep that implementation detail inside the compiler and return one closed finite verdict.
    return { maxDepth: 0, nodeCount: 0, ok: false, reason: 'parser' };
  }
  const pending: Array<{ depth: number; node: TS.Node }> = [{ depth: 0, node: sourceFile }];
  let maxDepth = 0;
  let nodeCount = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    nodeCount += 1;
    if (nodeCount > limits.maxNodes) {
      return { maxDepth, nodeCount, ok: false, reason: 'nodes' };
    }
    if (current.depth > maxDepth) maxDepth = current.depth;
    if (current.depth > limits.maxDepth) {
      return { maxDepth, nodeCount, ok: false, reason: 'depth' };
    }
    nativeForEachChild(current.node, (child) => {
      pending.push({ depth: current.depth + 1, node: child });
    });
  }

  return { maxDepth, nodeCount, ok: true };
}
