import type { CompileAppGraphOptions, CompileAppGraphResult } from './types.js';
import { deriveAppGraph as deriveAppGraphInternal } from './internal-graph.js';

/**
 * Derive an app-level component/registry graph from compiled component facts.
 *
 * Build scripts use this public helper to turn compiler-owned component facts
 * into generated registries (SPEC.md §5.2). Lower-level graph fact helpers stay
 * behind `@kovojs/compiler/internal/graph`.
 */
export function deriveAppGraph(options: CompileAppGraphOptions): CompileAppGraphResult {
  return deriveAppGraphInternal(options);
}
