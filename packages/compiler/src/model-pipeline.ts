import {
  applySourceReplacementsWithOffsetMap,
  type SourceOffsetMap,
  type SourceReplacement,
} from './shared.js';

export interface ModelForSourceChangeOptions<Model> {
  fileName: string;
  nextSource: string;
  parse: (fileName: string, source: string) => Model;
  previousModel: Model;
  previousSource: string;
}

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

export function modelForSourceChange<Model>(options: ModelForSourceChangeOptions<Model>): Model {
  return options.nextSource === options.previousSource
    ? options.previousModel
    : options.parse(options.fileName, options.nextSource);
}

export function componentPipelineState<Model>(
  fileName: string,
  source: string,
  model: Model,
): ComponentPipelineState<Model> {
  return { fileName, model, source };
}

export function lowerComponentPipelineSource<Model>(
  previous: ComponentPipelineState<Model>,
  source: string,
  parse: (fileName: string, source: string) => Model,
): ComponentPipelineState<Model> {
  return {
    fileName: previous.fileName,
    model: modelForSourceChange({
      fileName: previous.fileName,
      nextSource: source,
      parse,
      previousModel: previous.model,
      previousSource: previous.source,
    }),
    source,
  };
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
    state: lowerComponentPipelineSource(previous, patch.source, parse),
  };
}
