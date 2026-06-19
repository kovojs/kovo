import type { AttributeMutatorLike, QuerySelectorAllRootLike } from './dom-like.js';

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface PendingElementLike extends AttributeMutatorLike {}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface PendingRoot extends QuerySelectorAllRootLike<PendingElementLike> {}

/** Runtime API used by Kovo applications and generated runtime integration. */
export function stampPendingQueries(
  root: PendingRoot,
  queryNames: readonly string[],
  pending: boolean,
): string[] {
  const affected = new Set(queryNames);
  const stamped: string[] = [];

  for (const element of root.querySelectorAll('[kovo-deps]')) {
    const deps = readDeps(element.getAttribute('kovo-deps'));
    if (!deps.some((dep) => affected.has(dep))) continue;

    // SPEC.md §10.4: optimistic mutations mark dependent islands pending
    // until server truth settles or the prediction is discarded.
    if (pending) {
      element.setAttribute('kovo-pending', '');
      element.setAttribute('aria-busy', 'true');
    } else {
      element.removeAttribute('kovo-pending');
      element.removeAttribute('aria-busy');
    }
    stamped.push(deps.join(','));
  }

  return stamped;
}

/** Runtime API used by Kovo applications and generated runtime integration. */
export function readDeps(value: string | null): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((dep) => dep.trim())
    .filter(Boolean);
}
