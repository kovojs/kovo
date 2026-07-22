import {
  decodeFrameworkQueryDependencyToken,
  FRAMEWORK_WIRE_INPUT_GRAMMAR,
  frameworkWireIdentityIsValid,
  type FrameworkQueryDependencyIdentity,
} from '@kovojs/core/internal/wire-input-grammar';

import type { AttributeMutatorLike, QuerySelectorAllRootLike } from './dom-like.js';
import {
  freezeSecurityValue,
  securityArrayAppend,
  securityArrayIsArray,
  securityGetOwnPropertyDescriptor,
  securityOwnArrayEntry,
  securityStringSlice,
} from './security-witness-intrinsics.js';

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface PendingElementLike extends AttributeMutatorLike {}

/** Runtime API used by Kovo applications and generated runtime integration. */
export interface PendingRoot extends QuerySelectorAllRootLike<PendingElementLike> {}

/** Exact or family query identity used to mark DOM dependency roots pending. */
export type PendingQuerySelector =
  | { readonly kind: 'exact'; readonly key?: string; readonly name: string }
  | { readonly kind: 'family'; readonly name: string };

/** Runtime API used by Kovo applications and generated runtime integration. */
export function stampPendingQueries(
  root: PendingRoot,
  querySelectors: readonly PendingQuerySelector[],
  pending: boolean,
): string[] {
  const affected = snapshotPendingQuerySelectors(querySelectors);
  const stamped: string[] = [];

  for (const element of root.querySelectorAll('[kovo-deps]')) {
    const identities = readQueryDependencyIdentities(element.getAttribute('kovo-deps'));
    const deps = dependencyDisplays(identities);
    let matches = false;
    for (let identityIndex = 0; identityIndex < identities.length && !matches; identityIndex += 1) {
      const identity = securityOwnArrayEntry(identities, identityIndex);
      if (!identity.ok) throw new TypeError('Kovo dependency identities must be dense.');
      matches = dependencyIdentityIsAffected(identity.value, affected);
    }
    if (!matches) continue;

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
export function readDeps(value: string | null): PendingQuerySelector[] {
  const identities = readQueryDependencyIdentities(value);
  const selectors: PendingQuerySelector[] = [];
  for (let index = 0; index < identities.length; index += 1) {
    const identity = securityOwnArrayEntry(identities, index);
    if (!identity.ok) throw new TypeError('Kovo dependency identities must be dense.');
    securityArrayAppend(
      selectors,
      exactPendingQuerySelector(identity.value),
      'Kovo exact pending-query selector snapshot',
    );
  }
  return selectors;
}

/** @internal Construct a validated family selector for optimistic query transforms. */
export function familyPendingQuerySelector(name: string): PendingQuerySelector {
  if (!frameworkWireIdentityIsValid(name)) {
    throw new TypeError('Kovo pending-query family names must be non-empty scalar strings.');
  }
  return freezeSecurityValue({ kind: 'family' as const, name });
}

/** @internal Read exact structured query identities from canonical `kovo-deps` tokens. */
export function readQueryDependencyIdentities(
  value: string | null,
): FrameworkQueryDependencyIdentity[] {
  const entries = readCanonicalQueryDependencies(value);
  const identities: FrameworkQueryDependencyIdentity[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = securityOwnArrayEntry(entries, index);
    if (!entry.ok) throw new TypeError('Kovo dependency entries must be dense.');
    securityArrayAppend(identities, entry.value.identity, 'Kovo dependency identity snapshot');
  }
  return identities;
}

/** @internal Preserve exact canonical DOM dependency bytes for stateless target requests. */
export function readQueryDependencyTokens(value: string | null): string[] {
  const entries = readCanonicalQueryDependencies(value);
  const tokens: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = securityOwnArrayEntry(entries, index);
    if (!entry.ok) throw new TypeError('Kovo dependency entries must be dense.');
    securityArrayAppend(tokens, entry.value.token, 'Kovo dependency token snapshot');
  }
  return tokens;
}

function readCanonicalQueryDependencies(value: string | null): Array<{
  identity: FrameworkQueryDependencyIdentity;
  token: string;
}> {
  const source = value ?? '';
  if (source.length > FRAMEWORK_WIRE_INPUT_GRAMMAR.maxHeaderCharacters) {
    throw new TypeError('Kovo dependency input exceeds its bounded wire length.');
  }
  const entries: Array<{ identity: FrameworkQueryDependencyIdentity; token: string }> = [];
  let start = 0;
  for (let index = 0; index <= source.length; index += 1) {
    const character = index === source.length ? ' ' : (source[index] ?? '');
    if (character !== ' ') continue;
    if (index > start) {
      const token = securityStringSlice(source, start, index);
      const identity = decodeFrameworkQueryDependencyToken(token);
      if (identity === undefined) {
        throw new TypeError('Kovo dependency input must contain canonical query identity tokens.');
      }
      if (entries.length === FRAMEWORK_WIRE_INPUT_GRAMMAR.maxEntries) {
        throw new TypeError('Kovo dependency input exceeds its bounded identity count.');
      }
      for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
        const existing = securityOwnArrayEntry(entries, entryIndex);
        if (!existing.ok) throw new TypeError('Kovo dependency entries must be dense.');
        if (
          existing.value.identity.name === identity.name &&
          existing.value.identity.key === identity.key
        ) {
          throw new TypeError('Kovo dependency identities must be unique.');
        }
      }
      securityArrayAppend(entries, { identity, token }, 'Kovo dependency entry snapshot');
    }
    start = index + 1;
  }
  return entries;
}

function dependencyDisplays(identities: readonly FrameworkQueryDependencyIdentity[]): string[] {
  const dependencies: string[] = [];
  for (let index = 0; index < identities.length; index += 1) {
    const identity = identities[index];
    if (!identity) continue;
    securityArrayAppend(
      dependencies,
      identity.key ?? identity.name,
      'Kovo dependency display snapshot',
    );
  }
  return dependencies;
}

function dependencyIdentityIsAffected(
  identity: FrameworkQueryDependencyIdentity,
  affected: readonly PendingQuerySelector[],
): boolean {
  for (let index = 0; index < affected.length; index += 1) {
    const selector = securityOwnArrayEntry(affected, index);
    if (!selector.ok) throw new TypeError('Kovo pending-query selectors must be dense.');
    if (selector.value.name !== identity.name) continue;
    if (selector.value.kind === 'family') return true;
    if (selector.value.key === identity.key) return true;
  }
  return false;
}

function exactPendingQuerySelector(
  identity: FrameworkQueryDependencyIdentity,
): PendingQuerySelector {
  return freezeSecurityValue(
    identity.key === undefined
      ? { kind: 'exact' as const, name: identity.name }
      : { key: identity.key, kind: 'exact' as const, name: identity.name },
  );
}

function snapshotPendingQuerySelectors(
  selectors: readonly PendingQuerySelector[],
): PendingQuerySelector[] {
  if (!securityArrayIsArray(selectors) || selectors.length > 100_000) {
    throw new TypeError('Kovo pending-query selectors must be a bounded array.');
  }
  const snapshot: PendingQuerySelector[] = [];
  for (let index = 0; index < selectors.length; index += 1) {
    const selector = securityOwnArrayEntry(selectors, index);
    if (!selector.ok || selector.value === null || typeof selector.value !== 'object') {
      throw new TypeError('Kovo pending-query selectors must be dense objects.');
    }
    const kind = securityGetOwnPropertyDescriptor(selector.value, 'kind');
    const name = securityGetOwnPropertyDescriptor(selector.value, 'name');
    const key = securityGetOwnPropertyDescriptor(selector.value, 'key');
    if (
      !kind ||
      !('value' in kind) ||
      (kind.value !== 'exact' && kind.value !== 'family') ||
      !name ||
      !('value' in name) ||
      !frameworkWireIdentityIsValid(name.value) ||
      (key && (!('value' in key) || !frameworkWireIdentityIsValid(key.value))) ||
      (kind.value === 'family' && key !== undefined)
    ) {
      throw new TypeError('Kovo pending-query selectors must carry valid own-data identity facts.');
    }
    securityArrayAppend(
      snapshot,
      kind.value === 'family'
        ? familyPendingQuerySelector(name.value)
        : freezeSecurityValue(
            key && 'value' in key
              ? { key: key.value as string, kind: 'exact' as const, name: name.value }
              : { kind: 'exact' as const, name: name.value },
          ),
      'Kovo pending-query selector snapshot',
    );
  }
  return snapshot;
}
