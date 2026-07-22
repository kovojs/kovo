import {
  encodeFrameworkLiveTargetHeader,
  encodeFrameworkTargetHeader,
  encodeFrameworkWireEntryList,
  FRAMEWORK_WIRE_INPUT_GRAMMAR,
  frameworkWireAttestationIsValid,
  frameworkWireComponentIsValid,
  frameworkWireIdentityIsValid,
  type FrameworkWireEntrySnapshot,
} from '@kovojs/core/internal/wire-input-grammar';

import { readDeps } from './pending.js';
import type { QuerySelectorAllRootLike, TargetElementLike } from './dom-like.js';
import { queryRuntimeElements, readRuntimeElementAttribute } from './runtime-dom-security.js';
import {
  securityArrayAppend,
  securityArrayIsArray,
  securityGetOwnPropertyDescriptor,
  securityJsonParse,
  securityOwnArrayEntry,
} from './security-witness-intrinsics.js';

const maxTargetCollectionElements = 100_000;

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface TargetCollectorRoot extends QuerySelectorAllRootLike<TargetElementLike> {}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface LiveTargetSnapshot {
  header: string;
  liveHeader: string;
  /** @internal Canonical wire entries paired with semantic targets for aggregate planning. */
  liveTargetEntries: readonly FrameworkWireEntrySnapshot[];
  liveTargets: LiveTargetDescriptor[];
  /** @internal Canonical wire entries paired with semantic targets for aggregate planning. */
  targetEntries: readonly FrameworkWireEntrySnapshot[];
  targets: string[];
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface LiveTargetDescriptor {
  attestation?: string;
  component: string;
  props: Record<string, unknown>;
  target: string;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export function readLiveTargets(root: TargetCollectorRoot): string[] {
  return wireEntryValues(collectLiveTargetSnapshot(root).targetWireEntries);
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export function readLiveTargetSnapshot(root: TargetCollectorRoot): LiveTargetSnapshot {
  const collected = collectLiveTargetSnapshot(root);
  return {
    header: encodeFrameworkWireEntryList(wireEntryValues(collected.targetWireEntries)),
    liveHeader: encodeFrameworkWireEntryList(wireEntryValues(collected.liveTargetWireEntries)),
    liveTargetEntries: collected.liveTargetWireEntries,
    liveTargets: collected.liveTargets,
    targetEntries: collected.targetWireEntries,
    targets: wireEntryValues(collected.targetWireEntries),
  };
}

function collectLiveTargetSnapshot(root: TargetCollectorRoot): {
  liveTargetWireEntries: FrameworkWireEntrySnapshot[];
  liveTargets: LiveTargetDescriptor[];
  targetWireEntries: FrameworkWireEntrySnapshot[];
} {
  const targetWireEntries: FrameworkWireEntrySnapshot[] = [];
  const targetIdentities: string[] = [];
  const liveTargets: LiveTargetDescriptor[] = [];
  const liveTargetWireEntries: FrameworkWireEntrySnapshot[] = [];
  const liveTargetIdentities: string[] = [];
  let targetEntryCount = 0;
  let liveTargetCount = 0;
  const elements = readTargetElements(root);

  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const elementEntry = securityOwnArrayEntry(elements.value, elementIndex);
    if (!elementEntry.ok || elementEntry.value === null || typeof elementEntry.value !== 'object') {
      throw new TypeError('Kovo target collection must contain dense element entries.');
    }
    const element = elementEntry.value;
    // SPEC.md §9.1: Kovo-Targets is read from the live DOM so patched-in
    // fragment targets participate in the stateless enhanced mutation request.
    const target = readTargetIdentity(element);
    let deps: string[];
    try {
      deps = readDeps(readRuntimeElementAttribute(element, 'kovo-deps'));
    } catch {
      continue;
    }
    if (!target) continue;
    if (!frameworkWireIdentityIsValid(target) || !dependenciesAreValid(deps)) continue;

    if (
      targetEntryCount < FRAMEWORK_WIRE_INPUT_GRAMMAR.maxEntries &&
      !snapshotContains(targetIdentities, targetEntryCount, target, 'Kovo target identity snapshot')
    ) {
      const targetEntry = { deps, target };
      const wireEntry = encodeFrameworkTargetHeader([targetEntry]);
      if (wireEntry !== '') {
        securityArrayAppend(targetIdentities, target, 'Kovo target identity snapshot');
        securityArrayAppend(
          targetWireEntries,
          { target, wireEntry },
          'Kovo target wire-entry snapshot',
        );
        targetEntryCount += 1;
      }
    }

    if (
      liveTargetCount >= FRAMEWORK_WIRE_INPUT_GRAMMAR.maxEntries ||
      snapshotContains(
        liveTargetIdentities,
        liveTargetCount,
        target,
        'Kovo live target identity snapshot',
      )
    ) {
      continue;
    }
    const component =
      readRuntimeElementAttribute(element, 'kovo-live-component') ??
      readRuntimeElementAttribute(element, 'kovo-c') ??
      target;
    if (!frameworkWireComponentIsValid(component)) continue;
    const attestation = readLiveTargetAttestation(element);
    const propsSource = readRuntimeElementAttribute(element, 'kovo-props');
    const props = readLiveProps(propsSource);
    if (props === undefined) continue;
    securityArrayAppend(liveTargetIdentities, target, 'Kovo live target identity snapshot');
    if (attestation === undefined) {
      securityArrayAppend(
        liveTargets,
        { component, props, target },
        'Kovo live target descriptor snapshot',
      );
    } else {
      securityArrayAppend(
        liveTargets,
        { attestation, component, props, target },
        'Kovo live target descriptor snapshot',
      );
      const wireEntry = encodeFrameworkLiveTargetHeader([
        { attestation, component, propsSource, target },
      ]);
      if (wireEntry !== '') {
        securityArrayAppend(
          liveTargetWireEntries,
          { target, wireEntry },
          'Kovo live-target wire-entry snapshot',
        );
      }
    }
    liveTargetCount += 1;

    if (
      targetEntryCount === FRAMEWORK_WIRE_INPUT_GRAMMAR.maxEntries &&
      liveTargetCount === FRAMEWORK_WIRE_INPUT_GRAMMAR.maxEntries
    ) {
      break;
    }
  }

  return {
    liveTargetWireEntries,
    liveTargets,
    targetWireEntries,
  };
}

function wireEntryValues(entries: readonly FrameworkWireEntrySnapshot[]): string[] {
  const values: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = securityOwnArrayEntry(entries, index);
    if (!entry.ok) throw new TypeError('Kovo wire-entry snapshot must contain dense entries.');
    securityArrayAppend(values, entry.value.wireEntry, 'Kovo wire-entry value snapshot');
  }
  return values;
}

function readLiveTargetAttestation(element: TargetElementLike): string | undefined {
  const value = readRuntimeElementAttribute(element, 'kovo-live-token');
  return frameworkWireAttestationIsValid(value) ? value : undefined;
}

function readTargetElements(root: TargetCollectorRoot): {
  length: number;
  value: readonly TargetElementLike[];
} {
  const values = queryRuntimeElements<TargetElementLike>(root, '[kovo-deps]');
  const length = securityGetOwnPropertyDescriptor(values, 'length');
  if (
    length === undefined ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    length.value < 0 ||
    length.value > maxTargetCollectionElements ||
    length.value % 1 !== 0
  ) {
    throw new TypeError('Kovo target collection must have a bounded own-data length.');
  }
  return { length: length.value, value: values };
}

function readTargetIdentity(element: TargetElementLike): string | null {
  const fragmentTarget = readRuntimeElementAttribute(element, 'kovo-fragment-target');
  if (fragmentTarget !== null) return fragmentTarget;
  const idAttribute = readRuntimeElementAttribute(element, 'id');
  if (idAttribute !== null) return idAttribute;
  // Browser-free conformance fakes historically expose `id` as own data. Real
  // Elements use the boot-witnessed attribute read above and never dispatch a
  // late replacement through the live `Element.prototype.id` accessor.
  const structuralId = securityGetOwnPropertyDescriptor(element, 'id');
  if (structuralId && 'value' in structuralId && typeof structuralId.value === 'string') {
    return structuralId.value;
  }
  return readRuntimeElementAttribute(element, 'kovo-c');
}

function dependenciesAreValid(deps: readonly string[]): boolean {
  const length = securityGetOwnPropertyDescriptor(deps, 'length');
  if (
    length === undefined ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    length.value < 0 ||
    length.value > maxTargetCollectionElements ||
    length.value % 1 !== 0
  ) {
    return false;
  }
  for (let index = 0; index < length.value; index += 1) {
    const dep = securityOwnArrayEntry(deps, index);
    if (!dep.ok || !frameworkWireIdentityIsValid(dep.value)) return false;
  }
  return true;
}

function snapshotContains(
  values: readonly string[],
  length: number,
  value: string,
  label: string,
): boolean {
  for (let index = 0; index < length; index += 1) {
    const entry = securityOwnArrayEntry(values, index);
    if (!entry.ok) throw new TypeError(label + ' must contain dense own-data entries.');
    if (entry.value === value) return true;
  }
  return false;
}

function readLiveProps(value: string | null): Record<string, unknown> | undefined {
  if (!value) return {};
  if (value.length > FRAMEWORK_WIRE_INPUT_GRAMMAR.maxHeaderCharacters) {
    return undefined;
  }
  try {
    const props = securityJsonParse(value);
    return isRecord(props) ? props : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !securityArrayIsArray(value);
}
