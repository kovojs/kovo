import type { JsonValue } from '@kovojs/core';
import { buildQueryDelta, queryDeltaIsSmaller } from '@kovojs/core/internal/query-delta';
import { changeRecordTouchesQueryInstance, type ChangeRecord } from '../change-record.js';
import {
  readQueryInstanceKey,
  readQueryVersion,
  runQuery,
  type QueryDefinition,
} from '../query.js';
import { renderFragmentWireHtml, renderQueryWireHtml } from '../wire-html.js';
import type {
  FragmentRenderer,
  LiveTargetRenderer,
  MutationLiveTarget,
  MutationLiveTargetDescriptor,
  MutationWireRequest,
} from '../mutation-wire.js';
import type { QueryRerun } from './definition.js';

export function queriesToRerun(
  queries: readonly QueryDefinition<string, unknown, unknown, unknown>[],
  changes: readonly ChangeRecord[],
  input: unknown,
): QueryRerun[] {
  return queries
    .filter((queryDefinition) =>
      changes.some((change) => queryTouchedByChange(queryDefinition, change, input)),
    )
    .map((queryDefinition) => {
      const instanceKey = readQueryInstanceKey(queryDefinition, input);
      return {
        ...(instanceKey === undefined ? {} : { instanceKey }),
        key: queryDefinition.key,
        ...(instanceKey !== undefined &&
        changes.some((change) =>
          queryChangeInvalidatesWholeQueryInstance(queryDefinition, change, input),
        )
          ? { whole: true }
          : {}),
      };
    });
}

function queryTouchedByChange(
  queryDefinition: QueryDefinition<string, unknown, unknown, unknown>,
  change: ChangeRecord,
  input: unknown,
): boolean {
  if (!(queryDefinition.reads ?? []).some((read) => read.key === change.domain)) return false;

  const instanceKey = readQueryInstanceKey(queryDefinition, input);
  if (instanceKey === undefined) return true;

  return changeRecordTouchesQueryInstance(change, instanceKey);
}

function queryChangeInvalidatesWholeQueryInstance(
  queryDefinition: QueryDefinition<string, unknown, unknown, unknown>,
  change: ChangeRecord,
  input: unknown,
): boolean {
  if (!(queryDefinition.reads ?? []).some((read) => read.key === change.domain)) return false;
  if ((change.keys?.length ?? 0) === 0) return true;

  const instanceKey = readQueryInstanceKey(queryDefinition, input);
  if (instanceKey === undefined) return true;

  return canonicalSingleRowQueryValue(change.domain, instanceKey) === undefined;
}

function canonicalSingleRowQueryValue(domain: string, instanceKey: string): string | undefined {
  const prefix = `${domain}:`;
  if (!instanceKey.startsWith(prefix)) return undefined;

  const value = instanceKey.slice(prefix.length);
  if (!value || value.includes(':')) return undefined;
  return value;
}

export async function renderQueryChunks(
  queries: readonly QueryDefinition<string, unknown, unknown, unknown>[],
  rerunQueries: readonly QueryRerun[],
  defaultInput: unknown,
  request: unknown,
  changes: readonly ChangeRecord[],
): Promise<string[]> {
  const chunks: string[] = [];

  // Build affectedKeysByDomain once for all queries in this render pass (SPEC §9.1.1).
  const affectedKeysByDomain = buildAffectedKeysByDomain(changes);

  for (const queryDefinition of queries) {
    const rerunQuery = rerunQueries.find((target) =>
      queryMatchesRerun(queryDefinition, defaultInput, target),
    );
    if (rerunQuery === undefined) {
      continue;
    }

    const input = rerunQuery.input ?? defaultInput;
    const result = await runQuery(queryDefinition, input, request);
    if (!result.ok) {
      throw new Error(`Rerun query failed: ${queryDefinition.key}`, { cause: result });
    }

    chunks.push(
      renderQueryRerunChunk(queryDefinition, result.input, result.value, affectedKeysByDomain),
    );
  }

  return chunks;
}

function queryMatchesRerun(
  queryDefinition: QueryDefinition<string, unknown, unknown, unknown>,
  defaultInput: unknown,
  target: QueryRerun,
): boolean {
  if (queryDefinition.key !== target.key) return false;

  const input = target.input ?? defaultInput;
  return readQueryInstanceKey(queryDefinition, input) === target.instanceKey;
}

function renderQueryRerunChunk<const Key extends string, Value, Input, Request>(
  queryDefinition: QueryDefinition<Key, Value, Input, Request>,
  input: Input,
  value: Value,
  affectedKeysByDomain: ReadonlyMap<string, ReadonlySet<string>>,
): string {
  const key = readQueryInstanceKey(queryDefinition, input);
  const version = readQueryVersion(queryDefinition, input, value);

  // Automatic full-vs-delta selection (SPEC §9.1.1): attempt a delta only when the
  // query has delta-eligible collections, then ship whichever is smaller.
  if (queryDefinition.delta && queryDefinition.delta.length > 0) {
    const delta = buildQueryDelta(value as JsonValue, affectedKeysByDomain, queryDefinition.delta);
    if (delta !== undefined && queryDeltaIsSmaller(delta, value as JsonValue)) {
      return renderQueryWireHtml({
        delta: true,
        key,
        name: queryDefinition.key,
        value: delta,
        version,
      });
    }
  }

  return renderQueryWireHtml({
    key,
    name: queryDefinition.key,
    value,
    version,
  });
}

/**
 * Build the `affectedKeysByDomain` map consumed by `buildQueryDelta` (SPEC §9.1.1).
 * For each change record that carries explicit `keys`, those keys are added to the
 * set for that domain.
 */
function buildAffectedKeysByDomain(
  changes: readonly ChangeRecord[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const map = new Map<string, Set<string>>();
  for (const change of changes) {
    if (!change.keys || change.keys.length === 0) continue;
    const set = map.get(change.domain) ?? new Set<string>();
    for (const key of change.keys) set.add(key);
    map.set(change.domain, set);
  }
  return map;
}

export async function renderFragmentChunks(
  renderers: readonly FragmentRenderer[],
  targets: readonly string[],
  input: unknown,
): Promise<string[]> {
  const wanted = new Set(targets);
  const chunks: string[] = [];

  for (const renderer of renderers) {
    if (wanted.size > 0 && !wanted.has(renderer.target)) continue;

    try {
      chunks.push(
        renderFragmentWireHtml({
          html: await renderer.render(input),
          mode: renderer.mode,
          stylesheets: renderer.stylesheets,
          target: renderer.target,
        }),
      );
    } catch (error) {
      if (!renderer.errorBoundary) throw error;

      const target = renderer.errorBoundary.target ?? renderer.target;
      chunks.push(
        renderFragmentWireHtml({
          errorBoundary: renderer.target,
          html: await renderer.errorBoundary.render(error, input),
          stylesheets: renderer.stylesheets,
          target,
        }),
      );
    }
  }

  return chunks;
}

/** @internal Render server-owned live-target fragment wire for dev HMR and mutation refresh. */
export async function renderLiveTargetChunks<Request>(
  renderers: readonly LiveTargetRenderer<Request>[],
  targets: readonly MutationLiveTargetDescriptor[],
  input: unknown,
  request: Request,
  csrf: MutationWireRequest<Request>['csrf'] | undefined,
): Promise<string[]> {
  const renderersByComponent = liveTargetRenderersByComponent(renderers);
  const chunks: string[] = [];

  for (const target of targets) {
    const renderer = renderersByComponent.get(target.component);
    if (!renderer) continue;

    try {
      chunks.push(
        renderFragmentWireHtml({
          html: await renderer.render({
            ...(csrf === undefined ? {} : { csrf }),
            input,
            props: target.props,
            request,
            target: target.target,
          }),
          stylesheets: renderer.stylesheets,
          target: target.target,
        }),
      );
    } catch (error) {
      if (!renderer.errorBoundary) throw error;

      const boundaryTarget = renderer.errorBoundary.target ?? target.target;
      chunks.push(
        renderFragmentWireHtml({
          errorBoundary: target.target,
          html: await renderer.errorBoundary.render(error, input),
          stylesheets: renderer.stylesheets,
          target: boundaryTarget,
        }),
      );
    }
  }

  return chunks;
}

function liveTargetRenderersByComponent<Request>(
  renderers: readonly LiveTargetRenderer<Request>[],
): ReadonlyMap<string, LiveTargetRenderer<Request>> {
  const byComponent = new Map<string, LiveTargetRenderer<Request>>();
  for (const renderer of renderers) {
    if (!byComponent.has(renderer.component)) byComponent.set(renderer.component, renderer);
  }
  return byComponent;
}

interface MutationResponseSelectionInput<Request> {
  changes: readonly ChangeRecord[];
  fragmentRenderers: readonly FragmentRenderer[];
  liveTargetDescriptors: readonly MutationLiveTargetDescriptor[];
  liveTargetRenderers: readonly LiveTargetRenderer<Request>[];
  liveTargets?: readonly MutationLiveTarget[] | undefined;
  queryDefinitions: readonly QueryDefinition<string, unknown, unknown, unknown>[];
  rerunQueries: readonly QueryRerun[];
  targets: readonly string[];
}

export interface MutationResponseSelection {
  fragmentTargets: readonly string[];
  liveTargetDescriptors: readonly MutationLiveTargetDescriptor[];
  rerunQueries: readonly QueryRerun[];
}

export function selectMutationResponseTargets<Request>(
  input: MutationResponseSelectionInput<Request>,
): MutationResponseSelection {
  if (input.liveTargets === undefined) {
    return {
      fragmentTargets: input.targets,
      liveTargetDescriptors: [],
      rerunQueries: input.rerunQueries,
    };
  }

  if (input.liveTargets.length === 0) {
    return { fragmentTargets: [], liveTargetDescriptors: [], rerunQueries: [] };
  }

  const liveTargets = input.liveTargets;
  const renderersByTarget = fragmentRenderersByTarget(input.fragmentRenderers);
  const liveRenderersByComponent = liveTargetRenderersByComponent(input.liveTargetRenderers);
  const affectedQueryTokens = new Set<string>();
  for (const query of input.rerunQueries) {
    const tokens = queryRerunTokens(query);
    if (liveTargets.some((target) => depsMatch(target, tokens))) {
      addQueryTokens(affectedQueryTokens, tokens);
    }
  }

  const descriptorReruns = new Map<MutationLiveTargetDescriptor, readonly QueryRerun[]>();
  for (const descriptor of input.liveTargetDescriptors) {
    const renderer = liveRenderersByComponent.get(descriptor.component);
    const liveTarget = liveTargets.find((target) => target.target === descriptor.target);
    if (!renderer || liveTarget === undefined) continue;

    const reruns = liveTargetDescriptorQueryReruns(
      renderer,
      descriptor,
      input.queryDefinitions,
      input.changes,
    );
    descriptorReruns.set(descriptor, reruns);

    if (reruns.some((query) => depsMatch(liveTarget, queryRerunTokens(query)))) {
      for (const query of reruns) addQueryTokens(affectedQueryTokens, queryRerunTokens(query));
    }
  }

  const rerunQueries = input.rerunQueries.filter((query) => {
    const tokens = queryRerunTokens(query);
    return liveTargets.some(
      (target) =>
        targetIsPlanCovered(target.target, renderersByTarget) && depsMatch(target, tokens),
    );
  });

  const fragmentTargets = input.fragmentRenderers
    .filter((renderer) => {
      if (renderer.updateCoverage === 'plan') return false;
      const liveTarget = liveTargets.find((target) => target.target === renderer.target);
      return liveTarget !== undefined && depsMatch(liveTarget, affectedQueryTokens);
    })
    .map((renderer) => renderer.target);

  const liveTargetDescriptors = input.liveTargetDescriptors.filter((descriptor) => {
    if (renderersByTarget.has(descriptor.target)) return false;
    const renderer = liveRenderersByComponent.get(descriptor.component);
    if (!renderer) return false;
    const liveTarget = liveTargets.find((target) => target.target === descriptor.target);
    if (liveTarget === undefined) return false;

    const reruns = descriptorReruns.get(descriptor) ?? [];
    return reruns.some((query) => depsMatch(liveTarget, queryRerunTokens(query)));
  });

  return {
    fragmentTargets,
    liveTargetDescriptors,
    rerunQueries: mergeQueryReruns([
      ...rerunQueries,
      ...liveTargetDescriptors.flatMap((descriptor) => descriptorReruns.get(descriptor) ?? []),
    ]),
  };
}

interface LiveTargetRendererQueryBinding {
  args?: (props: Record<string, unknown>) => unknown;
  query: QueryDefinition<string, unknown, unknown, unknown>;
}

type LiveTargetRendererWithQueryBindings<Request> = LiveTargetRenderer<Request> & {
  queryBindings?: readonly LiveTargetRendererQueryBinding[];
};

function liveTargetDescriptorQueryReruns<Request>(
  renderer: LiveTargetRenderer<Request>,
  descriptor: MutationLiveTargetDescriptor,
  queryDefinitions: readonly QueryDefinition<string, unknown, unknown, unknown>[],
  changes: readonly ChangeRecord[],
): QueryRerun[] {
  const bindings = liveTargetRendererQueryBindings(renderer, queryDefinitions);
  const reruns: QueryRerun[] = [];

  for (const binding of bindings) {
    const queryInput = binding.args ? binding.args(descriptor.props) : undefined;
    if (!changes.some((change) => queryTouchedByChange(binding.query, change, queryInput))) {
      continue;
    }

    const instanceKey = readQueryInstanceKey(binding.query, queryInput);
    reruns.push({
      input: queryInput,
      ...(instanceKey === undefined ? {} : { instanceKey }),
      key: binding.query.key,
      ...(instanceKey !== undefined &&
      changes.some((change) =>
        queryChangeInvalidatesWholeQueryInstance(binding.query, change, queryInput),
      )
        ? { whole: true }
        : {}),
    });
  }

  return mergeQueryReruns(reruns);
}

function liveTargetRendererQueryBindings<Request>(
  renderer: LiveTargetRenderer<Request>,
  queryDefinitions: readonly QueryDefinition<string, unknown, unknown, unknown>[],
): readonly LiveTargetRendererQueryBinding[] {
  const rendererWithBindings = renderer as LiveTargetRendererWithQueryBindings<Request>;
  if (rendererWithBindings.queryBindings) return rendererWithBindings.queryBindings;
  if (renderer.queryDefinitions) {
    return renderer.queryDefinitions.map((queryDefinition) => ({ query: queryDefinition }));
  }

  return (renderer.queries ?? []).flatMap((queryKey) => {
    const queryDefinition = queryDefinitions.find((candidate) => candidate.key === queryKey);
    return queryDefinition === undefined ? [] : [{ query: queryDefinition }];
  });
}

function mergeQueryReruns(queries: readonly QueryRerun[]): QueryRerun[] {
  const byIdentity = new Map<string, QueryRerun>();
  for (const query of queries) {
    const identity = `${query.key}\0${query.instanceKey ?? ''}`;
    const existing = byIdentity.get(identity);
    byIdentity.set(identity, {
      ...query,
      ...(existing?.input !== undefined && query.input === undefined
        ? { input: existing.input }
        : {}),
      ...((existing?.whole === true || query.whole === true) && query.instanceKey !== undefined
        ? { whole: true }
        : {}),
    });
  }
  return [...byIdentity.values()];
}

function addQueryTokens(target: Set<string>, tokens: readonly string[]): void {
  for (const token of tokens) target.add(token);
}

function fragmentRenderersByTarget(
  renderers: readonly FragmentRenderer[],
): ReadonlyMap<string, FragmentRenderer> {
  const byTarget = new Map<string, FragmentRenderer>();
  for (const renderer of renderers) {
    const existing = byTarget.get(renderer.target);
    if (existing && existing.updateCoverage !== 'plan') continue;
    byTarget.set(renderer.target, renderer);
  }
  return byTarget;
}

function targetIsPlanCovered(
  target: string,
  renderersByTarget: ReadonlyMap<string, FragmentRenderer>,
): boolean {
  return renderersByTarget.get(target)?.updateCoverage === 'plan' || !renderersByTarget.has(target);
}

function queryRerunTokens(query: QueryRerun): string[] {
  if (query.instanceKey === undefined) return [query.key];
  return query.whole === true ? [query.key, query.instanceKey] : [query.instanceKey];
}

function depsMatch(
  liveTarget: MutationLiveTarget,
  queryTokens: ReadonlySet<string> | readonly string[],
): boolean {
  const tokens = queryTokens instanceof Set ? queryTokens : new Set(queryTokens);
  return liveTarget.deps.some((dep) => tokens.has(dep));
}
