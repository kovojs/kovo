import { readDeps } from './pending.js';
import type { QuerySelectorAllRootLike, TargetElementLike } from './dom-like.js';

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface TargetCollectorRoot extends QuerySelectorAllRootLike<TargetElementLike> {}

const liveTargetHeaderSeparator = '; ';

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface LiveTargetSnapshot {
  header: string;
  liveHeader: string;
  liveTargets: LiveTargetDescriptor[];
  targets: string[];
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface LiveTargetDescriptor {
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
  const { liveTargets, targets } = collectLiveTargetSnapshot(root);
  return {
    header: targets.join(liveTargetHeaderSeparator),
    liveHeader: liveTargets.map(formatLiveTargetDescriptor).join(liveTargetHeaderSeparator),
    liveTargets,
    targets,
  };
}

function collectLiveTargetSnapshot(root: TargetCollectorRoot): {
  liveTargets: LiveTargetDescriptor[];
  targets: string[];
} {
  const targets = new Set<string>();
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
    if (!isHeaderSafeIdentity(target) || !deps.every(isHeaderSafeIdentity)) continue;

    targets.add(deps.length > 0 ? `${target}=${deps.join(' ')}` : target);

    if (liveTargets.has(target)) continue;
    const component =
      element.getAttribute('kovo-live-component') ?? element.getAttribute('kovo-c') ?? target;
    if (!isHeaderSafeLiveComponentIdentity(component)) continue;
    liveTargets.set(target, {
      component,
      props: readLiveProps(element.getAttribute('kovo-props')),
      target,
    });
  }

  return { liveTargets: [...liveTargets.values()], targets: [...targets] };
}

function formatLiveTargetDescriptor(descriptor: LiveTargetDescriptor): string {
  return `${descriptor.target}#${descriptor.component}:${JSON.stringify(descriptor.props)}`;
}

function isHeaderSafeIdentity(value: string): boolean {
  // SPEC.md §9.1: browser-collected live target identities are serialized into
  // delimiter-based headers. Keep selector-hostile values such as quotes and
  // backslashes working, but reject characters that would corrupt header field
  // boundaries or target/dependency assignment. Colon remains valid here because
  // SPEC.md §13.2 instance identities use it and the live descriptor target ends
  // before the `#` component separator.
  if (value === '') return false;
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f || /\s/.test(char) || ';,#='.includes(char)) {
      return false;
    }
  }
  return true;
}

function isHeaderSafeLiveComponentIdentity(value: string): boolean {
  return isHeaderSafeIdentity(value) && !value.includes(':');
}

function readLiveProps(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const props = JSON.parse(value);
    return isRecord(props) ? props : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
