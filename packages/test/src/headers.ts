import { canonicalJsonStringify } from '@kovojs/core/internal/json';
import {
  verifierArrayJoin,
  verifierArraySlice,
  verifierDenseArraySnapshot,
  verifierGetOwnPropertyDescriptor,
  verifierHeadersValues,
  verifierIsArray,
  verifierIsProxy,
  verifierObjectKeys,
  verifierStringIndexOf,
  verifierStringSlice,
  verifierStringToLowerCase,
  verifierTypeError,
} from './verifier-security-intrinsics.js';

/** A plain header bag accepted by the header helpers alongside a `Headers` instance. */
export type HeaderRecord = Record<string, string | string[] | undefined>;

/** Read all values for header `name` from a `Headers` or {@link HeaderRecord}, case-insensitively (handles `set-cookie`). */
export function headerValues(source: Headers | HeaderRecord | undefined, name: string): string[] {
  if (!source) return [];

  const normalizedName = verifierStringToLowerCase(name);
  const nativeValues = verifierHeadersValues(source, name, normalizedName === 'set-cookie');
  if (nativeValues !== undefined) return nativeValues;
  if (verifierIsProxy(source)) {
    throw verifierTypeError('Header records must not be Proxy objects.');
  }

  const keys = verifierObjectKeys(source);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (verifierStringToLowerCase(key) !== normalizedName) continue;
    const value = ownDataValue(source, key, 'Header records');
    if (value === undefined || value === '') return [];
    if (typeof value === 'string') return [value];
    const snapshot = verifierDenseArraySnapshot(value, `Header record ${key}`, (entry) => {
      if (typeof entry !== 'string') {
        throw verifierTypeError(`Header record ${key} must contain only string values.`);
      }
      return entry;
    });
    return verifierArraySlice(snapshot);
  }
  return [];
}

/** Read all `set-cookie` header values from a `Headers` or {@link HeaderRecord}. */
export function setCookieValues(source: Headers | HeaderRecord | undefined): string[] {
  return headerValues(source, 'set-cookie');
}

/** Return the `name=value` pair of a raw `set-cookie` string (drops attributes). */
export function cookiePair(setCookie: string | undefined): string {
  if (setCookie === undefined) return '';
  const separator = verifierStringIndexOf(setCookie, ';');
  return separator === -1 ? setCookie : verifierStringSlice(setCookie, 0, separator);
}

/** Return the `name=value` pair of the first `set-cookie` on a `Headers` or {@link HeaderRecord}. */
export function firstSetCookiePair(source: Headers | HeaderRecord | undefined): string {
  return cookiePair(setCookieValues(source)[0]);
}

/** Structured mutation target selection for enhanced scenario requests. */
export interface EnhancedMutationTarget {
  queries?: readonly string[] | string;
  target: string;
}

/** Structured live-target descriptor for enhanced scenario requests. */
export interface EnhancedMutationLiveTarget {
  component: string;
  props?: Record<string, unknown>;
  target: string;
}

/** Options for {@link enhancedMutationHeaders}; targets follow the mutation wire protocol in SPEC.md §9.1. */
export interface EnhancedMutationHeaderOptions {
  formTarget?: string;
  liveTargets?: readonly (EnhancedMutationLiveTarget | string)[] | string;
  targets?: readonly (EnhancedMutationTarget | string)[] | string;
}

/** Build the enhanced-mutation request headers used by app scenario tests (SPEC.md §9.1). */
export function enhancedMutationHeaders(
  options: EnhancedMutationHeaderOptions = {},
): Record<string, string> {
  if (verifierIsProxy(options)) {
    throw verifierTypeError('Enhanced mutation header options must not be a Proxy object.');
  }
  const formTarget = optionalOwnDataValue(options, 'formTarget', 'Enhanced mutation options');
  const liveTargets = optionalOwnDataValue(options, 'liveTargets', 'Enhanced mutation options');
  const targets = optionalOwnDataValue(options, 'targets', 'Enhanced mutation options');
  if (formTarget !== undefined && typeof formTarget !== 'string') {
    throw verifierTypeError('Enhanced mutation formTarget must be a string.');
  }
  return {
    'Kovo-Fragment': 'true',
    ...(formTarget === undefined ? {} : { 'Kovo-Form-Target': formTarget }),
    'Kovo-Live-Targets': headerList(liveTargets),
    'Kovo-Targets': headerList(targets),
  };
}

function headerList(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  const values = verifierDenseArraySnapshot(value, 'Enhanced mutation target list', (entry) =>
    headerListItem(entry),
  );
  return verifierArrayJoin(values, '; ');
}

function headerListItem(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null || verifierIsArray(value)) {
    throw verifierTypeError('Enhanced mutation target entries must be strings or plain objects.');
  }
  if (verifierIsProxy(value)) {
    throw verifierTypeError('Enhanced mutation target entries must not be Proxy objects.');
  }

  const component = optionalOwnDataValue(value, 'component', 'Enhanced live target');
  const target = requiredStringOwnDataValue(value, 'target', 'Enhanced mutation target');
  if (component !== undefined) {
    if (typeof component !== 'string') {
      throw verifierTypeError('Enhanced live target component must be a string.');
    }
    const props = optionalOwnDataValue(value, 'props', 'Enhanced live target');
    const json = canonicalJsonStringify(props ?? {}, { root: 'enhanced live target props' });
    return `${target}#${component}:${json}`;
  }
  const queries = optionalOwnDataValue(value, 'queries', 'Enhanced mutation target');
  if (queries === undefined) return target;
  if (typeof queries === 'string') return `${target}=${queries}`;
  const queryValues = verifierDenseArraySnapshot(
    queries,
    'Enhanced mutation query list',
    (entry) => {
      if (typeof entry !== 'string') {
        throw verifierTypeError('Enhanced mutation query names must be strings.');
      }
      return entry;
    },
  );
  return `${target}=${verifierArrayJoin(queryValues, ' ')}`;
}

function optionalOwnDataValue(value: object, property: PropertyKey, label: string): unknown {
  const descriptor = verifierGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined) return undefined;
  if (!('value' in descriptor)) {
    throw verifierTypeError(`${label} ${String(property)} must be an own data property.`);
  }
  return descriptor.value;
}

function ownDataValue(value: object, property: PropertyKey, label: string): unknown {
  const descriptor = verifierGetOwnPropertyDescriptor(value, property);
  if (descriptor === undefined || !('value' in descriptor)) {
    throw verifierTypeError(`${label} ${String(property)} must be an own data property.`);
  }
  return descriptor.value;
}

function requiredStringOwnDataValue(value: object, property: PropertyKey, label: string): string {
  const result = ownDataValue(value, property, label);
  if (typeof result !== 'string') {
    throw verifierTypeError(`${label} ${String(property)} must be a string.`);
  }
  return result;
}
