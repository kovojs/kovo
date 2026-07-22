import { frameworkWireIdentityIsValid } from '@kovojs/core/internal/wire-input-grammar';

import { queryStoreKey } from './query-store.js';
import {
  securityMap,
  securityMapGet,
  securityMapSet,
} from './security-witness-intrinsics.js';

// This module is instantiated once per browser build/document. HMR build replacement reloads the
// document, so the private map is also the `(identity, build)` metadata ledger. Query updates that
// omit href intentionally preserve the prior server-emitted fact; a conflicting redefinition is a
// protocol error rather than mutable navigation authority.
const refetchHrefs = securityMap<string, string>();

/** @internal Retain one server-emitted canonical typed-read href for an exact query identity. */
export function rememberQueryRefetchHref(
  name: string,
  key: string | undefined,
  href: string | undefined,
): void {
  if (href === undefined) return;
  if (
    !frameworkWireIdentityIsValid(name) ||
    (key !== undefined && !frameworkWireIdentityIsValid(key)) ||
    !frameworkWireIdentityIsValid(href) ||
    href.length > 65_536
  ) {
    throw new TypeError('Kovo query refetch metadata contains invalid identity or href facts.');
  }
  const identity = queryStoreKey(name, key);
  const existing = securityMapGet(refetchHrefs, identity);
  if (existing !== undefined && existing !== href) {
    throw new TypeError('Kovo query refetch metadata conflicts for one exact query identity.');
  }
  securityMapSet(refetchHrefs, identity, href);
}

/** @internal Read the snapshotted href without consulting mutable DOM. */
export function queryRefetchHref(name: string, key: string | undefined): string | undefined {
  return securityMapGet(refetchHrefs, queryStoreKey(name, key));
}
