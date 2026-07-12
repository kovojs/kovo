/**
 * Package-private intrinsic membrane for request-state security controls.
 *
 * Evaluated application modules share the server realm and can replace clocks, scalar parsers,
 * string helpers, URL controls, and header accessors. Rate-limit windows, replay truth, and login
 * redirects therefore use only the controls captured and semantically checked here (SPEC
 * §6.5/§9.5/§10.3).
 */

const NativeDate = globalThis.Date;
const NativeHeaders = globalThis.Headers;
const NativeMath = globalThis.Math;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativePromise = globalThis.Promise;
const NativeReflect = globalThis.Reflect;
const NativeString = globalThis.String;
const NativeURL = globalThis.URL;

const nativeReflectApply = NativeReflect.apply;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeDateNow = NativeDate.now;
const nativeDateGetTime = NativeDate.prototype.getTime;
const nativeHeadersGet = NativeHeaders.prototype.get;
const nativeMathCeil = NativeMath.ceil;
const nativeNumberIsSafeInteger = NativeNumber.isSafeInteger;
const nativePromiseCatch = NativePromise.prototype.catch;
const nativePromiseThen = NativePromise.prototype.then;
const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeStringLastIndexOf = NativeString.prototype.lastIndexOf;
const nativeStringSlice = NativeString.prototype.slice;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringTrim = NativeString.prototype.trim;
const nativeRegExpExec = RegExp.prototype.exec;
const nativeUrlHash = ownDescriptor(NativeURL.prototype, 'hash')?.get;
const nativeUrlHref = ownDescriptor(NativeURL.prototype, 'href')?.get;
const nativeUrlOrigin = ownDescriptor(NativeURL.prototype, 'origin')?.get;
const nativeUrlPathname = ownDescriptor(NativeURL.prototype, 'pathname')?.get;
const nativeUrlSearch = ownDescriptor(NativeURL.prototype, 'search')?.get;
const nativeUrlSearchParams = ownDescriptor(NativeURL.prototype, 'searchParams')?.get;
const nativeUrlSearchParamsSet = globalThis.URLSearchParams.prototype.set;
const forwardedForPattern = /(?:^|;)\s*for="?([^";,\s]+)"?/i;

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

function ownDescriptor(value: object, property: PropertyKey): PropertyDescriptor | undefined {
  return nativeReflectApply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [
    value,
    property,
  ]) as PropertyDescriptor | undefined;
}

function urlScalar(getter: Function | undefined, url: URL): string | undefined {
  return typeof getter === 'function' ? apply<string>(getter, url, []) : undefined;
}

function capturedRequestStateControlsAreSound(): boolean {
  try {
    if (apply(nativeReflectApply, NativeReflect, [NativeString, undefined, [42]]) !== '42') {
      return false;
    }
    if (ownDescriptor({ control: true }, 'control')?.value !== true) return false;
    if (apply(nativeNumberIsSafeInteger, NativeNumber, [1]) !== true) return false;
    if (apply(nativeNumberIsSafeInteger, NativeNumber, [1.5]) !== false) return false;
    if (apply(nativeNumberIsSafeInteger, NativeNumber, [Number.MAX_SAFE_INTEGER + 1]) !== false) {
      return false;
    }
    if (apply(nativeMathCeil, NativeMath, [1.01]) !== 2) return false;
    const promiseControl = new NativePromise<string>((resolve) => resolve('accepted'));
    if (!(apply(nativePromiseThen, promiseControl, [(value: string) => value]) instanceof NativePromise)) {
      return false;
    }
    if (!(apply(nativePromiseCatch, promiseControl, [() => 'rejected']) instanceof NativePromise)) {
      return false;
    }
    if (apply(nativeStringTrim, '  kovo  ', []) !== 'kovo') return false;
    if (apply(nativeStringStartsWith, '/safe', ['/']) !== true) return false;
    if (apply(nativeStringStartsWith, 'unsafe', ['/']) !== false) return false;
    if (apply(nativeStringIndexOf, 'a?b', ['?']) !== 1) return false;
    if (apply(nativeStringLastIndexOf, 'a,b,c', [',']) !== 3) return false;
    if (apply(nativeStringSlice, 'kovo', [1, 3]) !== 'ov') return false;
    if (apply(nativeStringCharCodeAt, '7', [0]) !== 55) return false;
    if (apply<string>(NativeString, undefined, [42]) !== '42') return false;
    const forwardedMatch = apply<RegExpExecArray | null>(nativeRegExpExec, forwardedForPattern, [
      'proto=https; for="203.0.113.9"',
    ]);
    if (forwardedMatch?.[1] !== '203.0.113.9') return false;

    const epoch = new NativeDate(0);
    if (apply(nativeDateGetTime, epoch, []) !== 0) return false;
    const now = apply<number>(nativeDateNow, NativeDate, []);
    const constructedNow = apply<number>(nativeDateGetTime, new NativeDate(), []);
    if (!apply(nativeNumberIsSafeInteger, NativeNumber, [now])) return false;
    const clockDifference = now >= constructedNow ? now - constructedNow : constructedNow - now;
    if (clockDifference > 5_000) return false;

    const headers = new NativeHeaders({ 'X-Kovo-Control': 'accepted' });
    if (apply(nativeHeadersGet, headers, ['x-kovo-control']) !== 'accepted') return false;
    if (apply(nativeHeadersGet, headers, ['x-kovo-missing']) !== null) return false;

    if (
      typeof nativeUrlHash !== 'function' ||
      typeof nativeUrlHref !== 'function' ||
      typeof nativeUrlOrigin !== 'function' ||
      typeof nativeUrlPathname !== 'function' ||
      typeof nativeUrlSearch !== 'function' ||
      typeof nativeUrlSearchParams !== 'function' ||
      typeof nativeUrlSearchParamsSet !== 'function'
    ) {
      return false;
    }
    const url = new NativeURL('/control?one=1#hash', 'https://kovo.local');
    if (urlScalar(nativeUrlOrigin, url) !== 'https://kovo.local') return false;
    if (urlScalar(nativeUrlPathname, url) !== '/control') return false;
    if (urlScalar(nativeUrlSearch, url) !== '?one=1') return false;
    if (urlScalar(nativeUrlHash, url) !== '#hash') return false;
    const searchParams = apply<URLSearchParams>(nativeUrlSearchParams, url, []);
    apply(nativeUrlSearchParamsSet, searchParams, ['one', '2']);
    if (urlScalar(nativeUrlSearch, url) !== '?one=2') return false;
    if (urlScalar(nativeUrlHref, url) !== 'https://kovo.local/control?one=2#hash') return false;
    return true;
  } catch {
    return false;
  }
}

const capturedRequestStateControlsSound = capturedRequestStateControlsAreSound();

export function assertRequestStateIntrinsics(): void {
  if (!capturedRequestStateControlsSound) {
    throw new TypeError(
      'Kovo request-state controls are unavailable because the server realm intrinsics were modified before framework initialization.',
    );
  }
}

export function requestStateNow(): number {
  assertRequestStateIntrinsics();
  return apply(nativeDateNow, NativeDate, []);
}

export function requestStateIsSafeInteger(value: unknown): value is number {
  assertRequestStateIntrinsics();
  return apply(nativeNumberIsSafeInteger, NativeNumber, [value]);
}

export function requestStateMax(left: number, right: number): number {
  assertRequestStateIntrinsics();
  return left >= right ? left : right;
}

export function requestStateRetryAfterSeconds(remainingMs: number): number {
  assertRequestStateIntrinsics();
  const seconds = apply<number>(nativeMathCeil, NativeMath, [remainingMs / 1_000]);
  return seconds < 1 ? 1 : seconds;
}

export function requestStateString(value: unknown): string {
  assertRequestStateIntrinsics();
  return apply(NativeString, undefined, [value]);
}

export function requestStatePromiseThen<Value, Result>(
  promise: Promise<Value>,
  onFulfilled: (value: Value) => Result | PromiseLike<Result>,
): Promise<Result> {
  assertRequestStateIntrinsics();
  return apply(nativePromiseThen, promise, [onFulfilled]);
}

export function requestStateIgnorePromiseRejection(promise: Promise<unknown>): void {
  assertRequestStateIntrinsics();
  apply(nativePromiseCatch, promise, [() => undefined]);
}

export function requestStateTrim(value: string): string {
  assertRequestStateIntrinsics();
  return apply(nativeStringTrim, value, []);
}

export function requestStateStartsWith(value: string, prefix: string): boolean {
  assertRequestStateIntrinsics();
  return apply(nativeStringStartsWith, value, [prefix]);
}

export function requestStatePathname(value: string): string {
  assertRequestStateIntrinsics();
  const query = apply<number>(nativeStringIndexOf, value, ['?']);
  const hash = apply<number>(nativeStringIndexOf, value, ['#']);
  const end = query < 0 ? hash : hash < 0 ? query : query < hash ? query : hash;
  return end < 0 ? value : apply(nativeStringSlice, value, [0, end]);
}

export function requestStateHeaderGet(headers: Headers, name: string): string | null {
  assertRequestStateIntrinsics();
  return apply(nativeHeadersGet, headers, [name]);
}

export function requestStateParseUnsignedInteger(value: string): number | undefined {
  assertRequestStateIntrinsics();
  if (value.length === 0) return undefined;
  let parsed = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = apply<number>(nativeStringCharCodeAt, value, [index]);
    if (code < 48 || code > 57) return undefined;
    parsed = parsed * 10 + code - 48;
    if (!apply(nativeNumberIsSafeInteger, NativeNumber, [parsed])) return undefined;
  }
  return parsed;
}

export function requestStateRightmostHeaderListValue(value: string | null): string | undefined {
  assertRequestStateIntrinsics();
  if (value === null) return undefined;
  let end = value.length;
  for (;;) {
    const comma = apply<number>(nativeStringLastIndexOf, value, [',', end - 1]);
    const candidate = apply<string>(nativeStringSlice, value, [comma + 1, end]);
    const trimmed = apply<string>(nativeStringTrim, candidate, []);
    if (trimmed !== '') return trimmed;
    if (comma < 0) return undefined;
    end = comma;
  }
}

export function requestStateRightmostForwardedForValue(
  value: string | null,
): string | undefined {
  assertRequestStateIntrinsics();
  if (value === null) return undefined;
  let end = value.length;
  for (;;) {
    const comma = apply<number>(nativeStringLastIndexOf, value, [',', end - 1]);
    const entry = apply<string>(nativeStringSlice, value, [comma + 1, end]);
    const match = apply<RegExpExecArray | null>(nativeRegExpExec, forwardedForPattern, [entry]);
    const candidate = match?.[1];
    if (candidate !== undefined) {
      const trimmed = apply<string>(nativeStringTrim, candidate, []);
      if (trimmed !== '') return trimmed;
    }
    if (comma < 0) return undefined;
    end = comma;
  }
}

const MAX_RATE_LIMIT_KEY_LENGTH = 1_024;

export function requestStateOptionalRateLimitKey(
  value: unknown,
  description: string,
): string | undefined {
  assertRequestStateIntrinsics();
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new TypeError(`${description} must return a string when it returns a value.`);
  }
  const trimmed = apply<string>(nativeStringTrim, value, []);
  if (trimmed === '') return undefined;
  if (trimmed.length > MAX_RATE_LIMIT_KEY_LENGTH) {
    throw new TypeError(
      `${description} returned a key longer than ${MAX_RATE_LIMIT_KEY_LENGTH} characters.`,
    );
  }
  return trimmed;
}

export function requestStateRequiredRateLimitKey(value: unknown, description: string): string {
  const key = requestStateOptionalRateLimitKey(value, description);
  if (key === undefined) throw new TypeError(`${description} must return a non-empty string.`);
  return key;
}

export function requestStateExactCompositeKey(first: unknown, second: unknown): string {
  assertRequestStateIntrinsics();
  if (typeof first !== 'string' || typeof second !== 'string') {
    throw new TypeError('Kovo replay scope and idempotency key must both be strings.');
  }
  // Length framing is injective even when either component contains NUL or delimiter text.
  return `${first.length}:${first}${second.length}:${second}`;
}

export function requestStateIsSingleLeadingSlashPath(value: string): boolean {
  assertRequestStateIntrinsics();
  return (
    apply(nativeStringStartsWith, value, ['/']) &&
    !apply(nativeStringStartsWith, value, ['//']) &&
    !apply(nativeStringStartsWith, value, ['/\\'])
  );
}

export function requestStateSameOriginPath(value: string, base: string): string | undefined {
  assertRequestStateIntrinsics();
  try {
    const url = new NativeURL(value, base);
    if (urlScalar(nativeUrlOrigin, url) !== base) return undefined;
    const pathname = urlScalar(nativeUrlPathname, url);
    const search = urlScalar(nativeUrlSearch, url);
    const hash = urlScalar(nativeUrlHash, url);
    if (pathname === undefined || search === undefined || hash === undefined) return undefined;
    const path = `${pathname}${search}${hash}`;
    return requestStateIsSingleLeadingSlashPath(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

export function requestStateLocationWithQuery(
  value: string,
  base: string,
  name: string,
  queryValue: string,
): string {
  assertRequestStateIntrinsics();
  const url = new NativeURL(value, base);
  if (typeof nativeUrlSearchParams !== 'function') {
    throw new TypeError('Kovo request-state URL query controls are unavailable.');
  }
  const searchParams = apply<URLSearchParams>(nativeUrlSearchParams, url, []);
  apply(nativeUrlSearchParamsSet, searchParams, [name, queryValue]);
  const origin = urlScalar(nativeUrlOrigin, url);
  const pathname = urlScalar(nativeUrlPathname, url);
  const search = urlScalar(nativeUrlSearch, url);
  const hash = urlScalar(nativeUrlHash, url);
  const href = urlScalar(nativeUrlHref, url);
  if (
    origin === undefined ||
    pathname === undefined ||
    search === undefined ||
    hash === undefined ||
    href === undefined
  ) {
    throw new TypeError('Kovo request-state URL scalar controls are unavailable.');
  }
  return origin === base ? `${pathname}${search}${hash}` : href;
}
