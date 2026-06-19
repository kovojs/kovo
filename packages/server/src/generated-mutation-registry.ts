import type { MutationTouchSite } from './change-record.js';

/** @internal Compiler-emitted mutation touch registry keyed by mutation name. */
export type GeneratedMutationTouchRegistry = Readonly<Record<string, readonly MutationTouchSite[]>>;

const registeredTouchesByMutation = new Map<string, readonly MutationTouchSite[]>();

/**
 * @internal Register compiler-derived mutation touch sites as generated modules load.
 *
 * Generated graph modules call this as a side effect so app-shell/createApp wiring can
 * consume compiler-owned invalidation facts without app-authored generated imports
 * (SPEC §10.3). Re-registration replaces the previous entry for the same mutation so
 * dev/HMR module reloads do not keep stale derived touch sets.
 */
export function registerGeneratedMutationTouchRegistry(
  registry: GeneratedMutationTouchRegistry,
): GeneratedMutationTouchRegistry {
  if (!isGeneratedMutationTouchRegistry(registry)) {
    throw new TypeError('Generated mutation touch registry received an invalid registry.');
  }

  for (const [mutationKey, touches] of Object.entries(registry)) {
    registeredTouchesByMutation.set(mutationKey, touches);
  }
  return registry;
}

/** @internal Return compiler-derived touch sites registered for one mutation key. */
export function registeredGeneratedMutationTouches(
  mutationKey: string,
): readonly MutationTouchSite[] {
  return registeredTouchesByMutation.get(mutationKey) ?? [];
}

function isGeneratedMutationTouchRegistry(value: unknown): value is GeneratedMutationTouchRegistry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  return Object.entries(value).every(
    ([mutationKey, touches]) =>
      typeof mutationKey === 'string' &&
      Array.isArray(touches) &&
      touches.every(
        (touch) =>
          touch !== null &&
          typeof touch === 'object' &&
          !Array.isArray(touch) &&
          typeof (touch as MutationTouchSite).domain === 'string' &&
          ((touch as MutationTouchSite).keys === null ||
            typeof (touch as MutationTouchSite).keys === 'string') &&
          ((touch as MutationTouchSite).via === undefined ||
            typeof (touch as MutationTouchSite).via === 'string'),
      ),
  );
}
