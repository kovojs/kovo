import {
  encodeFrameworkLiveTargetHeader,
  encodeFrameworkTargetHeader,
  FRAMEWORK_WIRE_INPUT_GRAMMAR,
  frameworkWireAttestationIsValid,
  frameworkWireComponentIsValid,
  frameworkWireIdentityIsValid,
  type FrameworkWireTarget,
} from '@kovojs/core/internal/wire-input-grammar';

import { readDeps } from './pending.js';
import type { QuerySelectorAllRootLike, TargetElementLike } from './dom-like.js';
import {
  securityArrayIsArray,
  securityJsonParse,
  securityJsonStringify,
} from './security-witness-intrinsics.js';

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
  const { liveTargets, targetEntries, targets } = collectLiveTargetSnapshot(root);
  const attestedLiveTargets = liveTargets.flatMap((descriptor) =>
    descriptor.attestation === undefined
      ? []
      : [
          {
            attestation: descriptor.attestation,
            component: descriptor.component,
            props: descriptor.props,
            target: descriptor.target,
          },
        ],
  );
  return {
    header: encodeFrameworkTargetHeader(targetEntries),
    liveHeader: encodeFrameworkLiveTargetHeader(attestedLiveTargets, stringifyLiveTargetProps),
    liveTargets,
    targets,
  };
}

function collectLiveTargetSnapshot(root: TargetCollectorRoot): {
  liveTargets: LiveTargetDescriptor[];
  targetEntries: FrameworkWireTarget[];
  targets: string[];
} {
  const targetEntries = new Map<string, FrameworkWireTarget>();
  const liveTargets = new Map<string, LiveTargetDescriptor>();

  for (const element of root.querySelectorAll('[kovo-deps]')) {
    // SPEC.md §9.1: Kovo-Targets is read from the live DOM so patched-in
    // fragment targets participate in the stateless enhanced mutation request.
    const target =
      element.getAttribute('kovo-fragment-target') ??
      element.getAttribute('id') ??
      (typeof element.id === 'string' ? element.id : null) ??
      element.getAttribute('kovo-c');
    const deps = readDeps(element.getAttribute('kovo-deps'));
    if (!target) continue;
    if (!frameworkWireIdentityIsValid(target) || !deps.every(frameworkWireIdentityIsValid))
      continue;

    if (
      !targetEntries.has(target) &&
      targetEntries.size < FRAMEWORK_WIRE_INPUT_GRAMMAR.maxEntries
    ) {
      targetEntries.set(target, { deps, target });
    }

    if (liveTargets.has(target) || liveTargets.size >= FRAMEWORK_WIRE_INPUT_GRAMMAR.maxEntries) {
      continue;
    }
    const component =
      element.getAttribute('kovo-live-component') ?? element.getAttribute('kovo-c') ?? target;
    if (!frameworkWireComponentIsValid(component)) continue;
    const attestation = readLiveTargetAttestation(element);
    liveTargets.set(target, {
      ...(attestation === undefined ? {} : { attestation }),
      component,
      props: readLiveProps(element.getAttribute('kovo-props')),
      target,
    });
  }

  const entries = [...targetEntries.values()];
  return {
    liveTargets: [...liveTargets.values()],
    targetEntries: entries,
    targets: entries.map((entry) => encodeFrameworkTargetHeader([entry])),
  };
}

function readLiveTargetAttestation(element: TargetElementLike): string | undefined {
  const value = element.getAttribute('kovo-live-token');
  return frameworkWireAttestationIsValid(value) ? value : undefined;
}

function readLiveProps(value: string | null): Record<string, unknown> {
  if (!value) return {};
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

function stringifyLiveTargetProps(value: unknown): string {
  const encoded = securityJsonStringify(value);
  if (encoded === undefined) {
    throw new TypeError('Kovo live target props must be JSON-serializable.');
  }
  return encoded;
}
