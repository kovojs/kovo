import {
  deriveCacheInfluenceManifestEntry,
  type CacheInfluenceDerivationInput,
  type CacheInfluenceExternalDataVersionInput,
  type CacheInfluenceManifestEntry,
} from '@kovojs/core/internal/cache-influence';

import {
  compilerArrayAppend,
  compilerCreateMap,
  compilerJsonStringify,
  compilerMapForEach,
  compilerMapGet,
  compilerMapSet,
  compilerSetOwnDataProperty,
  compilerSnapshotDenseArray,
} from './compiler-security-intrinsics.js';
import type { ComponentModuleModel } from './scan/parse.js';
import type { MutationHandlerModel } from './scan/model.js';

/** Compiler-owned cache-influence entries for query and raw endpoint roots (SPEC §9.4). */
export function componentCacheInfluenceFacts(
  model: ComponentModuleModel,
): CacheInfluenceManifestEntry[] {
  const inputs = compilerCreateMap<string, CacheInfluenceDerivationInput>();
  appendHandlerInputs(inputs, model.queryHandlers, 'Query cache-influence handlers');
  appendHandlerInputs(inputs, model.endpointHandlers, 'Endpoint cache-influence handlers');
  const entries: CacheInfluenceManifestEntry[] = [];
  compilerMapForEach(inputs, (input) => {
    insertSortedCacheEntry(entries, deriveCacheInfluenceManifestEntry(input));
  });
  return entries;
}

function appendHandlerInputs(
  target: Map<string, CacheInfluenceDerivationInput>,
  handlers: readonly MutationHandlerModel[],
  label: string,
): void {
  const snapshot = compilerSnapshotDenseArray(handlers, label);
  for (let index = 0; index < snapshot.length; index += 1) {
    const handler = snapshot[index]!;
    if (handler.cacheInfluence === undefined) continue;
    const input = inputWithSemanticInfluences(handler.cacheInfluence, handler);
    const previous = compilerMapGet(target, input.root);
    compilerMapSet(
      target,
      input.root,
      previous === undefined ? input : mergeInputs(previous, input),
    );
  }
}

function inputWithSemanticInfluences(
  input: CacheInfluenceDerivationInput,
  handler: MutationHandlerModel,
): CacheInfluenceDerivationInput {
  const influences = mutableInfluences(input.influences);
  const semantic = handler.securitySemanticRoot;
  if (semantic === undefined) appendUnique(influences.unclassified, 'missing finite semantic root');
  if ((handler.securityOperationViolations?.length ?? 0) > 0) {
    appendUnique(influences.unclassified, 'finite semantic root has closed violations');
  }
  const traces = compilerSnapshotDenseArray(semantic?.traces ?? [], 'Cache semantic traces');
  for (let index = 0; index < traces.length; index += 1) {
    const trace = traces[index]!;
    if (trace.verdict === 'closed') {
      appendUnique(influences.unclassified, `semantic:${trace.reason}`);
      continue;
    }
    switch (trace.sink.kind) {
      case 'server.authority.scope':
        influences.principal = true;
        break;
      case 'server.database.read':
      case 'server.database.trusted-sql':
      case 'server.database.write':
      case 'server.egress.request':
      case 'server.storage.read':
      case 'server.storage.write':
      case 'server.task.compose':
        influences.frameworkState = true;
        break;
      case 'server.response.cookie':
        influences.cookie = true;
        break;
      case 'server.handler.root':
      case 'server.helper.call':
      case 'server.data.declassify':
      case 'server.output.trusted-html':
      case 'server.response.header':
      case 'server.response.outcome':
      case 'server.response.raw':
      case 'server.response.redirect':
        break;
    }
  }
  return {
    authored: input.authored,
    influences: immutableInfluences(influences),
    root: input.root,
    surface: input.surface,
  };
}

interface MutableInfluences {
  authorization?: true;
  cookie?: true;
  externalDataVersions: CacheInfluenceExternalDataVersionInput[];
  frameworkState?: true;
  principal?: true;
  requestHeaders: string[];
  secret?: true;
  session?: true;
  unclassified: string[];
  urlPath?: true;
  urlSearch?: true;
}

function mutableInfluences(source: CacheInfluenceDerivationInput['influences']): MutableInfluences {
  return {
    ...(source.authorization === true ? { authorization: true as const } : {}),
    ...(source.cookie === true ? { cookie: true as const } : {}),
    externalDataVersions: compilerSnapshotDenseArray(
      source.externalDataVersions ?? [],
      'Cache external data versions',
    ),
    ...(source.frameworkState === true ? { frameworkState: true as const } : {}),
    ...(source.principal === true ? { principal: true as const } : {}),
    requestHeaders: compilerSnapshotDenseArray(
      source.requestHeaders ?? [],
      'Cache request headers',
    ),
    ...(source.secret === true ? { secret: true as const } : {}),
    ...(source.session === true ? { session: true as const } : {}),
    unclassified: compilerSnapshotDenseArray(source.unclassified ?? [], 'Cache unclassified facts'),
    ...(source.urlPath === true ? { urlPath: true as const } : {}),
    ...(source.urlSearch === true ? { urlSearch: true as const } : {}),
  };
}

function immutableInfluences(
  source: MutableInfluences,
): CacheInfluenceDerivationInput['influences'] {
  return {
    ...(source.authorization === true ? { authorization: true as const } : {}),
    ...(source.cookie === true ? { cookie: true as const } : {}),
    ...(source.externalDataVersions.length === 0
      ? {}
      : { externalDataVersions: source.externalDataVersions }),
    ...(source.frameworkState === true ? { frameworkState: true as const } : {}),
    ...(source.principal === true ? { principal: true as const } : {}),
    ...(source.requestHeaders.length === 0 ? {} : { requestHeaders: source.requestHeaders }),
    ...(source.secret === true ? { secret: true as const } : {}),
    ...(source.session === true ? { session: true as const } : {}),
    ...(source.unclassified.length === 0 ? {} : { unclassified: source.unclassified }),
    ...(source.urlPath === true ? { urlPath: true as const } : {}),
    ...(source.urlSearch === true ? { urlSearch: true as const } : {}),
  };
}

function mergeInputs(
  left: CacheInfluenceDerivationInput,
  right: CacheInfluenceDerivationInput,
): CacheInfluenceDerivationInput {
  const influences = mutableInfluences(left.influences);
  const other = mutableInfluences(right.influences);
  if (right.influences.authorization === true) influences.authorization = true;
  if (right.influences.cookie === true) influences.cookie = true;
  if (right.influences.frameworkState === true) influences.frameworkState = true;
  if (right.influences.principal === true) influences.principal = true;
  if (right.influences.secret === true) influences.secret = true;
  if (right.influences.session === true) influences.session = true;
  if (right.influences.urlPath === true) influences.urlPath = true;
  if (right.influences.urlSearch === true) influences.urlSearch = true;
  appendUniqueValues(influences.requestHeaders, other.requestHeaders, false);
  appendUniqueValues(influences.unclassified, other.unclassified, false);
  appendUniqueExternalVersions(influences.externalDataVersions, other.externalDataVersions);
  let authored = left.authored;
  if (compilerJsonStringify(left.authored) !== compilerJsonStringify(right.authored)) {
    appendUnique(influences.unclassified, 'competing authored cache intents for one root');
    authored = { posture: 'non-public' };
  }
  return {
    authored,
    influences: immutableInfluences(influences),
    root: left.root,
    surface: left.surface,
  };
}

function appendUniqueExternalVersions(
  target: CacheInfluenceExternalDataVersionInput[],
  values: readonly CacheInfluenceExternalDataVersionInput[],
): void {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    const key = compilerJsonStringify(value);
    let found = false;
    for (let targetIndex = 0; targetIndex < target.length; targetIndex += 1) {
      if (compilerJsonStringify(target[targetIndex]) === key) {
        found = true;
        break;
      }
    }
    if (!found) compilerArrayAppend(target, value, 'Merged external data versions');
  }
}

function appendUniqueValues(target: string[], values: readonly string[], sorted: boolean): void {
  for (let index = 0; index < values.length; index += 1)
    appendUnique(target, values[index]!, sorted);
}

function appendUnique(target: string[], value: string, sorted = false): void {
  for (let index = 0; index < target.length; index += 1) {
    if (target[index] === value) return;
  }
  if (!sorted) {
    compilerArrayAppend(target, value, 'Cache influence unique values');
    return;
  }
  let index = 0;
  while (index < target.length && target[index]! < value) index += 1;
  compilerArrayAppend(target, value, 'Cache influence sorted values');
  for (let move = target.length - 1; move > index; move -= 1) {
    compilerSetOwnDataProperty(target, move, target[move - 1]);
  }
  compilerSetOwnDataProperty(target, index, value);
}

function insertSortedCacheEntry(
  target: CacheInfluenceManifestEntry[],
  entry: CacheInfluenceManifestEntry,
): void {
  let index = 0;
  while (index < target.length && target[index]!.root < entry.root) index += 1;
  compilerArrayAppend(target, entry, 'Cache influence manifest entries');
  for (let move = target.length - 1; move > index; move -= 1) {
    compilerSetOwnDataProperty(target, move, target[move - 1]);
  }
  compilerSetOwnDataProperty(target, index, entry);
}
