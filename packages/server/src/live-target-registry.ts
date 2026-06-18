import type { LiveTargetRenderer } from './mutation-wire.js';

/** @internal Compiler-emitted module namespace that may contain live-target renderer exports. */
export type GeneratedLiveTargetModule<Request = unknown> = Record<
  string,
  LiveTargetRenderer<Request> | unknown
>;

const registeredRenderersByComponent = new Map<string, LiveTargetRenderer<unknown>>();

/**
 * @internal Register one compiler-emitted live-target renderer as the generated module loads.
 *
 * Generated component modules call this as a side effect so app-shell/createApp wiring can
 * consume the compiler-owned registry without app-authored `liveTargetRenderers` imports
 * (SPEC §9.1/§9.5). Re-registration replaces the previous renderer for the same component so
 * dev/HMR module reloads do not fail on stale object identity.
 */
export function registerGeneratedLiveTargetRenderer<Request = unknown>(
  renderer: LiveTargetRenderer<Request>,
): LiveTargetRenderer<Request> {
  if (!isLiveTargetRenderer(renderer)) {
    throw new TypeError('Generated live target renderer registration received an invalid renderer.');
  }

  registeredRenderersByComponent.set(
    renderer.component,
    renderer as LiveTargetRenderer<unknown>,
  );
  return renderer;
}

/** @internal Return the generated live-target renderers registered by imported component modules. */
export function registeredGeneratedLiveTargetRenderers<
  Request = unknown,
>(): LiveTargetRenderer<Request>[] {
  return [...registeredRenderersByComponent.values()] as LiveTargetRenderer<Request>[];
}

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
      if (!isLiveTargetRenderer<Request>(value)) continue;

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
        candidate.queries.every((query) => typeof query === 'string'))) &&
    (candidate.queryDefinitions === undefined ||
      (Array.isArray(candidate.queryDefinitions) &&
        candidate.queryDefinitions.every((query) => typeof query?.key === 'string')))
  );
}
