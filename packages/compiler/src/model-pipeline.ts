import {
  applySourceReplacementsWithOffsetMap,
  type SourceOffsetMap,
  type SourceReplacement,
} from './shared.js';

export interface ComponentPipelineState<Model> {
  fileName: string;
  model: Model;
  source: string;
}

export interface ComponentPipelinePatchResult<Model> {
  sourceOffsetMap: SourceOffsetMap;
  state: ComponentPipelineState<Model>;
}

export interface ComponentPipelinePatchOptions {
  prefix?: string;
}

export function componentPipelineState<Model>(
  fileName: string,
  source: string,
  model: Model,
): ComponentPipelineState<Model> {
  return { fileName, model, source };
}

export function lowerComponentPipelinePatches<Model>(
  previous: ComponentPipelineState<Model>,
  replacements: readonly SourceReplacement[],
  parse: (fileName: string, source: string) => Model,
  options: ComponentPipelinePatchOptions = {},
): ComponentPipelinePatchResult<Model> {
  const patch = applySourceReplacementsWithOffsetMap(
    previous.source,
    replacements,
    options.prefix ?? '',
  );
  return {
    sourceOffsetMap: patch.sourceOffsetMap,
    state: {
      fileName: previous.fileName,
      model:
        patch.source === previous.source ? previous.model : parse(previous.fileName, patch.source),
      source: patch.source,
    },
  };
}
