import type { MutationFail } from './mutation.js';
import {
  createWitnessWeakSet,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

export type MutationFailurePageRenderer = (
  failure: MutationFail,
  rawInput: unknown,
) => string | Promise<string>;

const frameworkFailurePageRenderers = createWitnessWeakSet<object>();

/** @internal Mint framework-only authority for the route document failure re-renderer. */
export function frameworkMutationFailurePageRenderer<Renderer extends MutationFailurePageRenderer>(
  renderer: Renderer,
): Renderer {
  witnessWeakSetAdd(frameworkFailurePageRenderers, renderer);
  return renderer;
}

/** @internal Distinguish the framework route re-renderer from an injected structural callback. */
export function isFrameworkMutationFailurePageRenderer(
  renderer: MutationFailurePageRenderer | undefined,
): boolean {
  return renderer !== undefined && witnessWeakSetHas(frameworkFailurePageRenderers, renderer);
}
