import {
  encodeFrameworkLiveTargetHeader,
  encodeFrameworkTargetHeader,
  FRAMEWORK_WIRE_INPUT_GRAMMAR,
  frameworkWireAttestationIsValid,
  frameworkWireComponentIsValid,
  frameworkWireIdentityIsValid,
  type FrameworkWireLiveTargetInput,
  type FrameworkWireTarget,
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
  liveTargets: LiveTargetDescriptor[];
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
  return collectLiveTargetSnapshot(root).targets;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export function readLiveTargetSnapshot(root: TargetCollectorRoot): LiveTargetSnapshot {
  const collected = collectLiveTargetSnapshot(root);
  return {
    header: encodeFrameworkTargetHeader(collected.targetEntries),
    liveHeader: encodeFrameworkLiveTargetHeader(collected.attestedLiveTargets),
    liveTargets: collected.liveTargets,
    targets: collected.targets,
  };
}

function collectLiveTargetSnapshot(root: TargetCollectorRoot): {
  attestedLiveTargets: FrameworkWireLiveTargetInput[];
  liveTargets: LiveTargetDescriptor[];
  targetEntries: FrameworkWireTarget[];
  targets: string[];
} {
  const targetEntries: FrameworkWireTarget[] = [];
  const targetIdentities: string[] = [];
  const liveTargets: LiveTargetDescriptor[] = [];
  const attestedLiveTargets: FrameworkWireLiveTargetInput[] = [];
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
    const deps = readDeps(readRuntimeElementAttribute(element, 'kovo-deps'));
    if (!target) continue;
    if (!frameworkWireIdentityIsValid(target) || !dependenciesAreValid(deps)) continue;

    if (
      targetEntryCount < FRAMEWORK_WIRE_INPUT_GRAMMAR.maxEntries &&
      !snapshotContains(targetIdentities, targetEntryCount, target, 'Kovo target identity snapshot')
    ) {
      securityArrayAppend(targetIdentities, target, 'Kovo target identity snapshot');
      securityArrayAppend(targetEntries, { deps, target }, 'Kovo target entry snapshot');
      targetEntryCount += 1;
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
      securityArrayAppend(
        attestedLiveTargets,
        { attestation, component, propsSource, target },
        'Kovo attested live target input snapshot',
      );
    }
    liveTargetCount += 1;

    if (
      targetEntryCount === FRAMEWORK_WIRE_INPUT_GRAMMAR.maxEntries &&
      liveTargetCount === FRAMEWORK_WIRE_INPUT_GRAMMAR.maxEntries
    ) {
      break;
    }
  }

  const targets: string[] = [];
  for (let index = 0; index < targetEntryCount; index += 1) {
    const entry = securityOwnArrayEntry(targetEntries, index);
    if (!entry.ok) {
      throw new TypeError('Kovo target entry snapshot must contain dense own-data entries.');
    }
    securityArrayAppend(
      targets,
      encodeFrameworkTargetHeader([entry.value]),
      'Kovo encoded target snapshot',
    );
  }
  return {
    attestedLiveTargets,
    liveTargets,
    targetEntries,
    targets,
  };
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

function readLiveProps(value: string | null): Record<string, unknown> {
  if (!value) return {};
  if (value.length > FRAMEWORK_WIRE_INPUT_GRAMMAR.maxHeaderCharacters) {
    throw new TypeError(
      'Kovo live-target props exceed the ' +
        FRAMEWORK_WIRE_INPUT_GRAMMAR.maxHeaderCharacters +
        '-character wire budget.',
    );
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
