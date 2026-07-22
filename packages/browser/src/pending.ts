import { decodeFrameworkIdentityToken } from '@kovojs/core/internal/wire-input-grammar';

import type { AttributeMutatorLike, QuerySelectorAllRootLike } from './dom-like.js';
import { securityArrayAppend, securityStringSlice } from './security-witness-intrinsics.js';

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
  const source = value ?? '';
  const deps: string[] = [];
  let start = 0;
  for (let index = 0; index <= source.length; index += 1) {
    const character = index === source.length ? ' ' : (source[index] ?? '');
    if (character !== ' ') continue;
    if (index > start) {
      const token = securityStringSlice(source, start, index);
      const dependency = decodeFrameworkIdentityToken(token);
      if (dependency === undefined) {
        throw new TypeError('Kovo dependency input must contain canonical identity tokens.');
      }
      securityArrayAppend(deps, dependency, 'Kovo dependency snapshot');
    }
    start = index + 1;
  }
  return deps;
}
