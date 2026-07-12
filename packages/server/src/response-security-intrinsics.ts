import { createHash, randomBytes, randomUUID } from 'node:crypto';

/**
 * Package-private intrinsic membrane for document, CSP, cookie, and CSRF response controls.
 *
 * Application modules execute in the server realm and can replace mutable prototype methods. The
 * response security floor therefore captures every load-bearing operation before application
 * evaluation, proves both its accepting and rejecting semantics, and dispatches only through the
 * captured functions afterwards (SPEC §6.6/§9.1/§9.5).
 */

const NativeArray = globalThis.Array;
const NativeBuffer = Buffer;
const NativeDate = globalThis.Date;
const NativeFunction = globalThis.Function;
const NativeJSON = globalThis.JSON;
const NativeMap = globalThis.Map;
const NativeMath = globalThis.Math;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeRegExp = globalThis.RegExp;
const NativeSet = globalThis.Set;
const NativeString = globalThis.String;
const NativeTextEncoder = globalThis.TextEncoder;
const NativeUint8Array = globalThis.Uint8Array;
const nativeCreateHash = createHash;
const nativeRandomBytes = randomBytes;
const nativeRandomUuid = randomUUID;

const nativeReflectApply = NativeReflect.apply;
const nativeArrayIsArray = NativeArray.isArray;
const nativeArrayJoin = NativeArray.prototype.join;
const nativeArrayPush = NativeArray.prototype.push;
const nativeBufferAllocUnsafe = NativeBuffer.allocUnsafe;
const nativeBufferFrom = NativeBuffer.from;
const nativeBufferToString = NativeBuffer.prototype.toString;
const nativeDateToUtcString = NativeDate.prototype.toUTCString;
const nativeEncodeURIComponent = globalThis.encodeURIComponent;
const nativeFunctionHasInstance = NativeFunction.prototype[Symbol.hasInstance];
const nativeJsonStringify = NativeJSON.stringify;
const nativeMapGet = NativeMap.prototype.get;
const nativeMapHas = NativeMap.prototype.has;
const nativeMapSet = NativeMap.prototype.set;
const nativeMathFloor = NativeMath.floor;
const nativeNumberIsFinite = NativeNumber.isFinite;
const nativeNumberIsInteger = NativeNumber.isInteger;
const nativeObjectCreate = NativeObject.create;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeObjectKeys = NativeObject.keys;
const nativeRegExpExec = NativeRegExp.prototype.exec;
const nativeSetAdd = NativeSet.prototype.add;
const nativeSetHas = NativeSet.prototype.has;
const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
const nativeStringIncludes = NativeString.prototype.includes;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeStringReplaceAll = NativeString.prototype.replaceAll;
const nativeStringSlice = NativeString.prototype.slice;
const nativeStringSplit = NativeString.prototype.split;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
const nativeStringTrim = NativeString.prototype.trim;
const nativeTextEncoderEncode = NativeTextEncoder.prototype.encode;

const hashControl = nativeCreateHash('sha256');
const nativeHashUpdate = stableOwnFunction(hashControl, 'update');
const nativeHashDigest = stableOwnFunction(hashControl, 'digest');
const textEncoder = new NativeTextEncoder();

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

function stableOwnFunction(value: object, property: PropertyKey): Function {
  let owner: object | null = value;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [owner, property],
    );
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new TypeError(`Kovo response security control ${String(property)} is unavailable.`);
      }
      return descriptor.value;
    }
    owner = apply(nativeObjectGetPrototypeOf, NativeObject, [owner]);
  }
  throw new TypeError(`Kovo response security control ${String(property)} is unavailable.`);
}

function capturedControlsAreSound(): boolean {
  try {
    const shell = ['<!doctype html>', '<html><body>safe</body></html>'];
    if (apply(nativeArrayJoin, shell, ['']) !== '<!doctype html><html><body>safe</body></html>') {
      return false;
    }
    const shellAttributes = [' lang="en"', ' data-shell="safe"'];
    if (apply(nativeArrayJoin, shellAttributes, ['']) !== ' lang="en" data-shell="safe"') {
      return false;
    }
    const pushed: string[] = [];
    if (apply(nativeArrayPush, pushed, ['safe']) !== 1 || pushed[0] !== 'safe') return false;
    if (apply(nativeArrayIsArray, NativeArray, [[]]) !== true) return false;
    if (apply(nativeArrayIsArray, NativeArray, [{}]) !== false) return false;

    const injectedDomain = 'example.test; Partitioned';
    if (apply(nativeStringIncludes, injectedDomain, [';']) !== true) return false;
    if (apply(nativeStringIncludes, 'example.test', [';']) !== false) return false;
    const tokenParts = apply<string[]>(nativeStringSplit, 'v1.attacker.attacker', ['.']);
    if (
      tokenParts.length !== 3 ||
      tokenParts[0] !== 'v1' ||
      tokenParts[1] !== 'attacker' ||
      tokenParts[2] !== 'attacker'
    ) {
      return false;
    }
    if (apply(nativeStringTrim, '  safe \t', []) !== 'safe') return false;
    if (apply(nativeStringTrim, '   ', []) !== '') return false;
    if (apply(nativeStringIndexOf, 'name=value', ['=']) !== 4) return false;
    if (apply(nativeStringIndexOf, 'name', ['=']) !== -1) return false;
    if (apply(nativeStringSlice, 'name=value', [5]) !== 'value') return false;
    if (apply(nativeStringToLowerCase, 'SameSite', []) !== 'samesite') return false;
    if (apply(nativeStringStartsWith, '__Host-id', ['__Host-']) !== true) return false;
    if (apply(nativeStringStartsWith, 'id', ['__Host-']) !== false) return false;
    if (apply(nativeStringStartsWith, 'data-safe', ['data-']) !== true) return false;
    if (apply(nativeStringStartsWith, 'onclick', ['data-']) !== false) return false;
    if (apply(nativeStringCharCodeAt, '\u007f', [0]) !== 0x7f) return false;
    if (apply(nativeStringReplaceAll, '&amp;&amp;', ['&amp;', '&']) !== '&&') return false;
    if (apply(NativeString, undefined, [42]) !== '42') return false;
    if (apply(NativeString, undefined, [null]) !== 'null') return false;

    const safeCookieName = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
    if (apply<RegExpExecArray | null>(nativeRegExpExec, safeCookieName, ['sid']) === null) {
      return false;
    }
    if (
      apply<RegExpExecArray | null>(nativeRegExpExec, safeCookieName, ['sid; Partitioned']) !== null
    ) {
      return false;
    }
    const invalidAttribute = /[\s"'=<>/\u0000-\u001f\u007f]/u;
    if (apply<RegExpExecArray | null>(nativeRegExpExec, invalidAttribute, ['data-safe']) !== null) {
      return false;
    }
    if (
      apply<RegExpExecArray | null>(nativeRegExpExec, invalidAttribute, [
        'data-evil" onclick="x',
      ]) === null
    ) {
      return false;
    }
    if (
      replaceRegExp(
        '<script>bad()</script><p>safe</p>',
        /<script\b[^>]*>[\s\S]*?<\/script>/giu,
        '',
      ) !== '<p>safe</p>'
    ) {
      return false;
    }
    if (
      replaceRegExp('</script><p>safe</p>', /<\/script/gi, '<\\/script') !==
      '<\\/script><p>safe</p>'
    ) {
      return false;
    }

    if (apply(nativeNumberIsInteger, NativeNumber, [2]) !== true) return false;
    if (apply(nativeNumberIsInteger, NativeNumber, [2.5]) !== false) return false;
    if (apply(nativeNumberIsFinite, NativeNumber, [2]) !== true) return false;
    if (apply(nativeNumberIsFinite, NativeNumber, [Infinity]) !== false) return false;
    if (apply(nativeMathFloor, NativeMath, [2.9]) !== 2) return false;
    if (apply(nativeEncodeURIComponent, undefined, ['a;b']) !== 'a%3Bb') return false;
    if (apply(nativeJsonStringify, NativeJSON, [{ safe: true }]) !== '{"safe":true}') return false;

    const map = new NativeMap<string, string>();
    apply(nativeMapSet, map, ['safe', 'value']);
    if (apply(nativeMapHas, map, ['safe']) !== true) return false;
    if (apply(nativeMapHas, map, ['attacker']) !== false) return false;
    if (apply(nativeMapGet, map, ['safe']) !== 'value') return false;
    if (apply(nativeMapGet, map, ['attacker']) !== undefined) return false;
    const set = new NativeSet<string>();
    apply(nativeSetAdd, set, ['safe']);
    if (apply(nativeSetHas, set, ['safe']) !== true) return false;
    if (apply(nativeSetHas, set, ['attacker']) !== false) return false;

    const date = new NativeDate('2026-01-02T03:04:05Z');
    if (apply(nativeFunctionHasInstance, NativeDate, [date]) !== true) return false;
    if (apply(nativeFunctionHasInstance, NativeDate, [{}]) !== false) return false;
    if (apply(nativeDateToUtcString, date, []) !== 'Fri, 02 Jan 2026 03:04:05 GMT') return false;

    const bytes = apply<Buffer>(nativeBufferFrom, NativeBuffer, ['safe', 'utf8']);
    if (apply(nativeBufferToString, bytes, ['base64url']) !== 'c2FmZQ') return false;
    const allocated = apply<Buffer>(nativeBufferAllocUnsafe, NativeBuffer, [4]);
    if (allocated.byteLength !== 4) return false;
    const encoded = apply<Uint8Array>(nativeTextEncoderEncode, textEncoder, ['safe']);
    if (encoded.byteLength !== 4 || encoded[0] !== 0x73 || encoded[3] !== 0x65) return false;
    if (apply(nativeFunctionHasInstance, NativeUint8Array, [encoded]) !== true) return false;
    if (apply(nativeFunctionHasInstance, NativeUint8Array, [{}]) !== false) return false;

    const hash = nativeCreateHash('sha256');
    apply(nativeHashUpdate, hash, ['abc']);
    if (
      apply(nativeHashDigest, hash, ['base64']) !== 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0='
    ) {
      return false;
    }
    const random = nativeRandomBytes(32);
    if (random.byteLength !== 32) return false;
    const uuid = nativeRandomUuid();
    if (
      apply<RegExpExecArray | null>(
        nativeRegExpExec,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        [uuid],
      ) === null
    ) {
      return false;
    }

    const keys = apply<string[]>(nativeObjectKeys, NativeObject, [{ one: 1, two: 2 }]);
    if (keys.length !== 2 || keys[0] !== 'one' || keys[1] !== 'two') return false;
    const descriptor = apply<PropertyDescriptor | undefined>(
      nativeObjectGetOwnPropertyDescriptor,
      NativeObject,
      [{ proof: 'safe' }, 'proof'],
    );
    if (descriptor === undefined || !('value' in descriptor) || descriptor.value !== 'safe') {
      return false;
    }
    if (
      apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [{ proof: 'safe' }, 'missing']) !==
      undefined
    ) {
      return false;
    }
    const nullRecord = apply<Record<PropertyKey, unknown>>(nativeObjectCreate, NativeObject, [
      null,
    ]);
    if (apply(nativeObjectGetPrototypeOf, NativeObject, [nullRecord]) !== null) return false;
    return true;
  } catch {
    return false;
  }
}

const capturedControlsSound = capturedControlsAreSound();

export function assertResponseSecurityIntrinsics(): void {
  if (!capturedControlsSound) {
    throw new TypeError(
      'Kovo response security controls are unavailable because the server realm intrinsics were modified before framework initialization.',
    );
  }
}

export function securityArrayIsArray(value: unknown): value is unknown[] {
  assertResponseSecurityIntrinsics();
  return apply(nativeArrayIsArray, NativeArray, [value]);
}

export function securityArrayJoin(values: readonly unknown[], separator: string): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeArrayJoin, values, [separator]);
}

export function securityArrayPush<Value>(values: Value[], value: Value): void {
  assertResponseSecurityIntrinsics();
  apply(nativeArrayPush, values, [value]);
}

export function securityStringIncludes(value: string, search: string): boolean {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringIncludes, value, [search]);
}

export function securityString(value: unknown): string {
  assertResponseSecurityIntrinsics();
  return apply(NativeString, undefined, [value]);
}

export function securityStringSplit(value: string, separator: string): string[] {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringSplit, value, [separator]);
}

export function securityStringTrim(value: string): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringTrim, value, []);
}

export function securityStringIndexOf(value: string, search: string): number {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringIndexOf, value, [search]);
}

export function securityStringSlice(value: string, start: number, end?: number): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringSlice, value, end === undefined ? [start] : [start, end]);
}

export function securityStringToLowerCase(value: string): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringToLowerCase, value, []);
}

export function securityStringStartsWith(value: string, search: string): boolean {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringStartsWith, value, [search]);
}

export function securityStringCharCodeAt(value: string, index: number): number {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringCharCodeAt, value, [index]);
}

export function securityStringReplaceAll(
  value: string,
  search: string,
  replacement: string,
): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeStringReplaceAll, value, [search, replacement]);
}

export function securityRegExpTest(expression: RegExp, value: string): boolean {
  assertResponseSecurityIntrinsics();
  return apply<RegExpExecArray | null>(nativeRegExpExec, expression, [value]) !== null;
}

export function securityRegExpExec(expression: RegExp, value: string): RegExpExecArray | null {
  assertResponseSecurityIntrinsics();
  return apply(nativeRegExpExec, expression, [value]);
}

export function securityRegExpReplace(
  value: string,
  expression: RegExp,
  replacement: string,
): string {
  assertResponseSecurityIntrinsics();
  return replaceRegExp(value, expression, replacement);
}

function replaceRegExp(value: string, expression: RegExp, replacement: string): string {
  expression.lastIndex = 0;
  let result = '';
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = apply<RegExpExecArray | null>(nativeRegExpExec, expression, [value])) !== null) {
    const matched = match[0];
    result += apply<string>(nativeStringSlice, value, [consumed, match.index]);
    result += replacement;
    consumed = match.index + matched.length;
    if (matched.length === 0) expression.lastIndex = match.index + 1;
  }
  return result + apply<string>(nativeStringSlice, value, [consumed]);
}

export function securityObjectKeys(value: object): string[] {
  assertResponseSecurityIntrinsics();
  return apply(nativeObjectKeys, NativeObject, [value]);
}

export function createSecurityNullRecord<Value = unknown>(): Record<PropertyKey, Value> {
  assertResponseSecurityIntrinsics();
  return apply(nativeObjectCreate, NativeObject, [null]);
}

export function securityJsonStringify(value: unknown): string | undefined {
  assertResponseSecurityIntrinsics();
  return apply(nativeJsonStringify, NativeJSON, [value]);
}

export function createSecurityMap<Key, Value>(): Map<Key, Value> {
  assertResponseSecurityIntrinsics();
  return new NativeMap<Key, Value>();
}

export function securityMapGet<Key, Value>(map: Map<Key, Value>, key: Key): Value | undefined {
  assertResponseSecurityIntrinsics();
  return apply(nativeMapGet, map, [key]);
}

export function securityMapHas<Key>(map: Map<Key, unknown>, key: Key): boolean {
  assertResponseSecurityIntrinsics();
  return apply(nativeMapHas, map, [key]);
}

export function securityMapSet<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  assertResponseSecurityIntrinsics();
  apply(nativeMapSet, map, [key, value]);
}

export function createSecuritySet<Value>(): Set<Value> {
  assertResponseSecurityIntrinsics();
  return new NativeSet<Value>();
}

export function securitySetAdd<Value>(set: Set<Value>, value: Value): void {
  assertResponseSecurityIntrinsics();
  apply(nativeSetAdd, set, [value]);
}

export function securitySetHas<Value>(set: Set<Value>, value: Value): boolean {
  assertResponseSecurityIntrinsics();
  return apply(nativeSetHas, set, [value]);
}

export function securityNumberIsInteger(value: unknown): boolean {
  assertResponseSecurityIntrinsics();
  return apply(nativeNumberIsInteger, NativeNumber, [value]);
}

export function securityNumberIsFinite(value: unknown): boolean {
  assertResponseSecurityIntrinsics();
  return apply(nativeNumberIsFinite, NativeNumber, [value]);
}

export function securityMathFloor(value: number): number {
  assertResponseSecurityIntrinsics();
  return apply(nativeMathFloor, NativeMath, [value]);
}

export function securityEncodeURIComponent(value: string): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeEncodeURIComponent, undefined, [value]);
}

export function securityIsDate(value: unknown): value is Date {
  assertResponseSecurityIntrinsics();
  return apply(nativeFunctionHasInstance, NativeDate, [value]);
}

export function securityIsUint8Array(value: unknown): value is Uint8Array {
  assertResponseSecurityIntrinsics();
  return apply(nativeFunctionHasInstance, NativeUint8Array, [value]);
}

export function securityDateToUtcString(value: Date): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeDateToUtcString, value, []);
}

export function securityBufferFrom(
  value: string | ArrayBuffer | ArrayBufferView,
  encoding?: BufferEncoding,
): Buffer {
  assertResponseSecurityIntrinsics();
  return apply(
    nativeBufferFrom,
    NativeBuffer,
    encoding === undefined ? [value] : [value, encoding],
  );
}

export function securityBufferAllocUnsafe(size: number): Buffer {
  assertResponseSecurityIntrinsics();
  return apply(nativeBufferAllocUnsafe, NativeBuffer, [size]);
}

export function securityBufferToString(value: Buffer, encoding?: BufferEncoding): string {
  assertResponseSecurityIntrinsics();
  return apply(nativeBufferToString, value, encoding === undefined ? [] : [encoding]);
}

export function securityTextEncode(value: string): Uint8Array {
  assertResponseSecurityIntrinsics();
  return apply(nativeTextEncoderEncode, textEncoder, [value]);
}

export function securityRandomBytes(size: number): Buffer {
  assertResponseSecurityIntrinsics();
  return nativeRandomBytes(size);
}

export function securityRandomUuid(): string {
  assertResponseSecurityIntrinsics();
  return nativeRandomUuid();
}

export function securitySha256Base64(value: string): string {
  assertResponseSecurityIntrinsics();
  const hash = nativeCreateHash('sha256');
  apply(nativeHashUpdate, hash, [value]);
  return apply(nativeHashDigest, hash, ['base64']);
}
