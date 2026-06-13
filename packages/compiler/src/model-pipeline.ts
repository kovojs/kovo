import {
  applySourceReplacementsWithOffsetMap,
  composeSourceOffsetMaps,
  identitySourceOffsetMap,
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

export interface ComponentPipelineEmitPatchResult {
  source: string;
  sourceOffsetMap: SourceOffsetMap;
}

export interface ComponentPipelinePatchOptions {
  prefix?: string;
}

export interface ComponentPipelineLowering {
  prefix?: string;
  replacements: readonly SourceReplacement[];
}

export interface ComponentPipelineSequenceResult<
  Model,
> extends ComponentPipelinePatchResult<Model> {
  steps: ComponentPipelinePatchResult<Model>[];
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

export function lowerComponentPipelineSequence<Model>(
  initial: ComponentPipelineState<Model>,
  lowerings: readonly ((previous: ComponentPipelineState<Model>) => ComponentPipelineLowering)[],
  parse: (fileName: string, source: string) => Model,
): ComponentPipelineSequenceResult<Model> {
  const steps: ComponentPipelinePatchResult<Model>[] = [];
  let current = initial;
  let sourceOffsetMap = identitySourceOffsetMap(initial.source.length);

  for (const lower of lowerings) {
    const lowering = lower(current);
    const step = lowerComponentPipelinePatches(
      current,
      lowering.replacements,
      parse,
      lowering.prefix === undefined ? {} : { prefix: lowering.prefix },
    );
    steps.push(step);
    sourceOffsetMap = composeSourceOffsetMaps(sourceOffsetMap, step.sourceOffsetMap);
    current = step.state;
  }

  return { sourceOffsetMap, state: current, steps };
}

export function applyComponentPipelineEmitPatches(
  previous: Pick<ComponentPipelineState<unknown>, 'source'>,
  replacements: readonly SourceReplacement[],
  options: ComponentPipelinePatchOptions = {},
): ComponentPipelineEmitPatchResult {
  return applySourceReplacementsWithOffsetMap(previous.source, replacements, options.prefix ?? '');
}
