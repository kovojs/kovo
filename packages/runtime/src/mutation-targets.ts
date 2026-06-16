import { readDeps } from './pending.js';
import type { QuerySelectorAllRootLike, TargetElementLike } from './dom-like.js';

export interface TargetCollectorRoot extends QuerySelectorAllRootLike<TargetElementLike> {}

const liveTargetHeaderSeparator = '; ';

export interface LiveTargetSnapshot {
  header: string;
  targets: string[];
}

export function readLiveTargets(root: TargetCollectorRoot): string[] {
  return collectLiveTargets(root);
}

export function readLiveTargetSnapshot(root: TargetCollectorRoot): LiveTargetSnapshot {
  const targets = collectLiveTargets(root);
  return {
    header: targets.join(liveTargetHeaderSeparator),
    targets,
  };
}

function collectLiveTargets(root: TargetCollectorRoot): string[] {
  const targets = new Set<string>();

  for (const element of root.querySelectorAll('[kovo-deps]')) {
    // SPEC.md §9.1: Kovo-Targets is read from the live DOM so patched-in
    // fragment targets participate in the stateless enhanced mutation request.
    const target =
      element.getAttribute('kovo-fragment-target') ?? element.id ?? element.getAttribute('kovo-c');
    const deps = readDeps(element.getAttribute('kovo-deps'));
    if (target) targets.add(deps.length > 0 ? `${target}=${deps.join(' ')}` : target);
  }

  return [...targets];
}
