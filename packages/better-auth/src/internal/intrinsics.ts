/** Boot-pinned controls for Better Auth redirect and session-evidence classification. */

const NativeDate = globalThis.Date;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeResponse = globalThis.Response;
const NativeString = globalThis.String;
const nativeDateNow = NativeDate.now;
const nativeDateParse = NativeDate.parse;
const nativeNumberIsNaN = NativeNumber.isNaN;
const nativeNumberIsSafeInteger = NativeNumber.isSafeInteger;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeReflectApply = NativeReflect.apply;
const nativeRegExpExec = RegExp.prototype.exec;
const nativeResponseClone = getMethod(NativeResponse.prototype, 'clone');
const nativeResponseHeadersGetter = getGetter(NativeResponse.prototype, 'headers');
const nativeResponseJson = getMethod(NativeResponse.prototype, 'json');
const nativeResponseStatusGetter = getGetter(NativeResponse.prototype, 'status');
const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeStringSlice = NativeString.prototype.slice;
const nativeStringSplit = NativeString.prototype.split;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
const nativeStringTrim = NativeString.prototype.trim;

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

function getGetter(prototype: object, property: PropertyKey): Function | undefined {
  return apply<PropertyDescriptor | undefined>(nativeObjectGetOwnPropertyDescriptor, NativeObject, [
    prototype,
    property,
  ])?.get;
}

function getMethod(prototype: object, property: PropertyKey): Function | undefined {
  const descriptor = apply<PropertyDescriptor | undefined>(
    nativeObjectGetOwnPropertyDescriptor,
    NativeObject,
    [prototype, property],
  );
  return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'function'
    ? descriptor.value
    : undefined;
}

function capturedControlsAreSound(): boolean {
  try {
    const match = apply<RegExpExecArray | null>(nativeRegExpExec, /^safe$/u, ['safe']);
    const miss = apply<RegExpExecArray | null>(nativeRegExpExec, /^safe$/u, ['unsafe']);
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [{ safe: 42 }, 'safe'],
    );
    const response = new NativeResponse('{"ok":true}', {
      headers: { 'content-type': 'application/json' },
      status: 201,
    });
    return (
      match?.[0] === 'safe' &&
      miss === null &&
      descriptor !== undefined &&
      'value' in descriptor &&
      descriptor.value === 42 &&
      apply(nativeStringCharCodeAt, '\n', [0]) === 10 &&
      apply(nativeStringIndexOf, 'sid=value', ['=']) === 3 &&
      apply(nativeStringSlice, 'sid=value', [4]) === 'value' &&
      apply<string[]>(nativeStringSplit, 'sid=value; Path=/', [';']).length === 2 &&
      apply(nativeStringToLowerCase, 'EXPIRES', []) === 'expires' &&
      apply(nativeStringTrim, ' safe ', []) === 'safe' &&
      apply(nativeDateParse, NativeDate, ['Thu, 01 Jan 1970 00:00:00 GMT']) === 0 &&
      apply(nativeDateParse, NativeDate, ['Tue, 19 Jan 2038 03:14:07 GMT']) === 2_147_483_647_000 &&
      apply<number>(nativeDateNow, NativeDate, []) > 1_000_000_000_000 &&
      apply(nativeNumberIsNaN, NativeNumber, [0 / 0]) === true &&
      apply(nativeNumberIsNaN, NativeNumber, [0]) === false &&
      apply(nativeNumberIsSafeInteger, NativeNumber, [1]) === true &&
      apply(nativeNumberIsSafeInteger, NativeNumber, [1.5]) === false &&
      readNativeResponseStatus(response) === 201 &&
      readNativeResponseHeaders(response) !== undefined &&
      nativeResponseClone !== undefined &&
      nativeResponseJson !== undefined
    );
  } catch {
    return false;
  }
}

const capturedControlsSound = capturedControlsAreSound();

export function assertBetterAuthIntrinsics(): void {
  if (!capturedControlsSound) {
    throw new TypeError(
      'Kovo Better Auth controls are unavailable because server realm intrinsics were modified before framework initialization.',
    );
  }
}

export function betterAuthApply<Return>(
  fn: Function,
  receiver: unknown,
  args: readonly unknown[],
): Return {
  assertBetterAuthIntrinsics();
  return apply(fn, receiver, args);
}

export function betterAuthCharacterCodeAt(value: string, index: number): number {
  assertBetterAuthIntrinsics();
  return apply(nativeStringCharCodeAt, value, [index]);
}

export function betterAuthDateNow(): number {
  assertBetterAuthIntrinsics();
  return apply(nativeDateNow, NativeDate, []);
}

export function betterAuthDateParse(value: string): number {
  assertBetterAuthIntrinsics();
  return apply(nativeDateParse, NativeDate, [value]);
}

export function betterAuthGetOwnPropertyDescriptor(
  value: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  assertBetterAuthIntrinsics();
  return apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, property]);
}

export function betterAuthCaptureOwnApiMethod(
  auth: object,
  methodName: PropertyKey,
  label: string,
): { method: Function; receiver: object } {
  const apiDescriptor = betterAuthGetOwnPropertyDescriptor(auth, 'api');
  if (
    apiDescriptor === undefined ||
    !('value' in apiDescriptor) ||
    !isObject(apiDescriptor.value)
  ) {
    throw new TypeError(`${label}.api must be a stable own-data object.`);
  }
  const receiver = apiDescriptor.value;
  return betterAuthCaptureOwnMethod(receiver, methodName, `${label}.api`);
}

export function betterAuthCaptureOwnMethod(
  receiver: object,
  methodName: PropertyKey,
  label: string,
): { method: Function; receiver: object } {
  const methodDescriptor = betterAuthGetOwnPropertyDescriptor(receiver, methodName);
  if (
    methodDescriptor === undefined ||
    !('value' in methodDescriptor) ||
    typeof methodDescriptor.value !== 'function'
  ) {
    throw new TypeError(`${label}.${String(methodName)} must be a stable own-data method.`);
  }
  return { method: methodDescriptor.value, receiver };
}

export function betterAuthDefineOwnData<Value>(
  target: object,
  property: PropertyKey,
  value: Value,
  label: string,
): void {
  assertBetterAuthIntrinsics();
  apply(nativeObjectDefineProperty, NativeObject, [
    target,
    property,
    {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    },
  ]);
  const committed = betterAuthGetOwnPropertyDescriptor(target, property);
  if (committed === undefined || !('value' in committed) || committed.value !== value) {
    throw new TypeError(`${label} own-data commit failed.`);
  }
}

export function betterAuthArrayAppend<Value>(target: Value[], value: Value, label: string): void {
  assertBetterAuthIntrinsics();
  const length = betterAuthGetOwnPropertyDescriptor(target, 'length');
  if (
    length === undefined ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    !apply(nativeNumberIsSafeInteger, NativeNumber, [length.value]) ||
    length.value < 0 ||
    length.value >= 100_000
  ) {
    throw new TypeError(`${label} must have a bounded own array length.`);
  }
  betterAuthDefineOwnData(target, length.value, value, label);
}

export function betterAuthSnapshotDenseArray<Value>(
  source: readonly Value[],
  label: string,
): Value[] {
  assertBetterAuthIntrinsics();
  const length = betterAuthGetOwnPropertyDescriptor(source, 'length');
  if (
    length === undefined ||
    !('value' in length) ||
    typeof length.value !== 'number' ||
    !apply(nativeNumberIsSafeInteger, NativeNumber, [length.value]) ||
    length.value < 0 ||
    length.value >= 100_000
  ) {
    throw new TypeError(`${label} must have a bounded own array length.`);
  }

  const snapshot: Value[] = [];
  for (let index = 0; index < length.value; index += 1) {
    const entry = betterAuthGetOwnPropertyDescriptor(source, index);
    if (entry === undefined || !('value' in entry)) {
      throw new TypeError(`${label} must contain dense own data entries.`);
    }
    betterAuthArrayAppend(snapshot, entry.value as Value, label);
  }
  return snapshot;
}

export function betterAuthIndexOf(value: string, search: string, position = 0): number {
  assertBetterAuthIntrinsics();
  return apply(nativeStringIndexOf, value, [search, position]);
}

export function betterAuthIsNaN(value: number): boolean {
  assertBetterAuthIntrinsics();
  return apply(nativeNumberIsNaN, NativeNumber, [value]);
}

export function betterAuthIsSafeInteger(value: number): boolean {
  assertBetterAuthIntrinsics();
  return apply(nativeNumberIsSafeInteger, NativeNumber, [value]);
}

export function betterAuthRegExpExec(pattern: RegExp, value: string): RegExpExecArray | null {
  assertBetterAuthIntrinsics();
  pattern.lastIndex = 0;
  return apply(nativeRegExpExec, pattern, [value]);
}

export function betterAuthResponseHeaders(value: object): Headers | undefined {
  assertBetterAuthIntrinsics();
  const native = readNativeResponseHeaders(value);
  if (native !== undefined) return native;
  const descriptor = betterAuthGetOwnPropertyDescriptor(value, 'headers');
  return descriptor !== undefined && 'value' in descriptor && isObject(descriptor.value)
    ? (descriptor.value as Headers)
    : undefined;
}

export function betterAuthResponseStatus(value: object): number | undefined {
  assertBetterAuthIntrinsics();
  const native = readNativeResponseStatus(value);
  if (native !== undefined) return native;
  const descriptor = betterAuthGetOwnPropertyDescriptor(value, 'status');
  return descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'number'
    ? descriptor.value
    : undefined;
}

export function betterAuthResponseJson(value: object): unknown {
  assertBetterAuthIntrinsics();
  if (nativeResponseClone !== undefined && nativeResponseJson !== undefined) {
    try {
      readNativeResponseStatus(value);
      const cloned = apply<object>(nativeResponseClone, value, []);
      return apply(nativeResponseJson, cloned, []);
    } catch {}
  }

  const clone = betterAuthGetOwnPropertyDescriptor(value, 'clone');
  if (clone !== undefined && 'value' in clone && typeof clone.value === 'function') {
    try {
      const cloned = betterAuthApply<unknown>(clone.value, value, []);
      if (isObject(cloned)) {
        const json = betterAuthGetOwnPropertyDescriptor(cloned, 'json');
        if (json !== undefined && 'value' in json && typeof json.value === 'function') {
          return betterAuthApply(json.value, cloned, []);
        }
      }
    } catch {}
  }
  const json = betterAuthGetOwnPropertyDescriptor(value, 'json');
  if (json !== undefined && 'value' in json && typeof json.value === 'function') {
    try {
      return betterAuthApply(json.value, value, []);
    } catch {}
  }
  return undefined;
}

export function betterAuthSlice(value: string, start: number, end?: number): string {
  assertBetterAuthIntrinsics();
  return end === undefined
    ? apply(nativeStringSlice, value, [start])
    : apply(nativeStringSlice, value, [start, end]);
}

export function betterAuthSplit(value: string, separator: string, limit?: number): string[] {
  assertBetterAuthIntrinsics();
  return limit === undefined
    ? apply(nativeStringSplit, value, [separator])
    : apply(nativeStringSplit, value, [separator, limit]);
}

export function betterAuthToLowerCase(value: string): string {
  assertBetterAuthIntrinsics();
  return apply(nativeStringToLowerCase, value, []);
}

export function betterAuthTrim(value: string): string {
  assertBetterAuthIntrinsics();
  return apply(nativeStringTrim, value, []);
}

function readNativeResponseHeaders(value: object): Headers | undefined {
  if (nativeResponseHeadersGetter === undefined) return undefined;
  try {
    return apply(nativeResponseHeadersGetter, value, []);
  } catch {
    return undefined;
  }
}

function readNativeResponseStatus(value: object): number | undefined {
  if (nativeResponseStatusGetter === undefined) return undefined;
  try {
    return apply(nativeResponseStatusGetter, value, []);
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function';
}
