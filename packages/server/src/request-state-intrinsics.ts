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
const NativeJSON = globalThis.JSON;
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
const nativeJsonParse = NativeJSON.parse;
const nativeJsonStringify = NativeJSON.stringify;
const nativeMathCeil = NativeMath.ceil;
const nativeNumberIsSafeInteger = NativeNumber.isSafeInteger;
const nativePromiseCatch = NativePromise.prototype.catch;
const nativePromiseThen = NativePromise.prototype.then;
const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
const nativeStringCharAt = NativeString.prototype.charAt;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeStringLastIndexOf = NativeString.prototype.lastIndexOf;
const nativeStringSlice = NativeString.prototype.slice;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
const nativeStringToUpperCase = NativeString.prototype.toUpperCase;
const nativeStringTrim = NativeString.prototype.trim;
const nativeRegExpExec = RegExp.prototype.exec;
const nativeUrlHash = ownDescriptor(NativeURL.prototype, 'hash')?.get;
const nativeUrlHostname = ownDescriptor(NativeURL.prototype, 'hostname')?.get;
const nativeUrlHref = ownDescriptor(NativeURL.prototype, 'href')?.get;
const nativeUrlOrigin = ownDescriptor(NativeURL.prototype, 'origin')?.get;
const nativeUrlPathname = ownDescriptor(NativeURL.prototype, 'pathname')?.get;
const nativeUrlSearch = ownDescriptor(NativeURL.prototype, 'search')?.get;
const nativeUrlSearchParams = ownDescriptor(NativeURL.prototype, 'searchParams')?.get;
const nativeUrlSearchParamsSet = globalThis.URLSearchParams.prototype.set;

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
    if (
      !(
        apply(nativePromiseThen, promiseControl, [(value: string) => value]) instanceof
        NativePromise
      )
    ) {
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
    if (apply(nativeStringCharAt, 'kovo', [2]) !== 'v') return false;
    if (apply(nativeStringToLowerCase, 'KoVo', []) !== 'kovo') return false;
    if (apply(nativeStringToUpperCase, 'post', []) !== 'POST') return false;
    if (apply<string>(NativeString, undefined, [42]) !== '42') return false;
    const parsedJson = apply<unknown>(nativeJsonParse, NativeJSON, ['{"control":true}']);
    if (
      typeof parsedJson !== 'object' ||
      parsedJson === null ||
      (parsedJson as { control?: unknown }).control !== true
    ) {
      return false;
    }
    if (apply(nativeJsonStringify, NativeJSON, [['control', undefined]]) !== '["control",null]') {
      return false;
    }
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
      typeof nativeUrlHostname !== 'function' ||
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
    const ipv6Url = new NativeURL('http://[2001:0DB8:0:0:0:0:0:1]/');
    if (urlScalar(nativeUrlHostname, ipv6Url) !== '[2001:db8::1]') return false;
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

export function requestStateToLowerCase(value: string): string {
  assertRequestStateIntrinsics();
  return apply(nativeStringToLowerCase, value, []);
}

export function requestStateToUpperCase(value: string): string {
  assertRequestStateIntrinsics();
  return apply(nativeStringToUpperCase, value, []);
}

export function requestStateSlice(value: string, start: number, end?: number): string {
  assertRequestStateIntrinsics();
  return end === undefined
    ? apply(nativeStringSlice, value, [start])
    : apply(nativeStringSlice, value, [start, end]);
}

export function requestStateIndexOf(value: string, search: string): number {
  assertRequestStateIntrinsics();
  return apply(nativeStringIndexOf, value, [search]);
}

export function requestStateRegExpTest(expression: RegExp, value: string): boolean {
  assertRequestStateIntrinsics();
  return apply<RegExpExecArray | null>(nativeRegExpExec, expression, [value]) !== null;
}

export function requestStateBoundedControlToken(value: string, maxLength: number): string {
  assertRequestStateIntrinsics();
  let normalized = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = apply<number>(nativeStringCharCodeAt, value, [index]);
    normalized +=
      code < 32 || code === 127 ? ' ' : apply<string>(nativeStringCharAt, value, [index]);
  }
  const trimmed = apply<string>(nativeStringTrim, normalized, []);
  return apply(nativeStringSlice, trimmed, [0, maxLength]);
}

export function requestStateParseJson(value: string): unknown {
  assertRequestStateIntrinsics();
  return apply(nativeJsonParse, NativeJSON, [value]);
}

export function requestStateJsonStringify(value: unknown): string | undefined {
  assertRequestStateIntrinsics();
  return apply(nativeJsonStringify, NativeJSON, [value]);
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

function requestStateOwsSlice(value: string, start = 0, end = value.length): string {
  while (start < end) {
    const code = apply<number>(nativeStringCharCodeAt, value, [start]);
    if (code !== 32 && code !== 9) break;
    start += 1;
  }
  while (end > start) {
    const code = apply<number>(nativeStringCharCodeAt, value, [end - 1]);
    if (code !== 32 && code !== 9) break;
    end -= 1;
  }
  return apply(nativeStringSlice, value, [start, end]);
}

function requestStateStrictIpv4(value: string): string | undefined {
  if (value.length < 7 || value.length > 15) return undefined;
  let octets = 0;
  let digits = 0;
  let octet = 0;
  let leadingZero = false;
  let canonical = '';

  for (let index = 0; index <= value.length; index += 1) {
    const code =
      index === value.length ? 46 : apply<number>(nativeStringCharCodeAt, value, [index]);
    if (code === 46) {
      if (digits === 0 || octet > 255 || (leadingZero && digits > 1) || octets >= 4) {
        return undefined;
      }
      canonical += `${octets === 0 ? '' : '.'}${apply<string>(NativeString, undefined, [octet])}`;
      octets += 1;
      digits = 0;
      octet = 0;
      leadingZero = false;
      continue;
    }
    if (code < 48 || code > 57) return undefined;
    if (digits === 0) leadingZero = code === 48;
    digits += 1;
    if (digits > 3) return undefined;
    octet = octet * 10 + code - 48;
  }

  return octets === 4 ? canonical : undefined;
}

function requestStateHexWord(value: string): number | undefined {
  if (value.length < 1 || value.length > 4) return undefined;
  let parsed = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = apply<number>(nativeStringCharCodeAt, value, [index]);
    const digit =
      code >= 48 && code <= 57
        ? code - 48
        : code >= 65 && code <= 70
          ? code - 55
          : code >= 97 && code <= 102
            ? code - 87
            : -1;
    if (digit < 0) return undefined;
    parsed = parsed * 16 + digit;
  }
  return parsed;
}

function requestStateMappedIpv4(canonicalIpv6: string): string | undefined {
  if (!apply<boolean>(nativeStringStartsWith, canonicalIpv6, ['::ffff:'])) return undefined;
  const suffix = apply<string>(nativeStringSlice, canonicalIpv6, [7]);
  const separator = apply<number>(nativeStringIndexOf, suffix, [':']);
  if (
    separator <= 0 ||
    separator !== apply<number>(nativeStringLastIndexOf, suffix, [':']) ||
    separator >= suffix.length - 1
  ) {
    return undefined;
  }
  const upper = requestStateHexWord(apply(nativeStringSlice, suffix, [0, separator]));
  const lower = requestStateHexWord(apply(nativeStringSlice, suffix, [separator + 1]));
  if (upper === undefined || lower === undefined) return undefined;
  return `${upper >> 8}.${upper & 255}.${lower >> 8}.${lower & 255}`;
}

function requestStateCanonicalIpv6(value: string): string | undefined {
  if (value.length < 2 || value.length > 45) return undefined;
  let hasColon = false;
  let hasDot = false;
  for (let index = 0; index < value.length; index += 1) {
    const code = apply<number>(nativeStringCharCodeAt, value, [index]);
    if (code === 58) {
      hasColon = true;
      continue;
    }
    if (code === 46) {
      hasDot = true;
      continue;
    }
    const isHex =
      (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
    if (!isHex) return undefined;
  }
  if (!hasColon) return undefined;
  if (hasDot) {
    const finalColon = apply<number>(nativeStringLastIndexOf, value, [':']);
    if (
      finalColon < 0 ||
      requestStateStrictIpv4(apply(nativeStringSlice, value, [finalColon + 1])) === undefined
    ) {
      return undefined;
    }
  }

  try {
    const url = new NativeURL(`http://[${value}]/`);
    const hostname = urlScalar(nativeUrlHostname, url);
    if (
      hostname === undefined ||
      hostname.length < 4 ||
      apply<number>(nativeStringCharCodeAt, hostname, [0]) !== 91 ||
      apply<number>(nativeStringCharCodeAt, hostname, [hostname.length - 1]) !== 93
    ) {
      return undefined;
    }
    const canonical = apply<string>(nativeStringSlice, hostname, [1, hostname.length - 1]);
    return requestStateMappedIpv4(canonical) ?? canonical;
  } catch {
    return undefined;
  }
}

function requestStateValidPort(value: string): boolean {
  if (value.length < 1 || value.length > 5) return false;
  let port = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = apply<number>(nativeStringCharCodeAt, value, [index]);
    if (code < 48 || code > 57) return false;
    port = port * 10 + code - 48;
  }
  return port <= 65_535;
}

/**
 * Canonicalize one trusted-proxy node as an address-only key (SPEC §9.5). Brackets are required
 * when an IPv6 transport port is present. Bare valid IPv6 literals remain address literals; a
 * decimal suffix is never guessed to be a port.
 */
export function requestStateCanonicalClientIpValue(value: string | null): string | undefined {
  assertRequestStateIntrinsics();
  if (value === null) return undefined;
  const candidate = requestStateOwsSlice(value);
  if (candidate === '' || candidate.length > 53) return undefined;

  if (apply<number>(nativeStringCharCodeAt, candidate, [0]) === 91) {
    const closingBracket = apply<number>(nativeStringIndexOf, candidate, [']']);
    if (closingBracket <= 1) return undefined;
    const suffix = apply<string>(nativeStringSlice, candidate, [closingBracket + 1]);
    if (
      suffix !== '' &&
      (apply<number>(nativeStringCharCodeAt, suffix, [0]) !== 58 ||
        !requestStateValidPort(apply(nativeStringSlice, suffix, [1])))
    ) {
      return undefined;
    }
    return requestStateCanonicalIpv6(apply(nativeStringSlice, candidate, [1, closingBracket]));
  }

  const ipv4 = requestStateStrictIpv4(candidate);
  if (ipv4 !== undefined) return ipv4;
  const ipv6 = requestStateCanonicalIpv6(candidate);
  if (ipv6 !== undefined) return ipv6;

  const separator = apply<number>(nativeStringIndexOf, candidate, [':']);
  if (
    separator <= 0 ||
    separator !== apply<number>(nativeStringLastIndexOf, candidate, [':']) ||
    separator >= candidate.length - 1
  ) {
    return undefined;
  }
  const port = apply<string>(nativeStringSlice, candidate, [separator + 1]);
  if (!requestStateValidPort(port)) return undefined;
  return requestStateStrictIpv4(apply(nativeStringSlice, candidate, [0, separator]));
}

/** Resolve exactly the rightmost X-Forwarded-For hop and canonicalize its address-only key. */
export function requestStateRightmostHeaderListValue(value: string | null): string | undefined {
  assertRequestStateIntrinsics();
  if (value === null || value.length > 8_192) return undefined;
  const comma = apply<number>(nativeStringLastIndexOf, value, [',']);
  return requestStateCanonicalClientIpValue(apply(nativeStringSlice, value, [comma + 1]));
}

function requestStateIsHttpTokenCode(code: number): boolean {
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    code === 33 ||
    code === 35 ||
    code === 36 ||
    code === 37 ||
    code === 38 ||
    code === 39 ||
    code === 42 ||
    code === 43 ||
    code === 45 ||
    code === 46 ||
    code === 94 ||
    code === 95 ||
    code === 96 ||
    code === 124 ||
    code === 126
  );
}

function requestStateRightmostForwardedElement(value: string): string | undefined {
  let quoted = false;
  let escaped = false;
  let rightmostComma = -1;
  for (let index = 0; index < value.length; index += 1) {
    const code = apply<number>(nativeStringCharCodeAt, value, [index]);
    if (code === 13 || code === 10 || code === 0) return undefined;
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (code === 92) {
        escaped = true;
      } else if (code === 34) {
        quoted = false;
      }
    } else if (code === 34) {
      quoted = true;
    } else if (code === 44) {
      rightmostComma = index;
    }
  }
  if (quoted || escaped) return undefined;
  const element = requestStateOwsSlice(value, rightmostComma + 1);
  return element === '' ? undefined : element;
}

const MAX_FORWARDED_ELEMENT_PARAMETERS = 32;

/**
 * Resolve the rightmost RFC 7239 Forwarded element. Unknown, obfuscated, duplicate, malformed,
 * or non-IP `for` nodes fail closed instead of minting limiter identities (SPEC §9.5).
 */
export function requestStateRightmostForwardedForValue(value: string | null): string | undefined {
  assertRequestStateIntrinsics();
  if (value === null || value.length > 8_192) return undefined;
  const entry = requestStateRightmostForwardedElement(value);
  if (entry === undefined) return undefined;

  let index = 0;
  let forValue: string | undefined;
  let parameterCount = 0;
  let seenParameterNames = '';
  while (index < entry.length) {
    parameterCount += 1;
    // Keep duplicate detection linear in the bounded 8 KiB carrier. A normal Forwarded element
    // has at most by/for/host/proto plus a few extensions; a 33rd pair is adversarial ambiguity.
    if (parameterCount > MAX_FORWARDED_ELEMENT_PARAMETERS) return undefined;
    while (index < entry.length) {
      const code = apply<number>(nativeStringCharCodeAt, entry, [index]);
      if (code !== 32 && code !== 9) break;
      index += 1;
    }
    const nameStart = index;
    while (
      index < entry.length &&
      requestStateIsHttpTokenCode(apply(nativeStringCharCodeAt, entry, [index]))
    ) {
      index += 1;
    }
    if (index === nameStart) return undefined;
    const name = apply<string>(
      nativeStringToLowerCase,
      apply(nativeStringSlice, entry, [nameStart, index]),
      [],
    );
    const framedName = `\0${name}\0`;
    if (apply<number>(nativeStringIndexOf, seenParameterNames, [framedName]) >= 0) {
      return undefined;
    }
    seenParameterNames += framedName;
    if (index >= entry.length || apply<number>(nativeStringCharCodeAt, entry, [index]) !== 61) {
      return undefined;
    }
    index += 1;
    if (index >= entry.length) return undefined;

    let parsedValue = '';
    if (apply<number>(nativeStringCharCodeAt, entry, [index]) === 34) {
      index += 1;
      let closed = false;
      while (index < entry.length) {
        const code = apply<number>(nativeStringCharCodeAt, entry, [index]);
        if (code === 34) {
          closed = true;
          index += 1;
          break;
        }
        if (code === 92) {
          index += 1;
          if (index >= entry.length) return undefined;
          const escapedCode = apply<number>(nativeStringCharCodeAt, entry, [index]);
          if (escapedCode !== 9 && (escapedCode < 32 || escapedCode === 127 || escapedCode > 255)) {
            return undefined;
          }
          parsedValue += apply<string>(nativeStringCharAt, entry, [index]);
          index += 1;
          continue;
        }
        if (code !== 9 && (code < 32 || code === 127 || code > 255)) return undefined;
        parsedValue += apply<string>(nativeStringCharAt, entry, [index]);
        index += 1;
      }
      if (!closed) return undefined;
    } else {
      const valueStart = index;
      while (
        index < entry.length &&
        requestStateIsHttpTokenCode(apply(nativeStringCharCodeAt, entry, [index]))
      ) {
        index += 1;
      }
      if (index === valueStart) return undefined;
      parsedValue = apply(nativeStringSlice, entry, [valueStart, index]);
    }

    if (name === 'for') {
      if (forValue !== undefined) return undefined;
      forValue = parsedValue;
    }

    while (index < entry.length) {
      const code = apply<number>(nativeStringCharCodeAt, entry, [index]);
      if (code !== 32 && code !== 9) break;
      index += 1;
    }
    if (index === entry.length) break;
    if (apply<number>(nativeStringCharCodeAt, entry, [index]) !== 59) return undefined;
    index += 1;
    if (index === entry.length) return undefined;
  }

  if (forValue === undefined || requestStateOwsSlice(forValue) !== forValue) return undefined;
  const firstColon = apply<number>(nativeStringIndexOf, forValue, [':']);
  if (
    firstColon !== apply<number>(nativeStringLastIndexOf, forValue, [':']) &&
    apply<number>(nativeStringCharCodeAt, forValue, [0]) !== 91
  ) {
    return undefined;
  }
  return requestStateCanonicalClientIpValue(forValue);
}

const MAX_RATE_LIMIT_KEY_LENGTH = 1_024;

/**
 * Shared upper bound for raw identity components that are canonically length-framed into a
 * mutation replay scope. Three maximum-sized components must remain below the durable Postgres
 * store's 4,096-code-unit raw scope ceiling even after framing and the no-JS namespace prefix.
 */
export const MAX_MUTATION_REPLAY_IDENTITY_COMPONENT_LENGTH = 1_024;

export function requestStateIsBoundedMutationReplayIdentity(value: unknown): value is string {
  assertRequestStateIntrinsics();
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= MAX_MUTATION_REPLAY_IDENTITY_COMPONENT_LENGTH
  );
}

export function requestStateBoundedMutationReplayIdentity(
  value: unknown,
  description: string,
): string {
  if (!requestStateIsBoundedMutationReplayIdentity(value)) {
    throw new TypeError(
      `${description} must be a 1..${MAX_MUTATION_REPLAY_IDENTITY_COMPONENT_LENGTH}-code-unit string.`,
    );
  }
  return value;
}

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
    apply<boolean>(nativeStringStartsWith, value, ['/']) &&
    !apply<boolean>(nativeStringStartsWith, value, ['//']) &&
    !apply<boolean>(nativeStringStartsWith, value, ['/\\'])
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

export function requestStateAbsoluteUrlOrigin(value: string): string | undefined {
  assertRequestStateIntrinsics();
  try {
    const url = new NativeURL(value);
    return urlScalar(nativeUrlOrigin, url);
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
