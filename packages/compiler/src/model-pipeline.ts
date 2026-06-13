import {
  applySourceReplacements,
  applySourceReplacementsWithOffsetMap,
  type SourceOffsetMap,
  type SourceReplacement,
} from './shared.js';

export interface ComponentPipelineState<Model> {
  fileName: string;
  model: Model;
  source: string;
}

interface ComponentPipelinePatchResult<Model> {
  sourceOffsetMap: SourceOffsetMap;
  state: ComponentPipelineState<Model>;
}

interface ComponentModelPatchOptions {
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
  options: ComponentModelPatchOptions = {},
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

export function applyComponentPipelineEmitPatches(
  previous: Pick<ComponentPipelineState<unknown>, 'source'>,
  replacements: readonly SourceReplacement[],
): string {
  return applySourceReplacements(previous.source, replacements);
}
