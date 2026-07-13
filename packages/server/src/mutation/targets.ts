import type { JsonValue } from '@kovojs/core';
import { buildQueryDelta, queryDeltaIsSmaller } from '@kovojs/core/internal/query-delta';
import { changeRecordTouchesQueryInstance, type ChangeRecord } from '../change-record.js';
import { generatedFragmentHtmlValue } from '../html.js';
import {
  readQueryInstanceKey,
  readQueryVersion,
  recordQueryRuntimeWarnings,
  runQuery,
  type QueryDefinition,
} from '../query.js';
import { runtimeLiveTargetQueryBindings, type RuntimeRegistryFacts } from '../registry-facts.js';
import { renderFragmentWireHtml, renderQueryWireHtml } from '../wire-html.js';
import type {
  FragmentRenderer,
  LiveTargetRenderer,
  MutationLiveTarget,
  MutationLiveTargetDescriptor,
  MutationWireRequest,
} from '../mutation-wire.js';
import type { LiveTargetAttestationAuthority } from '../live-target-app-identity.js';
import { revealUntrustedRequestValue } from '../untrusted-request-body.js';
import {
  securityJsonStringify,
  securityStringIncludes,
  securityStringSlice,
  securityStringStartsWith,
} from '../response-security-intrinsics.js';
import {
  witnessArrayAppend,
  createWitnessMap,
  createWitnessSet,
  witnessIsArray,
  witnessMapForEach,
  witnessMapGet,
  witnessMapHas,
  witnessMapSet,
  witnessSetAdd,
  witnessSetHas,
} from '../security-witness-intrinsics.js';
import type { QueryRerun } from './definition.js';

export function queriesToRerun(
  queries: readonly QueryDefinition<string, unknown, unknown, unknown>[],
  changes: readonly ChangeRecord[],
  input: unknown,
): QueryRerun[] {
  const queryInput = mutationTargetInput(input);
  const reruns: QueryRerun[] = [];
  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    const queryDefinition = queries[queryIndex]!;
    if (
      !someChange(changes, (change) => queryTouchedByChange(queryDefinition, change, queryInput))
    ) {
      continue;
    }
    const instanceKey = readQueryInstanceKey(queryDefinition, queryInput);
    witnessArrayAppend(
      reruns,
      {
        ...(instanceKey === undefined ? {} : { instanceKey }),
        key: queryDefinition.key,
        ...(instanceKey !== undefined &&
        someChange(changes, (change) =>
          queryChangeInvalidatesWholeQueryInstance(queryDefinition, change, queryInput),
        )
          ? { whole: true }
          : {}),
      },
      'Server packages/server/src/mutation/targets.ts collection',
    );
  }
  return reruns;
}

function queryTouchedByChange(
  queryDefinition: QueryDefinition<string, unknown, unknown, unknown>,
  change: ChangeRecord,
  input: unknown,
): boolean {
  if (!queryReadsDomain(queryDefinition, change.domain)) return false;

  const instanceKey = readQueryInstanceKey(queryDefinition, input);
  if (instanceKey === undefined) return true;

  return changeRecordTouchesQueryInstance(change, instanceKey);
}

function queryChangeInvalidatesWholeQueryInstance(
  queryDefinition: QueryDefinition<string, unknown, unknown, unknown>,
  change: ChangeRecord,
  input: unknown,
): boolean {
  if (!queryReadsDomain(queryDefinition, change.domain)) return false;
  if ((change.keys?.length ?? 0) === 0) return true;

  // bugz-3 M9: a relational/multi-table domain change cannot be narrowed to a row
  // delta against a single-row reader's instance key (its keys are in a different
  // table's identity space), so rerun the whole instance — SPEC §10.1.
  if (change.crossTable) return true;

  const instanceKey = readQueryInstanceKey(queryDefinition, input);
  if (instanceKey === undefined) return true;

  return canonicalSingleRowQueryValue(change.domain, instanceKey) === undefined;
}

function canonicalSingleRowQueryValue(domain: string, instanceKey: string): string | undefined {
  const prefix = `${domain}:`;
  if (!securityStringStartsWith(instanceKey, prefix)) return undefined;

  const value = securityStringSlice(instanceKey, prefix.length);
  if (!value || securityStringIncludes(value, ':')) return undefined;
  return value;
}

export async function renderQueryChunks(
  queries: readonly QueryDefinition<string, unknown, unknown, unknown>[],
  rerunQueries: readonly QueryRerun[],
  defaultInput: unknown,
  request: unknown,
  changes: readonly ChangeRecord[],
  maxListItems?: number,
  settles?: readonly string[],
): Promise<string[]> {
  const chunks: string[] = [];

  // Build affectedKeysByDomain once for all queries in this render pass (SPEC §9.1.1).
  const affectedKeysByDomain = buildAffectedKeysByDomain(changes);

  for (let queryIndex = 0; queryIndex < queries.length; queryIndex += 1) {
    const queryDefinition = queries[queryIndex]!;
    const rerunQuery = findQueryRerun(rerunQueries, (target) =>
      queryMatchesRerun(queryDefinition, defaultInput, target),
    );
    if (rerunQuery === undefined) {
      continue;
    }

    const input = mutationTargetInput(rerunQuery.input ?? defaultInput);
    const result = await runQuery(queryDefinition, input, request, {
      ...(maxListItems === undefined ? {} : { maxListItems }),
      trustedInput: true,
    });
    if (!result.ok) {
      throw new Error(`Rerun query failed: ${queryDefinition.key}`, { cause: result });
    }
    recordQueryRuntimeWarnings(request, result.warnings);

    witnessArrayAppend(
      chunks,
      renderQueryRerunChunk(queryDefinition, input, result.value, affectedKeysByDomain, settles),
      'Server packages/server/src/mutation/targets.ts collection',
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

  const input = mutationTargetInput(target.input ?? defaultInput);
  return readQueryInstanceKey(queryDefinition, input) === target.instanceKey;
}

function renderQueryRerunChunk<const Key extends string, Value, Input, Request>(
  queryDefinition: QueryDefinition<Key, Value, Input, Request>,
  input: Input,
  value: Value,
  affectedKeysByDomain: ReadonlyMap<string, ReadonlySet<string>>,
  settles?: readonly string[],
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
        settles,
        value: delta,
        version,
      });
    }
  }

  return renderQueryWireHtml({
    key,
    name: queryDefinition.key,
    settles,
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
  const map = createWitnessMap<string, Set<string>>();
  for (let changeIndex = 0; changeIndex < changes.length; changeIndex += 1) {
    const change = changes[changeIndex]!;
    if (change.crossTable) continue;
    if (!change.keys || change.keys.length === 0) continue;
    const set = witnessMapGet(map, change.domain) ?? createWitnessSet<string>();
    for (let keyIndex = 0; keyIndex < change.keys.length; keyIndex += 1) {
      witnessSetAdd(set, change.keys[keyIndex]!);
    }
    witnessMapSet(map, change.domain, set);
  }
  return map;
}

export async function renderFragmentChunks(
  renderers: readonly FragmentRenderer[],
  targets: readonly string[],
  input: unknown,
): Promise<string[]> {
  assertUniqueFragmentRendererTargets(renderers);
  const wanted = createWitnessSet<string>();
  for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
    witnessSetAdd(wanted, targets[targetIndex]!);
  }
  const chunks: string[] = [];

  for (let rendererIndex = 0; rendererIndex < renderers.length; rendererIndex += 1) {
    const renderer = renderers[rendererIndex]!;
    // SPEC §9.1: the client names the live DOM targets to refresh. An omitted/empty target list
    // means no app-authored fragment work, never wildcard authority over the renderer registry.
    if (!witnessSetHas(wanted, renderer.target)) continue;

    try {
      witnessArrayAppend(
        chunks,
        renderFragmentWireHtml({
          html: generatedFragmentHtmlValue(await renderer.render(input)),
          mode: renderer.mode,
          stylesheets: renderer.stylesheets,
          target: renderer.target,
        }),
        'Server packages/server/src/mutation/targets.ts collection',
      );
    } catch (error) {
      if (!renderer.errorBoundary) throw error;

      const target = renderer.errorBoundary.target ?? renderer.target;
      witnessArrayAppend(
        chunks,
        renderFragmentWireHtml({
          errorBoundary: renderer.target,
          html: generatedFragmentHtmlValue(await renderer.errorBoundary.render(error, input)),
          stylesheets: renderer.stylesheets,
          target,
        }),
        'Server packages/server/src/mutation/targets.ts collection',
      );
    }
  }

  return chunks;
}

/** @internal Render server-owned live-target fragment wire for dev HMR and mutation refresh. */
export async function renderLiveTargetChunks<Request>(
  renderers: readonly LiveTargetRenderer<Request>[],
  targets: readonly MutationLiveTargetDescriptor[],
  buildToken: string,
  attestationAuthority: LiveTargetAttestationAuthority,
  input: unknown,
  request: Request,
  csrf: MutationWireRequest<Request>['csrf'] | undefined,
  maxListItems?: number,
): Promise<string[]> {
  const renderersByComponent = liveTargetRenderersByComponent(renderers);
  const chunks: string[] = [];

  for (let targetIndex = 0; targetIndex < targets.length; targetIndex += 1) {
    const target = targets[targetIndex]!;
    const renderer = witnessMapGet(renderersByComponent, target.component);
    if (!renderer) continue;

    try {
      const html = await renderer.render({
        attestationAuthority,
        buildToken,
        ...(csrf === undefined ? {} : { csrf }),
        input,
        ...(maxListItems === undefined ? {} : { maxListItems }),
        props: target.props,
        request,
        target: target.target,
      });
      witnessArrayAppend(
        chunks,
        renderFragmentWireHtml({
          html: generatedFragmentHtmlValue(html),
          stylesheets: renderer.stylesheets,
          target: target.target,
        }),
        'Server packages/server/src/mutation/targets.ts collection',
      );
    } catch (error) {
      if (!renderer.errorBoundary) throw error;

      const boundaryTarget = renderer.errorBoundary.target ?? target.target;
      witnessArrayAppend(
        chunks,
        renderFragmentWireHtml({
          errorBoundary: target.target,
          html: generatedFragmentHtmlValue(await renderer.errorBoundary.render(error, input)),
          stylesheets: renderer.stylesheets,
          target: boundaryTarget,
        }),
        'Server packages/server/src/mutation/targets.ts collection',
      );
    }
  }

  return chunks;
}

function liveTargetRenderersByComponent<Request>(
  renderers: readonly LiveTargetRenderer<Request>[],
): ReadonlyMap<string, LiveTargetRenderer<Request>> {
  const byComponent = createWitnessMap<string, LiveTargetRenderer<Request>>();
  for (let index = 0; index < renderers.length; index += 1) {
    const renderer = renderers[index]!;
    if (witnessMapHas(byComponent, renderer.component)) {
      throw new TypeError(
        `Duplicate live-target renderer component ${securityJsonStringify(renderer.component)} reached the render sink.`,
      );
    }
    witnessMapSet(byComponent, renderer.component, renderer);
  }
  return byComponent;
}

interface MutationResponseSelectionInput<Request> {
  changes: readonly ChangeRecord[];
  fragmentRenderers: readonly FragmentRenderer[];
  liveTargetDescriptors: readonly MutationLiveTargetDescriptor[];
  liveTargetRenderers: readonly LiveTargetRenderer<Request>[];
  liveTargets?: readonly MutationLiveTarget[] | undefined;
  registryFacts: RuntimeRegistryFacts<Request>;
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
  const affectedQueryTokens = createWitnessSet<string>();
  for (let queryIndex = 0; queryIndex < input.rerunQueries.length; queryIndex += 1) {
    const query = input.rerunQueries[queryIndex]!;
    const tokens = queryRerunTokens(query);
    if (someLiveTarget(liveTargets, (target) => depsMatch(target, tokens))) {
      addQueryTokens(affectedQueryTokens, tokens);
    }
  }

  const descriptorReruns = createWitnessMap<MutationLiveTargetDescriptor, readonly QueryRerun[]>();
  for (
    let descriptorIndex = 0;
    descriptorIndex < input.liveTargetDescriptors.length;
    descriptorIndex += 1
  ) {
    const descriptor = input.liveTargetDescriptors[descriptorIndex]!;
    const renderer = witnessMapGet(liveRenderersByComponent, descriptor.component);
    const liveTarget = findLiveTarget(liveTargets, (target) => target.target === descriptor.target);
    if (!renderer || liveTarget === undefined) continue;

    const reruns = liveTargetDescriptorQueryReruns(
      renderer,
      descriptor,
      input.registryFacts,
      input.changes,
    );
    witnessMapSet(descriptorReruns, descriptor, reruns);

    if (someQueryRerun(reruns, (query) => depsMatch(liveTarget, queryRerunTokens(query)))) {
      for (let queryIndex = 0; queryIndex < reruns.length; queryIndex += 1) {
        addQueryTokens(affectedQueryTokens, queryRerunTokens(reruns[queryIndex]!));
      }
    }
  }

  const rerunQueries: QueryRerun[] = [];
  for (let queryIndex = 0; queryIndex < input.rerunQueries.length; queryIndex += 1) {
    const query = input.rerunQueries[queryIndex]!;
    const tokens = queryRerunTokens(query);
    if (
      someLiveTarget(
        liveTargets,
        (target) =>
          targetIsPlanCovered(target.target, renderersByTarget) && depsMatch(target, tokens),
      )
    ) {
      witnessArrayAppend(
        rerunQueries,
        query,
        'Server packages/server/src/mutation/targets.ts collection',
      );
    }
  }

  const fragmentTargets: string[] = [];
  for (let rendererIndex = 0; rendererIndex < input.fragmentRenderers.length; rendererIndex += 1) {
    const renderer = input.fragmentRenderers[rendererIndex]!;
    if (renderer.updateCoverage === 'plan') continue;
    const liveTarget = findLiveTarget(liveTargets, (target) => target.target === renderer.target);
    if (liveTarget !== undefined && depsMatch(liveTarget, affectedQueryTokens)) {
      witnessArrayAppend(
        fragmentTargets,
        renderer.target,
        'Server packages/server/src/mutation/targets.ts collection',
      );
    }
  }

  const liveTargetDescriptors: MutationLiveTargetDescriptor[] = [];
  for (
    let descriptorIndex = 0;
    descriptorIndex < input.liveTargetDescriptors.length;
    descriptorIndex += 1
  ) {
    const descriptor = input.liveTargetDescriptors[descriptorIndex]!;
    if (witnessMapHas(renderersByTarget, descriptor.target)) continue;
    const renderer = witnessMapGet(liveRenderersByComponent, descriptor.component);
    if (!renderer) continue;
    const liveTarget = findLiveTarget(liveTargets, (target) => target.target === descriptor.target);
    if (liveTarget === undefined) continue;
    const reruns = witnessMapGet(descriptorReruns, descriptor) ?? [];
    if (someQueryRerun(reruns, (query) => depsMatch(liveTarget, queryRerunTokens(query)))) {
      witnessArrayAppend(
        liveTargetDescriptors,
        descriptor,
        'Server packages/server/src/mutation/targets.ts collection',
      );
    }
  }

  const mergedReruns: QueryRerun[] = [];
  appendArray(mergedReruns, rerunQueries);
  for (let index = 0; index < liveTargetDescriptors.length; index += 1) {
    appendArray(mergedReruns, witnessMapGet(descriptorReruns, liveTargetDescriptors[index]!) ?? []);
  }

  return {
    fragmentTargets,
    liveTargetDescriptors,
    rerunQueries: mergeQueryReruns(mergedReruns),
  };
}

function liveTargetDescriptorQueryReruns<Request>(
  renderer: LiveTargetRenderer<Request>,
  descriptor: MutationLiveTargetDescriptor,
  registryFacts: RuntimeRegistryFacts<Request>,
  changes: readonly ChangeRecord[],
): QueryRerun[] {
  const bindings = runtimeLiveTargetQueryBindings(renderer, registryFacts);
  const reruns: QueryRerun[] = [];

  for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += 1) {
    const binding = bindings[bindingIndex]!;
    const props = mutationTargetInput(descriptor.props) as Record<string, unknown>;
    const queryInput = mutationTargetInput(binding.args ? binding.args(props) : undefined);
    if (!someChange(changes, (change) => queryTouchedByChange(binding.query, change, queryInput))) {
      continue;
    }

    const instanceKey = readQueryInstanceKey(binding.query, queryInput);
    witnessArrayAppend(
      reruns,
      {
        input: queryInput,
        ...(instanceKey === undefined ? {} : { instanceKey }),
        key: binding.query.key,
        ...(instanceKey !== undefined &&
        someChange(changes, (change) =>
          queryChangeInvalidatesWholeQueryInstance(binding.query, change, queryInput),
        )
          ? { whole: true }
          : {}),
      },
      'Server packages/server/src/mutation/targets.ts collection',
    );
  }

  return mergeQueryReruns(reruns);
}

function mutationTargetInput(value: unknown): unknown {
  return revealUntrustedRequestValue(value, 'validated mutation target query input');
}

function mergeQueryReruns(queries: readonly QueryRerun[]): QueryRerun[] {
  const byIdentity = createWitnessMap<string, QueryRerun>();
  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index]!;
    const identity = `${query.key}\0${query.instanceKey ?? ''}`;
    const existing = witnessMapGet(byIdentity, identity);
    witnessMapSet(byIdentity, identity, {
      ...query,
      ...(existing?.input !== undefined && query.input === undefined
        ? { input: existing.input }
        : {}),
      ...((existing?.whole === true || query.whole === true) && query.instanceKey !== undefined
        ? { whole: true }
        : {}),
    });
  }
  const merged: QueryRerun[] = [];
  witnessMapForEach(byIdentity, (query) => {
    witnessArrayAppend(merged, query, 'Server packages/server/src/mutation/targets.ts collection');
  });
  return merged;
}

function addQueryTokens(target: Set<string>, tokens: readonly string[]): void {
  for (let index = 0; index < tokens.length; index += 1) {
    witnessSetAdd(target, tokens[index]!);
  }
}

function fragmentRenderersByTarget(
  renderers: readonly FragmentRenderer[],
): ReadonlyMap<string, FragmentRenderer> {
  assertUniqueFragmentRendererTargets(renderers);
  const byTarget = createWitnessMap<string, FragmentRenderer>();
  for (let index = 0; index < renderers.length; index += 1) {
    const renderer = renderers[index]!;
    witnessMapSet(byTarget, renderer.target, renderer);
  }
  return byTarget;
}

function assertUniqueFragmentRendererTargets(renderers: readonly FragmentRenderer[]): void {
  const seen = createWitnessSet<string>();
  for (let index = 0; index < renderers.length; index += 1) {
    const target = renderers[index]!.target;
    if (witnessSetHas(seen, target)) {
      throw new TypeError(
        `Generated mutation fragment renderer target ${target} is registered more than once.`,
      );
    }
    witnessSetAdd(seen, target);
  }
}

function targetIsPlanCovered(
  target: string,
  renderersByTarget: ReadonlyMap<string, FragmentRenderer>,
): boolean {
  return (
    witnessMapGet(renderersByTarget, target)?.updateCoverage === 'plan' ||
    !witnessMapHas(renderersByTarget, target)
  );
}

function queryRerunTokens(query: QueryRerun): string[] {
  if (query.instanceKey === undefined) return [query.key];
  return query.whole === true ? [query.key, query.instanceKey] : [query.instanceKey];
}

function depsMatch(
  liveTarget: MutationLiveTarget,
  queryTokens: ReadonlySet<string> | readonly string[],
): boolean {
  const tokens = witnessIsArray(queryTokens) ? createTokenSet(queryTokens) : queryTokens;
  for (let index = 0; index < liveTarget.deps.length; index += 1) {
    if (witnessSetHas(tokens, liveTarget.deps[index]!)) return true;
  }
  return false;
}

function queryReadsDomain(
  queryDefinition: QueryDefinition<string, unknown, unknown, unknown>,
  domain: string,
): boolean {
  const reads = queryDefinition.reads ?? [];
  for (let index = 0; index < reads.length; index += 1) {
    if (reads[index]!.key === domain) return true;
  }
  return false;
}

function someChange(
  changes: readonly ChangeRecord[],
  predicate: (change: ChangeRecord) => boolean,
): boolean {
  for (let index = 0; index < changes.length; index += 1) {
    if (predicate(changes[index]!)) return true;
  }
  return false;
}

function someLiveTarget(
  targets: readonly MutationLiveTarget[],
  predicate: (target: MutationLiveTarget) => boolean,
): boolean {
  for (let index = 0; index < targets.length; index += 1) {
    if (predicate(targets[index]!)) return true;
  }
  return false;
}

function someQueryRerun(
  queries: readonly QueryRerun[],
  predicate: (query: QueryRerun) => boolean,
): boolean {
  for (let index = 0; index < queries.length; index += 1) {
    if (predicate(queries[index]!)) return true;
  }
  return false;
}

function findQueryRerun(
  queries: readonly QueryRerun[],
  predicate: (query: QueryRerun) => boolean,
): QueryRerun | undefined {
  for (let index = 0; index < queries.length; index += 1) {
    const query = queries[index]!;
    if (predicate(query)) return query;
  }
  return undefined;
}

function findLiveTarget(
  targets: readonly MutationLiveTarget[],
  predicate: (target: MutationLiveTarget) => boolean,
): MutationLiveTarget | undefined {
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]!;
    if (predicate(target)) return target;
  }
  return undefined;
}

function appendArray<Value>(target: Value[], source: readonly Value[]): void {
  for (let index = 0; index < source.length; index += 1) {
    witnessArrayAppend(
      target,
      source[index]!,
      'Server packages/server/src/mutation/targets.ts collection',
    );
  }
}

function createTokenSet(values: readonly string[]): ReadonlySet<string> {
  const set = createWitnessSet<string>();
  for (let index = 0; index < values.length; index += 1) witnessSetAdd(set, values[index]!);
  return set;
}
