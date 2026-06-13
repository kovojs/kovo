import {
  applyMutationResponseChunksToRuntime,
  type AppliedMutationResponseWithRoot,
  type ApplyMutationResponseChunksToRuntimeOptions,
} from './apply-mutation-response.js';
import type { MorphRoot } from './morph.js';
import { readMutationResponseBodyChunks } from './wire-parser.js';

export interface ApplyMutationResponseToDomOptions extends ApplyMutationResponseChunksToRuntimeOptions {
  body: string;
  root: MorphRoot;
}

export function applyMutationResponseToDom(
  options: ApplyMutationResponseToDomOptions,
): AppliedMutationResponseWithRoot {
  // SPEC.md §9.1: DOM mutation responses parse transport bodies before
  // entering the shared decoded query/fragment runtime apply primitive.
  const { body, ...applyOptions } = options;
  return applyMutationResponseChunksToRuntime(
    readMutationResponseBodyChunks(body, options.onError),
    applyOptions,
  );
}
