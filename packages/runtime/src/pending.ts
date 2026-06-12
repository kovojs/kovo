import type { AttributeMutatorLike, QuerySelectorAllRootLike } from './dom-like.js';

export interface PendingElementLike extends AttributeMutatorLike {}

export interface PendingRoot extends QuerySelectorAllRootLike<PendingElementLike> {}

export function stampPendingQueries(
  root: PendingRoot,
  queryNames: readonly string[],
  pending: boolean,
): string[] {
  const affected = new Set(queryNames);
  const stamped: string[] = [];

  for (const element of root.querySelectorAll('[fw-deps]')) {
    const deps = readDeps(element.getAttribute('fw-deps'));
    if (!deps.some((dep) => affected.has(dep))) continue;

    // SPEC.md §10.4: optimistic mutations mark dependent islands pending
    // until server truth settles or the prediction is discarded.
    if (pending) {
      element.setAttribute('fw-pending', '');
      element.setAttribute('aria-busy', 'true');
    } else {
      element.removeAttribute('fw-pending');
      element.removeAttribute('aria-busy');
    }
    stamped.push(deps.join(','));
  }

  return stamped;
}

export function readDeps(value: string | null): string[] {
  return (value ?? '')
    .split(/[\s,]+/)
    .map((dep) => dep.trim())
    .filter(Boolean);
}
