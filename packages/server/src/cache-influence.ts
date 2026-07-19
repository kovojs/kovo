import { snapshotAuditJustification, snapshotAuditText } from './audit-justification.js';
import {
  witnessArrayAppend,
  witnessCreateNullRecord,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessIsArray,
} from './security-witness-intrinsics.js';
import {
  securityRegExpTest,
  securityStringToLowerCase,
} from './response-security-intrinsics.js';

/** A request dimension that contributes an external data version to the shared-cache key. */
export type SharedCacheKeyContribution =
  | { readonly axis: 'request-header'; readonly name: string }
  | { readonly axis: 'url-path' }
  | { readonly axis: 'url-search'; readonly name: string };

/** A versioned external data dependency and the cache-key dimension carrying its version. */
export interface SharedCacheExternalDataVersion {
  readonly key: SharedCacheKeyContribution;
  readonly name: string;
}

/**
 * Explicit source declaration consumed by the compiler's shared-cache generality proof.
 * `auditedEscape` retains an operator obligation; it is never positive compiler evidence.
 */
export interface SharedCacheInfluenceDeclaration {
  readonly auditedEscape?: {
    readonly name: string;
    readonly retainedObligation: string;
  };
  readonly externalDataVersions?: readonly SharedCacheExternalDataVersion[];
}

/** Snapshot app-authored cache influence metadata without treating it as a proof. @internal */
export function snapshotSharedCacheInfluenceDeclaration(
  value: unknown,
): SharedCacheInfluenceDeclaration {
  if (value === null || typeof value !== 'object' || witnessIsArray(value)) {
    throw new TypeError('cacheInfluence must be a stable own-data record.');
  }
  const externalSource = optionalOwnData(value, 'externalDataVersions', 'cacheInfluence');
  const auditedSource = optionalOwnData(value, 'auditedEscape', 'cacheInfluence');
  const externalDataVersions =
    externalSource === undefined ? undefined : snapshotExternalVersions(externalSource);
  const auditedEscape =
    auditedSource === undefined ? undefined : snapshotAuditedEscape(auditedSource);
  const snapshot = witnessCreateNullRecord<unknown>();
  if (externalDataVersions !== undefined) snapshot.externalDataVersions = externalDataVersions;
  if (auditedEscape !== undefined) snapshot.auditedEscape = auditedEscape;
  return witnessFreeze(snapshot) as unknown as SharedCacheInfluenceDeclaration;
}

function snapshotExternalVersions(value: unknown): readonly SharedCacheExternalDataVersion[] {
  if (!witnessIsArray(value) || value.length > 100) {
    throw new TypeError('cacheInfluence.externalDataVersions must be a bounded array.');
  }
  const result: SharedCacheExternalDataVersion[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`cacheInfluence.externalDataVersions[${index}] must be own data.`);
    }
    const entry = descriptor.value;
    if (entry === null || typeof entry !== 'object' || witnessIsArray(entry)) {
      throw new TypeError('cacheInfluence external data versions must be records.');
    }
    const name = snapshotAuditText(
      requiredOwnData(entry, 'name', 'cacheInfluence external data version'),
      'cacheInfluence external data version name',
    );
    const key = snapshotKeyContribution(
      requiredOwnData(entry, 'key', 'cacheInfluence external data version'),
    );
    witnessArrayAppend(
      result,
      witnessFreeze({ key, name }),
      'Shared cache external data versions',
    );
  }
  return witnessFreeze(result);
}

function snapshotKeyContribution(value: unknown): SharedCacheKeyContribution {
  if (value === null || typeof value !== 'object' || witnessIsArray(value)) {
    throw new TypeError('cacheInfluence external version key must be a record.');
  }
  const axis = requiredOwnData(value, 'axis', 'cacheInfluence key contribution');
  if (axis === 'url-path') return witnessFreeze({ axis });
  if (axis !== 'url-search' && axis !== 'request-header') {
    throw new TypeError('cacheInfluence key axis must be url-path, url-search, or request-header.');
  }
  const name = snapshotAuditText(
    requiredOwnData(value, 'name', 'cacheInfluence key contribution'),
    'cacheInfluence key contribution name',
  );
  if (axis === 'request-header') {
    const normalized = securityStringToLowerCase(name);
    if (!securityRegExpTest(/^[!#$%&'*+.^_`|~0-9a-z-]+$/u, normalized)) {
      throw new TypeError('cacheInfluence request-header key name must be an HTTP token.');
    }
    return witnessFreeze({ axis, name: normalized });
  }
  return witnessFreeze({ axis, name });
}

function snapshotAuditedEscape(value: unknown): NonNullable<SharedCacheInfluenceDeclaration['auditedEscape']> {
  if (value === null || typeof value !== 'object' || witnessIsArray(value)) {
    throw new TypeError('cacheInfluence.auditedEscape must be a record.');
  }
  return witnessFreeze({
    name: snapshotAuditText(
      requiredOwnData(value, 'name', 'cacheInfluence audited escape'),
      'cacheInfluence audited escape name',
    ),
    retainedObligation: snapshotAuditJustification(
      requiredOwnData(value, 'retainedObligation', 'cacheInfluence audited escape'),
      'cacheInfluence audited escape retainedObligation (SPEC §9.4)',
    ),
  });
}

function requiredOwnData(value: object, key: string, label: string): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw new TypeError(`${label}.${key} must be an own data property.`);
  }
  return descriptor.value;
}

function optionalOwnData(value: object, key: string, label: string): unknown {
  const descriptor = witnessGetOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) throw new TypeError(`${label}.${key} must be an own data property.`);
  return descriptor.value;
}
