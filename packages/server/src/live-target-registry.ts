import type { LiveTargetRenderer } from './mutation-wire.js';

/** @internal Compiler-emitted module namespace that may contain live-target renderer exports. */
export type GeneratedLiveTargetModule<Request = unknown> = Record<
  string,
  LiveTargetRenderer<Request> | unknown
>;

/**
 * @internal Collect compiler-emitted `*$liveTargetRenderer` exports from generated modules.
 *
 * Build/app-shell integration uses this helper to assemble the live-target registry from
 * generated artifacts instead of asking app authors to import renderer constants (SPEC §9.1).
 */
export function collectGeneratedLiveTargetRenderers<Request = unknown>(
  modules: readonly GeneratedLiveTargetModule<Request>[],
): LiveTargetRenderer<Request>[] {
  const renderersByComponent = new Map<string, LiveTargetRenderer<Request>>();

  for (const module of modules) {
    for (const [exportName, value] of Object.entries(module)) {
      if (!exportName.endsWith('$liveTargetRenderer')) continue;
      if (!isLiveTargetRenderer(value)) continue;

      const existing = renderersByComponent.get(value.component);
      if (existing === value) continue;
      if (existing) {
        throw new Error(
          `Duplicate generated live target renderer for component ${JSON.stringify(value.component)}.`,
        );
      }
      renderersByComponent.set(value.component, value);
    }
  }

  return [...renderersByComponent.values()];
}

function isLiveTargetRenderer<Request>(value: unknown): value is LiveTargetRenderer<Request> {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<LiveTargetRenderer<Request>>;
  return (
    typeof candidate.component === 'string' &&
    typeof candidate.render === 'function' &&
    (candidate.queries === undefined ||
      (Array.isArray(candidate.queries) &&
        candidate.queries.every((query) => typeof query === 'string')))
  );
}
