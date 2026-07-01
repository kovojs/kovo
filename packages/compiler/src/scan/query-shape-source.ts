import * as ts from 'typescript';

import {
  mergeQueryShapeFactSets,
  outputSchemaQueryShapeFactsFromProject as outputSchemaQueryShapeFactsFromProjectCore,
  outputSchemaQueryShapeFactsFromSource as outputSchemaQueryShapeFactsFromSourceCore,
} from '@kovojs/core/internal/query-shape-source';

import type { QueryShapeFact } from '../types.js';

export { mergeQueryShapeFactSets };

/**
 * @internal Extract declared non-Drizzle query output schemas into compiler query-shape facts.
 */
export function outputSchemaQueryShapeFactsFromSource(
  fileName: string,
  source: string,
): readonly QueryShapeFact[] {
  return outputSchemaQueryShapeFactsFromSourceCore(
    ts,
    fileName,
    source,
  ) as readonly QueryShapeFact[];
}

/** @internal Extract declared non-Drizzle query output schemas with project identity resolution. */
export function outputSchemaQueryShapeFactsFromProject(
  files: readonly { fileName: string; source: string }[],
  scanFiles: readonly { fileName: string; source: string }[] = files,
): readonly QueryShapeFact[] {
  return outputSchemaQueryShapeFactsFromProjectCore(
    ts,
    files,
    scanFiles,
  ) as readonly QueryShapeFact[];
}
