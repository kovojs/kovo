import {
  applySourceReplacementPlan,
  applySourceReplacementPlanWithOffsetMap,
  SourceReplacementAccumulator,
  type SourceOffsetMap,
  type SourceReplacementPlan,
  type SourceReplacementOwner,
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
  owner?: SourceReplacementOwner;
  prefix?: string;
}

export function componentPipelineState<Model>(
  fileName: string,
  source: string,
  model: Model,
): ComponentPipelineState<Model> {
  return { fileName, model, source };
}

export function applyModelPatchPass<Model>(
  previous: ComponentPipelineState<Model>,
  replacements: readonly SourceReplacement[],
  parse: (fileName: string, source: string) => Model,
  options: ComponentModelPatchOptions = {},
): ComponentPipelinePatchResult<Model> {
  const accumulator = new SourceReplacementAccumulator();
  accumulator.add(options.owner ?? { phase: 'model-patch', writer: 'anonymous' }, replacements);
  return applyModelPatchPlanPass(
    previous,
    accumulator.plan(previous.source.length, options.prefix?.length ?? 0),
    parse,
    options,
  );
}

export function applyModelPatchPlanPass<Model>(
  previous: ComponentPipelineState<Model>,
  plan: SourceReplacementPlan,
  parse: (fileName: string, source: string) => Model,
  options: Omit<ComponentModelPatchOptions, 'owner'> = {},
): ComponentPipelinePatchResult<Model> {
  const patch = applySourceReplacementPlanWithOffsetMap(previous.source, plan, options.prefix ?? '');
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

export function applyTerminalEmitPatches(
  previous: Pick<ComponentPipelineState<unknown>, 'source'>,
  replacements: readonly SourceReplacement[],
  owner: SourceReplacementOwner = { phase: 'terminal-emit', writer: 'anonymous' },
): string {
  const accumulator = new SourceReplacementAccumulator();
  accumulator.add(owner, replacements);
  return applySourceReplacementPlan(previous.source, accumulator.plan(previous.source.length));
}
