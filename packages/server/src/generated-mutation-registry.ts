import type { MutationTouchSite } from './change-record.js';
import { appendDenseOwnArrayValue, denseOwnArrayForEach } from './registry-lookup.js';
import {
  createWitnessMap,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
  witnessMapGet,
  witnessMapSet,
  witnessObjectKeys,
} from './security-witness-intrinsics.js';

/** @internal Compiler-emitted mutation touch registry keyed by mutation name. */
export type GeneratedMutationTouchRegistry = Readonly<Record<string, readonly MutationTouchSite[]>>;

const registeredTouchesByMutation = createWitnessMap<string, readonly MutationTouchSite[]>();

/**
 * @internal Register compiler-derived mutation touch sites as generated modules load.
 *
 * Generated graph modules call this as a side effect so app-shell/createApp wiring can
 * consume compiler-owned invalidation facts without app-authored generated imports
 * (SPEC §10.3). Re-registration replaces the previous entry for the same mutation so
 * dev/HMR module reloads do not keep stale derived touch sets.
 *
 * The compiler registry is security authority: it decides which successful writes invalidate
 * which reads. Snapshot every carrier through boot-pinned own-data controls before committing it;
 * evaluated app modules share this realm and may replace Map/Array/Object prototype methods or
 * retain and mutate the generated carrier after registration (SPEC §6.6/§10.3 C9/C15).
 */
export function registerGeneratedMutationTouchRegistry(
  registry: GeneratedMutationTouchRegistry,
): GeneratedMutationTouchRegistry {
  let entries: readonly MutationTouchRegistryEntry[];
  try {
    entries = snapshotGeneratedMutationTouchRegistry(registry);
  } catch {
    throw new TypeError('Generated mutation touch registry received an invalid registry.');
  }
  denseOwnArrayForEach(
    entries,
    (entry) => witnessMapSet(registeredTouchesByMutation, entry.mutationKey, entry.touches),
    'Generated mutation touch registry snapshot',
  );
  return registry;
}

/** @internal Return compiler-derived touch sites registered for one mutation key. */
export function registeredGeneratedMutationTouches(
  mutationKey: string,
): readonly MutationTouchSite[] {
  return witnessMapGet(registeredTouchesByMutation, mutationKey) ?? EMPTY_TOUCHES;
}

const EMPTY_TOUCHES = witnessFreeze([] as MutationTouchSite[]);

interface MutationTouchRegistryEntry {
  readonly mutationKey: string;
  readonly touches: readonly MutationTouchSite[];
}

function snapshotGeneratedMutationTouchRegistry(
  value: unknown,
): readonly MutationTouchRegistryEntry[] {
  if (value === null || typeof value !== 'object' || witnessIsArray(value)) {
    throw new TypeError('Generated mutation touch registry received an invalid registry.');
  }

  const snapshot: MutationTouchRegistryEntry[] = [];
  const mutationKeys = witnessObjectKeys(value);
  denseOwnArrayForEach(
    mutationKeys,
    (mutationKey) => {
      const touchesDescriptor = witnessGetOwnPropertyDescriptor(value, mutationKey);
      if (
        touchesDescriptor === undefined ||
        !('value' in touchesDescriptor) ||
        !witnessIsArray(touchesDescriptor.value)
      ) {
        throw new TypeError('Generated mutation touch registry received an invalid registry.');
      }

      const touches: MutationTouchSite[] = [];
      denseOwnArrayForEach(
        touchesDescriptor.value,
        (touch) => appendDenseOwnArrayValue(touches, snapshotMutationTouchSite(touch)),
        `Generated mutation touch registry entry ${mutationKey}`,
      );
      appendDenseOwnArrayValue(
        snapshot,
        witnessFreeze({ mutationKey, touches: witnessFreeze(touches) }),
      );
    },
    'Generated mutation touch registry keys',
  );
  return witnessFreeze(snapshot);
}

function snapshotMutationTouchSite(value: unknown): Readonly<MutationTouchSite> {
  if (value === null || typeof value !== 'object' || witnessIsArray(value)) {
    throw new TypeError('Generated mutation touch registry received an invalid touch site.');
  }

  const domain = ownDataProperty(value, 'domain');
  const keys = ownDataProperty(value, 'keys');
  const via = optionalOwnDataProperty(value, 'via');
  const crossTable = optionalOwnDataProperty(value, 'crossTable');
  if (
    typeof domain !== 'string' ||
    (keys !== null && typeof keys !== 'string') ||
    (via !== undefined && typeof via !== 'string') ||
    (crossTable !== undefined && crossTable !== true)
  ) {
    throw new TypeError('Generated mutation touch registry received an invalid touch site.');
  }

  return witnessFreeze({
    ...(crossTable === true ? { crossTable: true as const } : {}),
    domain,
    keys,
    ...(via === undefined ? {} : { via }),
  });
}

function ownDataProperty(value: object, property: PropertyKey): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError('Generated mutation touch registry requires stable own data properties.');
  }
  return descriptor.value;
}

function optionalOwnDataProperty(value: object, property: PropertyKey): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw new TypeError('Generated mutation touch registry rejects accessor-backed properties.');
  }
  return descriptor.value;
}
