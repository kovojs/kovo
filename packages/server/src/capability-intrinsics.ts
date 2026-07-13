/** Boot-pinned controls for capability signing, verification, routing, and replay state. */

const NativeCrypto = globalThis.crypto;
const NativeDate = globalThis.Date;
const NativeError = globalThis.Error;
const NativeJSON = globalThis.JSON;
const NativeMap = globalThis.Map;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeRequest = globalThis.Request;
const NativeString = globalThis.String;
const NativeTextDecoder = globalThis.TextDecoder;
const NativeTextEncoder = globalThis.TextEncoder;
const NativeTypeError = globalThis.TypeError;
const NativeUint8Array = globalThis.Uint8Array;
const NativeURL = globalThis.URL;
const NativeURLSearchParams = globalThis.URLSearchParams;
const nativeAtob = globalThis.atob;
const nativeBtoa = globalThis.btoa;
const nativeCryptoGetRandomValues = NativeCrypto.getRandomValues;
const nativeDateNow = NativeDate.now;
const nativeDecodeURIComponent = globalThis.decodeURIComponent;
const nativeEncodeURIComponent = globalThis.encodeURIComponent;
const nativeJsonParse = NativeJSON.parse;
const nativeJsonStringify = NativeJSON.stringify;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeReflectApply = NativeReflect.apply;
const nativeMapDelete = NativeMap.prototype.delete;
const nativeMapEntries = NativeMap.prototype.entries;
const nativeMapGet = NativeMap.prototype.get;
const nativeMapHas = NativeMap.prototype.has;
const nativeMapSet = NativeMap.prototype.set;
const nativeMapSizeGetter = getter(NativeMap.prototype, 'size');
const nativeNumberIsFinite = NativeNumber.isFinite;
const nativeNumberIsSafeInteger = NativeNumber.isSafeInteger;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeObjectFreeze = NativeObject.freeze;
const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeObjectIs = NativeObject.is;
const nativeObjectIsFrozen = NativeObject.isFrozen;
const nativeObjectPrototype = NativeObject.prototype;
const nativeReflectConstruct = NativeReflect.construct;
const nativeReflectOwnKeys = NativeReflect.ownKeys;
const nativeRequestMethodGetter = getter(NativeRequest.prototype, 'method');
const nativeRequestUrlGetter = getter(NativeRequest.prototype, 'url');
const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
const nativeStringFromCharCode = NativeString.fromCharCode;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeStringSlice = NativeString.prototype.slice;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
const nativeStringToUpperCase = NativeString.prototype.toUpperCase;
const nativeStringTrim = NativeString.prototype.trim;
const nativeTextDecoderDecode = NativeTextDecoder.prototype.decode;
const nativeTextEncoderEncode = NativeTextEncoder.prototype.encode;
const nativeUint8ArrayLengthGetter = inheritedGetter(NativeUint8Array.prototype, 'length');
const nativeUint8ArraySet = NativeUint8Array.prototype.set;
const nativeUrlPathnameGetter = getter(NativeURL.prototype, 'pathname');
const nativeUrlSearchParamsGetter = getter(NativeURL.prototype, 'searchParams');
const nativeUrlSearchParamsGet = NativeURLSearchParams.prototype.get;
const mapIteratorNext = mapEntriesIteratorNext();
const encoder = new NativeTextEncoder();
const decoder = new NativeTextDecoder('utf-8', { fatal: true });

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

function getter(prototype: object, property: PropertyKey): Function | undefined {
  return apply<PropertyDescriptor | undefined>(nativeObjectGetOwnPropertyDescriptor, NativeObject, [
    prototype,
    property,
  ])?.get;
}

function inheritedGetter(source: object, property: PropertyKey): Function | undefined {
  let owner: object | null = source;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [owner, property],
    );
    if (descriptor !== undefined)
      return typeof descriptor.get === 'function' ? descriptor.get : undefined;
    owner = apply<object | null>(nativeObjectGetPrototypeOf, NativeObject, [owner]);
  }
  return undefined;
}

function rawUint8ArrayLength(value: Uint8Array): number {
  if (nativeUint8ArrayLengthGetter === undefined) {
    throw new NativeTypeError('Native Uint8Array length is unavailable.');
  }
  return apply(nativeUint8ArrayLengthGetter, value, []);
}

function mapEntriesIteratorNext(): Function | undefined {
  try {
    const iterator = apply<IterableIterator<[unknown, unknown]>>(
      nativeMapEntries,
      new NativeMap(),
      [],
    );
    return iterator.next;
  } catch {
    return undefined;
  }
}

function capturedControlsAreSound(): boolean {
  try {
    const publicBytes = rawEncode('public.pdf');
    const privateBytes = rawEncode('private.pdf');
    const map = new NativeMap<string, number>();
    apply(nativeMapSet, map, ['used', 10]);
    const entries = rawMapEntries(map);
    const random = rawRandomBytes(12);
    const url = rawUrl('https://app.test/files/private.pdf?kovo-cap=token');
    const frozen = apply<object>(nativeObjectFreeze, NativeObject, [{ safe: true }]);
    let rejectsInvalidUtf8 = false;
    try {
      rawDecode(new NativeUint8Array([0xff]));
    } catch {
      rejectsInvalidUtf8 = true;
    }
    return (
      rawUint8ArrayLength(publicBytes) === 10 &&
      publicBytes[0] === 0x70 &&
      publicBytes[9] === 0x66 &&
      rawUint8ArrayLength(privateBytes) === 11 &&
      privateBytes[0] === 0x70 &&
      rawDecode(publicBytes) === 'public.pdf' &&
      rejectsInvalidUtf8 &&
      apply(nativeMapGet, map, ['used']) === 10 &&
      apply(nativeMapGet, map, ['other']) === undefined &&
      apply(nativeMapHas, map, ['used']) === true &&
      apply(nativeMapHas, map, ['other']) === false &&
      entries.length === 1 &&
      entries[0]?.[0] === 'used' &&
      entries[0]?.[1] === 10 &&
      rawUint8ArrayLength(random) === 12 &&
      hasNonZeroByte(random) &&
      rawBase64Url(publicBytes) === 'cHVibGljLnBkZg' &&
      rawUint8ArrayLength(rawFromBase64Url('cHVibGljLnBkZg')!) ===
        rawUint8ArrayLength(publicBytes) &&
      apply<{ v?: unknown }>(nativeJsonParse, NativeJSON, ['{"v":"v1"}']).v === 'v1' &&
      apply(nativeJsonStringify, NativeJSON, ['private.pdf']) === '"private.pdf"' &&
      apply(nativeNumberIsFinite, NativeNumber, [1]) === true &&
      apply(nativeNumberIsFinite, NativeNumber, [1 / 0]) === false &&
      apply(nativeNumberIsSafeInteger, NativeNumber, [1]) === true &&
      apply(nativeNumberIsSafeInteger, NativeNumber, [1.5]) === false &&
      apply(nativeStringTrim, ' private.pdf ', []) === 'private.pdf' &&
      apply(nativeStringToLowerCase, 'PrIvAtE', []) === 'private' &&
      apply<number>(nativeDateNow, NativeDate, []) > 1_000_000_000_000 &&
      rawUrlPathname(url) === '/files/private.pdf' &&
      rawUrlParam(url, 'kovo-cap') === 'token' &&
      apply(nativeEncodeURIComponent, undefined, ['a/b']) === 'a%2Fb' &&
      apply(nativeDecodeURIComponent, undefined, ['a%2Fb']) === 'a/b' &&
      apply(nativeObjectGetPrototypeOf, NativeObject, [frozen]) === nativeObjectPrototype &&
      apply(nativeObjectIs, NativeObject, [frozen, frozen]) === true &&
      apply(nativeObjectIsFrozen, NativeObject, [frozen]) === true
    );
  } catch {
    return false;
  }
}

const capturedControlsSound = capturedControlsAreSound();

export function assertCapabilityIntrinsics(): void {
  if (!capturedControlsSound) {
    throw new NativeTypeError(
      'Kovo capability controls are unavailable because server realm intrinsics were modified before framework initialization.',
    );
  }
}

export function capabilityNow(): number {
  assertCapabilityIntrinsics();
  return apply(nativeDateNow, NativeDate, []);
}

export function capabilityEncode(value: string): Uint8Array {
  assertCapabilityIntrinsics();
  return rawEncode(value);
}

export function capabilityDecode(value: Uint8Array): string {
  assertCapabilityIntrinsics();
  return rawDecode(value);
}

export function capabilityUint8Array(length: number): Uint8Array {
  assertCapabilityIntrinsics();
  return new NativeUint8Array(length);
}

export function capabilityUint8ArrayLength(value: Uint8Array): number {
  assertCapabilityIntrinsics();
  return rawUint8ArrayLength(value);
}

export function capabilityUint8ArraySet(
  target: Uint8Array,
  source: Uint8Array,
  offset: number,
): void {
  assertCapabilityIntrinsics();
  apply(nativeUint8ArraySet, target, [source, offset]);
}

export function capabilityRandomBytes(length: number): Uint8Array {
  assertCapabilityIntrinsics();
  return rawRandomBytes(length);
}

export function capabilityBase64Url(value: Uint8Array): string {
  assertCapabilityIntrinsics();
  return rawBase64Url(value);
}

export function capabilityFromBase64Url(value: string): Uint8Array | undefined {
  assertCapabilityIntrinsics();
  return rawFromBase64Url(value) ?? undefined;
}

export function capabilityJsonParse(value: string): unknown {
  assertCapabilityIntrinsics();
  return apply(nativeJsonParse, NativeJSON, [value]);
}

export function capabilityJsonQuote(value: string): string {
  assertCapabilityIntrinsics();
  return apply(nativeJsonStringify, NativeJSON, [value]);
}

export function capabilityString(value: unknown): string {
  assertCapabilityIntrinsics();
  return apply(NativeString, undefined, [value]);
}

export function capabilityStringCharCodeAt(value: string, index: number): number {
  assertCapabilityIntrinsics();
  return apply(nativeStringCharCodeAt, value, [index]);
}

export function capabilityStringIndexOf(value: string, search: string, position = 0): number {
  assertCapabilityIntrinsics();
  return apply(nativeStringIndexOf, value, [search, position]);
}

export function capabilityStringSlice(value: string, start: number, end?: number): string {
  assertCapabilityIntrinsics();
  return end === undefined
    ? apply(nativeStringSlice, value, [start])
    : apply(nativeStringSlice, value, [start, end]);
}

export function capabilityStringToUpperCase(value: string): string {
  assertCapabilityIntrinsics();
  return apply(nativeStringToUpperCase, value, []);
}

export function capabilityStringToLowerCase(value: string): string {
  assertCapabilityIntrinsics();
  return apply(nativeStringToLowerCase, value, []);
}

export function capabilityStringTrim(value: string): string {
  assertCapabilityIntrinsics();
  return apply(nativeStringTrim, value, []);
}

export function capabilityIsFinite(value: number): boolean {
  assertCapabilityIntrinsics();
  return apply(nativeNumberIsFinite, NativeNumber, [value]);
}

export function capabilityIsSafeInteger(value: number): boolean {
  assertCapabilityIntrinsics();
  return apply(nativeNumberIsSafeInteger, NativeNumber, [value]);
}

export function createCapabilityMap<Key, Value>(): Map<Key, Value> {
  assertCapabilityIntrinsics();
  return new NativeMap<Key, Value>();
}

export function capabilityMapDelete<Key>(map: Map<Key, unknown>, key: Key): boolean {
  assertCapabilityIntrinsics();
  return apply(nativeMapDelete, map, [key]);
}

export function capabilityMapEntries<Key, Value>(map: Map<Key, Value>): Array<[Key, Value]> {
  assertCapabilityIntrinsics();
  return rawMapEntries(map) as Array<[Key, Value]>;
}

export function capabilityMapGet<Key, Value>(map: Map<Key, Value>, key: Key): Value | undefined {
  assertCapabilityIntrinsics();
  return apply(nativeMapGet, map, [key]);
}

export function capabilityMapHas<Key>(map: Map<Key, unknown>, key: Key): boolean {
  assertCapabilityIntrinsics();
  return apply(nativeMapHas, map, [key]);
}

export function capabilityMapSet<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  assertCapabilityIntrinsics();
  apply(nativeMapSet, map, [key, value]);
}

export function capabilityMapSize(map: Map<unknown, unknown>): number {
  assertCapabilityIntrinsics();
  if (nativeMapSizeGetter === undefined)
    throw new NativeTypeError('Native Map size is unavailable.');
  return apply(nativeMapSizeGetter, map, []);
}

export function capabilityOwnDataValue(value: object, property: PropertyKey): unknown {
  assertCapabilityIntrinsics();
  const before = apply<PropertyDescriptor | undefined>(
    nativeObjectGetOwnPropertyDescriptor,
    NativeObject,
    [value, property],
  );
  const after = apply<PropertyDescriptor | undefined>(
    nativeObjectGetOwnPropertyDescriptor,
    NativeObject,
    [value, property],
  );
  if (!sameDataDescriptor(before, after)) {
    throw new NativeTypeError(
      `Capability option ${capabilityString(property)} changed while read.`,
    );
  }
  if (before === undefined) return undefined;
  if (!('value' in before)) {
    throw new NativeTypeError(
      `Capability option ${capabilityString(property)} must be a data property.`,
    );
  }
  return before.value;
}

export function capabilityGetOwnPropertyDescriptor(
  value: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  assertCapabilityIntrinsics();
  return apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, property]);
}

export function capabilityGetPrototypeOf(value: object): object | null {
  assertCapabilityIntrinsics();
  return apply(nativeObjectGetPrototypeOf, NativeObject, [value]);
}

export function capabilityHasRecordPrototype(value: object): boolean {
  assertCapabilityIntrinsics();
  const prototype = apply<object | null>(nativeObjectGetPrototypeOf, NativeObject, [value]);
  return prototype === nativeObjectPrototype || prototype === null;
}

export function capabilityObjectIs(left: unknown, right: unknown): boolean {
  assertCapabilityIntrinsics();
  return apply(nativeObjectIs, NativeObject, [left, right]);
}

export function capabilityStableProperty(source: object, property: PropertyKey): unknown {
  assertCapabilityIntrinsics();
  let owner: object | null = source;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const before = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [owner, property],
    );
    const prototype: object | null = apply(nativeObjectGetPrototypeOf, NativeObject, [owner]);
    const after = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [owner, property],
    );
    if (!sameDataDescriptor(before, after)) {
      throw new NativeTypeError(
        `Capability ${capabilityString(property)} changed while it was pinned.`,
      );
    }
    if (before !== undefined) {
      if (!('value' in before)) {
        throw new NativeTypeError(
          `Capability ${capabilityString(property)} must be a data property.`,
        );
      }
      return before.value;
    }
    if (apply(nativeObjectGetPrototypeOf, NativeObject, [owner]) !== prototype) {
      throw new NativeTypeError(
        `Capability ${capabilityString(property)} prototype changed while it was pinned.`,
      );
    }
    owner = prototype;
  }
  return undefined;
}

export function capabilityOwnKeys(value: object): PropertyKey[] {
  assertCapabilityIntrinsics();
  return apply(nativeReflectOwnKeys, NativeReflect, [value]);
}

export function capabilityDefineProperty<Value extends object>(
  value: Value,
  property: PropertyKey,
  descriptor: PropertyDescriptor,
): Value {
  assertCapabilityIntrinsics();
  return apply(nativeObjectDefineProperty, NativeObject, [value, property, descriptor]);
}

export function capabilityFreeze<Value extends object>(value: Value): Readonly<Value> {
  assertCapabilityIntrinsics();
  return apply(nativeObjectFreeze, NativeObject, [value]);
}

export function capabilityReflectApply<Return>(
  fn: Function,
  receiver: unknown,
  args: readonly unknown[],
): Return {
  assertCapabilityIntrinsics();
  return apply(fn, receiver, args);
}

export function capabilityRequestMethod(request: Request): string {
  assertCapabilityIntrinsics();
  if (nativeRequestMethodGetter === undefined)
    throw new NativeTypeError('Native Request method is unavailable.');
  return apply(nativeRequestMethodGetter, request, []);
}

export function capabilityRequestUrl(request: Request): string {
  assertCapabilityIntrinsics();
  if (nativeRequestUrlGetter === undefined)
    throw new NativeTypeError('Native Request URL is unavailable.');
  return apply(nativeRequestUrlGetter, request, []);
}

export function capabilityUrl(value: string): URL {
  assertCapabilityIntrinsics();
  return rawUrl(value);
}

export function capabilityUrlPathname(url: URL): string {
  assertCapabilityIntrinsics();
  return rawUrlPathname(url);
}

export function capabilityUrlParam(url: URL, name: string): string | null {
  assertCapabilityIntrinsics();
  return rawUrlParam(url, name);
}

export function capabilityEncodeURIComponent(value: string): string {
  assertCapabilityIntrinsics();
  return apply(nativeEncodeURIComponent, undefined, [value]);
}

export function capabilityDecodeURIComponent(value: string): string {
  assertCapabilityIntrinsics();
  return apply(nativeDecodeURIComponent, undefined, [value]);
}

export function capabilityError(message: string): Error {
  assertCapabilityIntrinsics();
  return apply<Error>(nativeReflectConstruct, NativeReflect, [NativeError, [message]]);
}

export function capabilityTypeError(message: string): TypeError {
  assertCapabilityIntrinsics();
  return apply<TypeError>(nativeReflectConstruct, NativeReflect, [NativeTypeError, [message]]);
}

function rawEncode(value: string): Uint8Array {
  return apply(nativeTextEncoderEncode, encoder, [value]);
}

function rawDecode(value: Uint8Array): string {
  return apply(nativeTextDecoderDecode, decoder, [value]);
}

function rawRandomBytes(length: number): Uint8Array {
  const bytes = new NativeUint8Array(length);
  return apply(nativeCryptoGetRandomValues, NativeCrypto, [bytes]);
}

function rawMapEntries(map: Map<unknown, unknown>): Array<[unknown, unknown]> {
  if (mapIteratorNext === undefined)
    throw new NativeTypeError('Native Map iteration is unavailable.');
  const iterator = apply<IterableIterator<[unknown, unknown]>>(nativeMapEntries, map, []);
  const entries: Array<[unknown, unknown]> = [];
  while (true) {
    const result = apply<IteratorResult<[unknown, unknown]>>(mapIteratorNext, iterator, []);
    if (result.done) return entries;
    const entry: [unknown, unknown] = [result.value[0], result.value[1]];
    const index = entries.length;
    apply(nativeObjectDefineProperty, NativeObject, [
      entries,
      index,
      {
        configurable: true,
        enumerable: true,
        value: entry,
        writable: true,
      },
    ]);
    const committed = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [entries, index],
    );
    if (
      committed === undefined ||
      !('value' in committed) ||
      committed.value !== entry ||
      entries.length !== index + 1
    ) {
      throw new NativeTypeError('Capability Map entry own-data commit failed.');
    }
  }
}

function rawBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const length = rawUint8ArrayLength(bytes);
  for (let index = 0; index < length; index += 1) {
    binary += apply(nativeStringFromCharCode, NativeString, [bytes[index]!]);
  }
  const encoded = apply<string>(nativeBtoa, globalThis, [binary]);
  let result = '';
  for (let index = 0; index < encoded.length; index += 1) {
    const code = apply<number>(nativeStringCharCodeAt, encoded, [index]);
    if (code === 0x3d) break;
    result += code === 0x2b ? '-' : code === 0x2f ? '_' : encoded[index];
  }
  return result;
}

function rawFromBase64Url(value: string): Uint8Array | null {
  if (value === '' || value.length % 4 === 1) return null;
  let standard = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = apply<number>(nativeStringCharCodeAt, value, [index]);
    if (!isBase64UrlCode(code)) return null;
    standard += code === 0x2d ? '+' : code === 0x5f ? '/' : value[index];
  }
  while (standard.length % 4 !== 0) standard += '=';
  try {
    const binary = apply<string>(nativeAtob, globalThis, [standard]);
    const bytes = new NativeUint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = apply(nativeStringCharCodeAt, binary, [index]);
    }
    if (rawBase64Url(bytes) !== value) return null;
    return bytes;
  } catch {
    return null;
  }
}

function rawUrl(value: string): URL {
  return apply(nativeReflectConstruct, NativeReflect, [NativeURL, [value]]);
}

function rawUrlPathname(url: URL): string {
  if (nativeUrlPathnameGetter === undefined)
    throw new NativeTypeError('Native URL pathname is unavailable.');
  return apply(nativeUrlPathnameGetter, url, []);
}

function rawUrlParam(url: URL, name: string): string | null {
  if (nativeUrlSearchParamsGetter === undefined)
    throw new NativeTypeError('Native URL search params are unavailable.');
  const params = apply<URLSearchParams>(nativeUrlSearchParamsGetter, url, []);
  return apply(nativeUrlSearchParamsGet, params, [name]);
}

function isBase64UrlCode(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    code === 0x2d ||
    code === 0x5f
  );
}

function hasNonZeroByte(bytes: Uint8Array): boolean {
  const length = rawUint8ArrayLength(bytes);
  for (let index = 0; index < length; index += 1) {
    if (bytes[index] !== 0) return true;
  }
  return false;
}

function sameDataDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    'value' in left &&
    'value' in right &&
    apply<boolean>(nativeObjectIs, NativeObject, [left.value, right.value]) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}
