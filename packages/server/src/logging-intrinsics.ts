/**
 * Boot-pinned scalar controls for observability redaction and log neutralization.
 *
 * Evaluated app modules share the server realm. Diagnostic sinks must therefore avoid dispatching
 * through mutable String prototype methods after app evaluation (SPEC §6.6).
 */

const NativeArray = globalThis.Array;
const NativeError = globalThis.Error;
const NativeFunction = globalThis.Function;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeString = globalThis.String;
const NativeURL = globalThis.URL;
const NativeURLSearchParams = globalThis.URLSearchParams;
const nativeArrayIsArray = NativeArray.isArray;
const nativeEncodeURIComponent = globalThis.encodeURIComponent;
const nativeFunctionHasInstance = NativeFunction.prototype[Symbol.hasInstance];
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeReflectApply = NativeReflect.apply;
const nativeReflectConstruct = NativeReflect.construct;
const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeStringSlice = NativeString.prototype.slice;
const nativeUrlHrefGetter = getGetter(NativeURL.prototype, 'href');
const nativeUrlHashGetter = getGetter(NativeURL.prototype, 'hash');
const nativeUrlPathnameGetter = getGetter(NativeURL.prototype, 'pathname');
const nativeUrlSearchGetter = getGetter(NativeURL.prototype, 'search');
const nativeUrlSearchParamsGetter = getGetter(NativeURL.prototype, 'searchParams');
const nativeUrlSearchParamsKeys = NativeURLSearchParams.prototype.keys;
const nativeUrlSearchParamsIteratorNext = urlSearchParamsIteratorNext();

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

function getGetter(prototype: object, property: PropertyKey): Function | undefined {
  return apply<PropertyDescriptor | undefined>(nativeObjectGetOwnPropertyDescriptor, NativeObject, [
    prototype,
    property,
  ])?.get;
}

function urlSearchParamsIteratorNext(): Function | undefined {
  try {
    const searchParams = new NativeURLSearchParams('probe=value');
    const iterator = apply<IterableIterator<string>>(nativeUrlSearchParamsKeys, searchParams, []);
    return iterator.next;
  } catch {
    return undefined;
  }
}

function capturedControlsAreSound(): boolean {
  try {
    const url = constructUrl(
      'https://user:password@example.test/callback?code=SECRET&a%20b=value#fragment',
    );
    const parts = readUrlParts(url);
    return (
      apply(NativeString, undefined, [42]) === '42' &&
      apply(nativeArrayIsArray, NativeArray, [[]]) === true &&
      apply(nativeArrayIsArray, NativeArray, [{}]) === false &&
      apply(nativeFunctionHasInstance, NativeError, [new NativeError('probe')]) === true &&
      apply(nativeFunctionHasInstance, NativeError, [{}]) === false &&
      apply(nativeStringCharCodeAt, '\n', [0]) === 10 &&
      apply(nativeStringIndexOf, 'safe token safe', ['token', 0]) === 5 &&
      apply(nativeStringIndexOf, 'safe token safe', ['missing', 0]) === -1 &&
      apply(nativeStringSlice, 'safe token safe', [5, 10]) === 'token' &&
      parts.href ===
        'https://user:password@example.test/callback?code=SECRET&a%20b=value#fragment' &&
      parts.pathname === '/callback' &&
      parts.search === '?code=SECRET&a%20b=value' &&
      parts.hash === '#fragment' &&
      parts.encodedQueryKeys.length === 2 &&
      parts.encodedQueryKeys[0] === 'code' &&
      parts.encodedQueryKeys[1] === 'a%20b'
    );
  } catch {
    return false;
  }
}

const capturedControlsSound = capturedControlsAreSound();

export function assertLoggingIntrinsics(): void {
  if (!capturedControlsSound) {
    throw new TypeError(
      'Kovo logging controls are unavailable because server realm intrinsics were modified before framework initialization.',
    );
  }
}

export function loggingString(value: unknown): string {
  assertLoggingIntrinsics();
  return apply(NativeString, undefined, [value]);
}

export function loggingIsArray(value: unknown): value is unknown[] {
  assertLoggingIntrinsics();
  return apply(nativeArrayIsArray, NativeArray, [value]);
}

export function loggingIsError(value: unknown): value is Error {
  assertLoggingIntrinsics();
  return apply(nativeFunctionHasInstance, NativeError, [value]);
}

export function loggingCreateError(message: string): Error {
  assertLoggingIntrinsics();
  return apply<Error>(nativeReflectConstruct, NativeReflect, [NativeError, [message]]);
}

export function loggingReplaceAllLiteral(
  value: string,
  search: string,
  replacement: string,
): string {
  assertLoggingIntrinsics();
  if (search === '') return value;

  let result = '';
  let cursor = 0;
  while (cursor <= value.length) {
    const match = apply<number>(nativeStringIndexOf, value, [search, cursor]);
    if (match < 0) {
      result += apply<string>(nativeStringSlice, value, [cursor]);
      return result;
    }
    result += apply<string>(nativeStringSlice, value, [cursor, match]) + replacement;
    cursor = match + search.length;
  }
  return result;
}

export function loggingNeutralizeControlCharacters(value: string): string {
  assertLoggingIntrinsics();
  let result = '';
  let cursor = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = apply<number>(nativeStringCharCodeAt, value, [index]);
    if (!isLogControlCode(code)) continue;
    result += apply<string>(nativeStringSlice, value, [cursor, index]) + visibleControlEscape(code);
    cursor = index + 1;
  }
  return cursor === 0 ? value : result + apply<string>(nativeStringSlice, value, [cursor]);
}

export interface LoggingDiagnosticUrlParts {
  encodedQueryKeys: string[];
  hash: string;
  href: string;
  pathname: string;
  search: string;
}

export function loggingDiagnosticUrlParts(value: string): LoggingDiagnosticUrlParts | undefined {
  assertLoggingIntrinsics();
  try {
    return readUrlParts(constructUrl(value));
  } catch {
    return undefined;
  }
}

export function loggingHasAbsoluteUrlScheme(value: string): boolean {
  assertLoggingIntrinsics();
  if (value.length < 2 || !isAsciiAlpha(characterCodeAt(value, 0))) return false;
  for (let index = 1; index < value.length; index += 1) {
    const code = characterCodeAt(value, index);
    if (code === 0x3a) return true;
    if (
      !isAsciiAlpha(code) &&
      !isAsciiDigit(code) &&
      code !== 0x2b &&
      code !== 0x2d &&
      code !== 0x2e
    ) {
      return false;
    }
  }
  return false;
}

function constructUrl(value: string): URL {
  return apply<URL>(nativeReflectConstruct, NativeReflect, [
    NativeURL,
    [value, 'https://kovo.invalid'],
  ]);
}

function readUrlParts(url: URL): LoggingDiagnosticUrlParts {
  if (
    nativeUrlHrefGetter === undefined ||
    nativeUrlHashGetter === undefined ||
    nativeUrlPathnameGetter === undefined ||
    nativeUrlSearchGetter === undefined ||
    nativeUrlSearchParamsGetter === undefined ||
    nativeUrlSearchParamsIteratorNext === undefined
  ) {
    throw new TypeError('Native URL controls are unavailable.');
  }
  const searchParams = apply<URLSearchParams>(nativeUrlSearchParamsGetter, url, []);
  const iterator = apply<IterableIterator<string>>(nativeUrlSearchParamsKeys, searchParams, []);
  const encodedQueryKeys: string[] = [];
  while (true) {
    const result = apply<IteratorResult<string>>(nativeUrlSearchParamsIteratorNext, iterator, []);
    if (result.done) break;
    encodedQueryKeys[encodedQueryKeys.length] = apply<string>(nativeEncodeURIComponent, undefined, [
      result.value,
    ]);
  }
  return {
    encodedQueryKeys,
    hash: apply(nativeUrlHashGetter, url, []),
    href: apply(nativeUrlHrefGetter, url, []),
    pathname: apply(nativeUrlPathnameGetter, url, []),
    search: apply(nativeUrlSearchGetter, url, []),
  };
}

function characterCodeAt(value: string, index: number): number {
  return apply(nativeStringCharCodeAt, value, [index]);
}

function isAsciiAlpha(code: number): boolean {
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function isAsciiDigit(code: number): boolean {
  return code >= 0x30 && code <= 0x39;
}

function isLogControlCode(code: number): boolean {
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
}

function visibleControlEscape(code: number): string {
  const hex = '0123456789abcdef';
  return (
    '\\u' +
    apply<string>(nativeStringSlice, hex, [(code >>> 12) & 0xf, ((code >>> 12) & 0xf) + 1]) +
    apply<string>(nativeStringSlice, hex, [(code >>> 8) & 0xf, ((code >>> 8) & 0xf) + 1]) +
    apply<string>(nativeStringSlice, hex, [(code >>> 4) & 0xf, ((code >>> 4) & 0xf) + 1]) +
    apply<string>(nativeStringSlice, hex, [code & 0xf, (code & 0xf) + 1])
  );
}
