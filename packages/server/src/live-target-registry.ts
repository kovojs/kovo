import type { LiveTargetRenderer } from './mutation-wire.js';
import { appendDenseOwnArrayValue, denseOwnArrayForEach } from './registry-lookup.js';
import { securityJsonStringify, securityStringEndsWith } from './response-security-intrinsics.js';
import {
  createWitnessMap,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessMapForEach,
  witnessMapGet,
  witnessMapSet,
  witnessObjectKeys,
} from './security-witness-intrinsics.js';

/** @internal Compiler-emitted module namespace that may contain live-target renderer exports. */
export type GeneratedLiveTargetModule<_Request = unknown> = Record<string, unknown>;

const registeredRenderersByComponent = createWitnessMap<string, LiveTargetRenderer<unknown>>();

/**
 * @internal Register one compiler-emitted live-target renderer as the generated module loads.
 *
 * Generated component modules call this as a side effect so app-shell/createApp wiring can
 * consume the compiler-owned registry without app-authored `liveTargetRenderers` imports
 * (SPEC §9.1/§9.5).
 *
 * Vite dev/HMR may re-evaluate a generated component module and create a fresh
 * renderer object for the same stable component id. Side-effect registration is
 * therefore idempotent by component id: the latest generated renderer replaces
 * any stale renderer owned by the previous module instance. Explicit module
 * collection remains strict in {@link collectGeneratedLiveTargetRenderers}.
 */
export function registerGeneratedLiveTargetRenderer<Request = unknown>(
  renderer: LiveTargetRenderer<Request>,
): LiveTargetRenderer<Request> {
  if (!isLiveTargetRenderer(renderer)) {
    throw new TypeError(
      'Generated live target renderer registration received an invalid renderer.',
    );
  }

  witnessMapSet(
    registeredRenderersByComponent,
    liveTargetRendererComponent(renderer),
    renderer as LiveTargetRenderer<unknown>,
  );
  return renderer;
}

/** @internal Return the generated live-target renderers registered by imported component modules. */
export function registeredGeneratedLiveTargetRenderers<
  Request = unknown,
>(): LiveTargetRenderer<Request>[] {
  const renderers: LiveTargetRenderer<Request>[] = [];
  witnessMapForEach(registeredRenderersByComponent, (renderer) => {
    appendDenseOwnArrayValue(renderers, renderer as LiveTargetRenderer<Request>);
  });
  return renderers;
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
  const renderersByComponent = createWitnessMap<string, LiveTargetRenderer<Request>>();

  denseOwnArrayForEach(
    modules,
    (module) => {
      const exportNames = witnessObjectKeys(module);
      denseOwnArrayForEach(
        exportNames,
        (exportName) => {
          if (!securityStringEndsWith(exportName, '$liveTargetRenderer')) return;
          const descriptor = witnessGetOwnPropertyDescriptor(module, exportName);
          if (descriptor === undefined || !('value' in descriptor)) {
            throw new TypeError('Generated live target modules must expose stable own exports.');
          }
          const value = descriptor.value;
          if (!isLiveTargetRenderer<Request>(value)) return;

          const component = liveTargetRendererComponent(value);
          const existing = witnessMapGet(renderersByComponent, component);
          if (existing === value) return;
          if (existing) {
            throw new Error(
              `Duplicate generated live target renderer for component ${securityJsonStringify(component)}.`,
            );
          }
          witnessMapSet(renderersByComponent, component, value);
        },
        'Generated live target module exports',
      );
    },
    'Generated live target modules',
  );

  const renderers: LiveTargetRenderer<Request>[] = [];
  witnessMapForEach(renderersByComponent, (renderer) => {
    appendDenseOwnArrayValue(renderers, renderer);
  });
  return renderers;
}

function isLiveTargetRenderer<Request>(value: unknown): value is LiveTargetRenderer<Request> {
  if (!value || typeof value !== 'object') return false;

  const component = ownDataValue(value, 'component');
  const render = ownDataValue(value, 'render');
  const queries = ownDataValue(value, 'queries');
  const queryDefinitions = ownDataValue(value, 'queryDefinitions');
  return (
    typeof component === 'string' &&
    typeof render === 'function' &&
    (queries === undefined || denseOwnArrayEvery(queries, (query) => typeof query === 'string')) &&
    (queryDefinitions === undefined ||
      denseOwnArrayEvery(
        queryDefinitions,
        (query) => typeof ownDataValue(query, 'key') === 'string',
      ))
  );
}

function liveTargetRendererComponent(renderer: object): string {
  const component = ownDataValue(renderer, 'component');
  if (typeof component !== 'string') {
    throw new TypeError('Generated live target renderer component must be a stable own string.');
  }
  return component;
}

function ownDataValue(value: unknown, key: PropertyKey): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  const descriptor = witnessGetOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

function denseOwnArrayEvery(value: unknown, predicate: (entry: unknown) => boolean): boolean {
  if (!witnessIsArray(value)) return false;
  let valid = true;
  try {
    denseOwnArrayForEach(
      value,
      (entry) => {
        if (!predicate(entry)) valid = false;
      },
      'Generated live target renderer collection',
    );
  } catch {
    return false;
  }
  return valid;
}
