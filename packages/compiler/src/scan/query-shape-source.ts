import * as ts from 'typescript';

import {
  mergeQueryShapeFactSets as mergeQueryShapeFactSetsCore,
  outputSchemaQueryShapeFactsFromProject as outputSchemaQueryShapeFactsFromProjectCore,
  outputSchemaQueryShapeFactsFromSource as outputSchemaQueryShapeFactsFromSourceCore,
} from '@kovojs/core/internal/query-shape-source';

import type { QueryShapeFact } from '../types.js';

/** @internal Merge projected query-shape facts from multiple analyzers. */
export function mergeQueryShapeFactSets(
  primary: readonly QueryShapeFact[],
  secondary: readonly QueryShapeFact[],
): QueryShapeFact[] {
  return mergeQueryShapeFactSetsCore(primary, secondary) as QueryShapeFact[];
}

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
