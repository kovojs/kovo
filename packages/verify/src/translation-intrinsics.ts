/* oxlint-disable typescript/unbound-method -- Boot-captured controls use pinned Reflect.apply. */

/**
 * Boot-captured controls for the emitted-translation verdict (SPEC §2, §5.2, and §6.6).
 *
 * Compiler plugins share this realm and may replace ambient constructors or prototype methods
 * after Kovo boots. Translation validation therefore never dispatches a security decision through
 * a late mutable lookup. These controls are defense-in-depth for the supported compiler runner;
 * they are not a same-realm sandbox or provenance proof.
 */
const NativeArray = globalThis.Array;
const NativeBigInt = globalThis.BigInt;
const NativeError = globalThis.Error;
const NativeFunction = globalThis.Function;
const NativeJSON = globalThis.JSON;
const NativeMap = globalThis.Map;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeRegExp = globalThis.RegExp;
const NativeSet = globalThis.Set;
const NativeString = globalThis.String;
const NativeSymbol = globalThis.Symbol;
const NativeSyntaxError = globalThis.SyntaxError;
const NativeTypeError = globalThis.TypeError;
const NativeErrorPrototype = NativeError.prototype;
const NativeArrayPrototype = NativeArray.prototype;
const NativeBigIntPrototype = NativeBigInt.prototype;
const NativeFunctionPrototype = NativeFunction.prototype;
const NativeNumberPrototype = NativeNumber.prototype;
const NativeObjectPrototype = NativeObject.prototype;
const NativeRegExpPrototype = NativeRegExp.prototype;
const NativeStringPrototype = NativeString.prototype;
const nativeArrayIsArray = NativeArray.isArray;
const nativeArrayJoin = NativeArray.prototype.join;
const nativeArrayPop = NativeArray.prototype.pop;
const nativeArraySort = NativeArray.prototype.sort;
const nativeJsonParse = NativeJSON.parse;
const nativeJsonStringify = NativeJSON.stringify;
const nativeMapForEach = NativeMap.prototype.forEach;
const nativeMapGet = NativeMap.prototype.get;
const nativeMapHas = NativeMap.prototype.has;
const nativeMapSet = NativeMap.prototype.set;
const nativeNumberIsSafeInteger = NativeNumber.isSafeInteger;
const nativeNumberParseInt = NativeNumber.parseInt;
const nativeObjectCreate = NativeObject.create;
const nativeObjectDefineProperty = NativeObject.defineProperty;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectGetOwnPropertyDescriptors = NativeObject.getOwnPropertyDescriptors;
const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeObjectIs = NativeObject.is;
const nativeObjectKeys = NativeObject.keys;
const nativeReflectApply = NativeReflect.apply;
const nativeReflectOwnKeys = NativeReflect.ownKeys;
const nativeRegExpExec = NativeRegExp.prototype.exec;
const nativeRegExpGlobal = nativeObjectGetOwnPropertyDescriptor(
  NativeRegExp.prototype,
  'global',
)?.get;
const nativeSetAdd = NativeSet.prototype.add;
const nativeSetHas = NativeSet.prototype.has;
const nativeStringEndsWith = NativeString.prototype.endsWith;
const nativeStringFromCodePoint = NativeString.fromCodePoint;
const nativeStringIncludes = NativeString.prototype.includes;
const nativeStringIndexOf = NativeString.prototype.indexOf;
const nativeStringSlice = NativeString.prototype.slice;
const nativeStringTrim = NativeString.prototype.trim;

function apply<Return>(fn: Function, receiver: unknown, args: readonly unknown[]): Return {
  return nativeReflectApply(fn, receiver, args) as Return;
}

export const translationArrayPrototype = NativeArrayPrototype;
export const translationObjectPrototype = NativeObjectPrototype;

interface TranslationParserControl {
  descriptor: PropertyDescriptor;
  owner: object;
  property: PropertyKey;
}

interface TranslationParserRestore {
  control: TranslationParserControl;
  descriptor: PropertyDescriptor;
}

function parserControl(owner: object, property: PropertyKey): TranslationParserControl {
  const descriptor = nativeObjectGetOwnPropertyDescriptor(owner, property);
  if (descriptor === undefined) {
    throw new NativeTypeError('Pinned translation parser control is unavailable at bootstrap.');
  }
  return { descriptor, owner, property };
}

/** Reviewed mutable controls used at runtime by the bundled Acorn 8.17.0 parser. */
const translationParserControls: readonly TranslationParserControl[] = [
  parserControl(globalThis, 'Array'),
  parserControl(globalThis, 'BigInt'),
  parserControl(globalThis, 'Error'),
  parserControl(globalThis, 'Object'),
  parserControl(globalThis, 'RegExp'),
  parserControl(globalThis, 'String'),
  parserControl(globalThis, 'SyntaxError'),
  parserControl(globalThis, 'TypeError'),
  parserControl(globalThis, 'parseFloat'),
  parserControl(globalThis, 'parseInt'),
  parserControl(NativeArray, 'isArray'),
  parserControl(NativeObject, 'create'),
  parserControl(NativeObject, 'defineProperties'),
  parserControl(NativeObject, 'hasOwn'),
  parserControl(NativeObject, 'keys'),
  parserControl(NativeString, 'fromCharCode'),
  parserControl(NativeArrayPrototype, 'indexOf'),
  parserControl(NativeArrayPrototype, 'lastIndexOf'),
  parserControl(NativeArrayPrototype, 'map'),
  parserControl(NativeArrayPrototype, 'pop'),
  parserControl(NativeArrayPrototype, 'push'),
  parserControl(NativeArrayPrototype, 'slice'),
  parserControl(NativeBigIntPrototype, 'toString'),
  parserControl(NativeFunctionPrototype, 'call'),
  parserControl(NativeFunctionPrototype, NativeSymbol.hasInstance),
  parserControl(NativeNumberPrototype, 'toString'),
  parserControl(NativeRegExpPrototype, 'exec'),
  parserControl(NativeRegExpPrototype, 'test'),
  parserControl(NativeRegExpPrototype, NativeSymbol.match),
  parserControl(NativeRegExpPrototype, NativeSymbol.replace),
  parserControl(NativeRegExpPrototype, NativeSymbol.split),
  parserControl(NativeStringPrototype, 'charAt'),
  parserControl(NativeStringPrototype, 'charCodeAt'),
  parserControl(NativeStringPrototype, 'indexOf'),
  parserControl(NativeStringPrototype, 'lastIndexOf'),
  parserControl(NativeStringPrototype, 'match'),
  parserControl(NativeStringPrototype, 'replace'),
  parserControl(NativeStringPrototype, 'slice'),
  parserControl(NativeStringPrototype, 'split'),
  parserControl(NativeStringPrototype, 'substr'),
  parserControl(NativeStringPrototype, 'toString'),
  parserControl(NativeRegExp, 'prototype'),
];

/**
 * Run the pinned parser without letting post-bootstrap plugin mutations alter its AST.
 *
 * Parsing is synchronous and consumes a primitive string, so no application callback can observe
 * this short control scope. Every caller descriptor is restored in reverse order. A non-restorable
 * mutation closes instead of running the parser with a partial control set.
 */
export function translationWithParserControls<Value>(parse: () => Value): Value {
  const restores: TranslationParserRestore[] = [];
  let installed = false;
  try {
    for (let index = 0; index < translationArrayLength(translationParserControls); index += 1) {
      const control = translationParserControls[index]!;
      const first = translationGetOwnPropertyDescriptor(control.owner, control.property);
      const second = translationGetOwnPropertyDescriptor(control.owner, control.property);
      if (!samePropertyDescriptor(first, second) || first === undefined) {
        throw new NativeTypeError('Translation parser control changed while it was inspected.');
      }
      if (samePropertyDescriptor(first, control.descriptor)) continue;
      translationArrayAppend(restores, { control, descriptor: first });
      const installDescriptor = parserInstallDescriptor(first, control.descriptor);
      apply(nativeObjectDefineProperty, NativeObject, [
        control.owner,
        control.property,
        installDescriptor,
      ]);
    }
    installed = true;
    return parse();
  } finally {
    for (let index = translationArrayLength(restores) - 1; index >= 0; index -= 1) {
      const restore = restores[index]!;
      try {
        apply(nativeObjectDefineProperty, NativeObject, [
          restore.control.owner,
          restore.control.property,
          restore.descriptor,
        ]);
      } catch {
        // A synchronous primitive-string parse cannot run application code. Reaching this branch
        // means the host changed a parser control reentrantly and the supported runner is lost.
        throw new NativeTypeError('Translation parser controls could not be restored.');
      }
    }
    if (!installed && translationArrayLength(restores) === 0) {
      throw new NativeTypeError('Translation parser controls could not be installed.');
    }
  }
}

function parserInstallDescriptor(
  current: PropertyDescriptor,
  captured: PropertyDescriptor,
): PropertyDescriptor {
  if (current.configurable !== false) return captured;
  if ('value' in current && current.writable === true && 'value' in captured) {
    return { ...current, value: captured.value };
  }
  if (samePropertyDescriptor(current, captured)) return current;
  throw new NativeTypeError('Translation parser control is non-restorable.');
}

function samePropertyDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (
    left.configurable !== right.configurable ||
    left.enumerable !== right.enumerable ||
    'value' in left !== 'value' in right
  ) {
    return false;
  }
  if ('value' in left && 'value' in right) {
    return (
      apply<boolean>(nativeObjectIs, NativeObject, [left.value, right.value]) &&
      left.writable === right.writable
    );
  }
  return (
    apply<boolean>(nativeObjectIs, NativeObject, [left.get, right.get]) &&
    apply<boolean>(nativeObjectIs, NativeObject, [left.set, right.set])
  );
}

export function translationArrayIsArray(value: unknown): value is unknown[] {
  return apply(nativeArrayIsArray, NativeArray, [value]);
}

export function translationArrayAppend<Value>(target: Value[], value: Value): void {
  const length = translationArrayLength(target);
  apply(nativeObjectDefineProperty, NativeObject, [
    target,
    length,
    {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    },
  ]);
}

export function translationArrayAppendAll<Value>(target: Value[], source: readonly Value[]): void {
  const length = translationArrayLength(source);
  for (let index = 0; index < length; index += 1) {
    translationArrayAppend(target, source[index]!);
  }
}

export function translationArrayCopy<Value>(source: readonly Value[]): Value[] {
  const copy: Value[] = [];
  translationArrayAppendAll(copy, source);
  return copy;
}

export function translationArrayJoin(values: readonly unknown[], separator: string): string {
  return apply(nativeArrayJoin, values, [separator]);
}

export function translationArrayLength(value: readonly unknown[]): number {
  const descriptor = translationGetOwnPropertyDescriptor(value, 'length');
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'number' ||
    !translationNumberIsSafeInteger(descriptor.value) ||
    descriptor.value < 0 ||
    descriptor.value > 1_000_000
  ) {
    throw new NativeTypeError('Translation array must have a bounded own-data length.');
  }
  return descriptor.value;
}

export function translationArrayPop<Value>(target: Value[]): Value | undefined {
  return apply(nativeArrayPop, target, []);
}

export function translationArraySort<Value>(
  target: Value[],
  compare: (left: Value, right: Value) => number,
): Value[] {
  return apply(nativeArraySort, target, [compare]);
}

export function translationCreateMap<Key, Value>(): Map<Key, Value> {
  return new NativeMap<Key, Value>();
}

export function translationMapForEach<Key, Value>(
  map: ReadonlyMap<Key, Value>,
  callback: (value: Value, key: Key) => void,
): void {
  apply(nativeMapForEach, map, [callback]);
}

export function translationMapGet<Key, Value>(
  map: ReadonlyMap<Key, Value>,
  key: Key,
): Value | undefined {
  return apply(nativeMapGet, map, [key]);
}

export function translationMapHas<Key>(map: ReadonlyMap<Key, unknown>, key: Key): boolean {
  return apply(nativeMapHas, map, [key]);
}

export function translationMapSet<Key, Value>(map: Map<Key, Value>, key: Key, value: Value): void {
  apply(nativeMapSet, map, [key, value]);
}

export function translationCreateSet<Value>(): Set<Value> {
  return new NativeSet<Value>();
}

export function translationSetAdd<Value>(set: Set<Value>, value: Value): void {
  apply(nativeSetAdd, set, [value]);
}

export function translationSetHas<Value>(set: ReadonlySet<Value>, value: Value): boolean {
  return apply(nativeSetHas, set, [value]);
}

export function translationCreateNullRecord<Value>(): Record<string, Value> {
  return apply(nativeObjectCreate, NativeObject, [null]);
}

export function translationDefineOwnDataProperty(
  target: object,
  property: PropertyKey,
  value: unknown,
): void {
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
}

export function translationGetOwnPropertyDescriptor(
  value: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  return apply(nativeObjectGetOwnPropertyDescriptor, NativeObject, [value, property]);
}

export function translationOwnDataValue(value: object, property: PropertyKey): unknown {
  const first = translationGetOwnPropertyDescriptor(value, property);
  const second = translationGetOwnPropertyDescriptor(value, property);
  if (first === undefined && second === undefined) return undefined;
  if (!translationSameDataDescriptor(first, second)) {
    throw new NativeTypeError('Translation input must expose stable own-data properties.');
  }
  return first.value;
}

export function translationGetOwnPropertyDescriptors(
  value: object,
): Record<PropertyKey, PropertyDescriptor> {
  return apply(nativeObjectGetOwnPropertyDescriptors, NativeObject, [value]);
}

export function translationGetPrototypeOf(value: object): object | null {
  return apply(nativeObjectGetPrototypeOf, NativeObject, [value]);
}

export function translationObjectKeys(value: object): string[] {
  return apply(nativeObjectKeys, NativeObject, [value]);
}

export function translationOwnKeys(value: object): (string | symbol)[] {
  return apply(nativeReflectOwnKeys, NativeReflect, [value]);
}

export function translationSameDataDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): left is PropertyDescriptor & { value: unknown } {
  return (
    left !== undefined &&
    right !== undefined &&
    'value' in left &&
    'value' in right &&
    apply<boolean>(nativeObjectIs, NativeObject, [left.value, right.value]) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}

export function translationNumberIsSafeInteger(value: unknown): value is number {
  return apply(nativeNumberIsSafeInteger, NativeNumber, [value]);
}

export function translationNumberParseInt(value: string, radix: number): number {
  return apply(nativeNumberParseInt, NativeNumber, [value, radix]);
}

export function translationJsonParse(value: string): unknown {
  return apply(nativeJsonParse, NativeJSON, [value]);
}

export function translationJsonStringify(value: unknown): string {
  const serialized = apply<string | undefined>(nativeJsonStringify, NativeJSON, [value]);
  if (serialized === undefined) throw new NativeTypeError('Translation value is not JSON data.');
  return serialized;
}

export function translationStringEndsWith(value: string, suffix: string): boolean {
  return apply(nativeStringEndsWith, value, [suffix]);
}

export function translationStringIncludes(value: string, search: string): boolean {
  return apply(nativeStringIncludes, value, [search]);
}

export function translationStringIndexOf(value: string, search: string, position?: number): number {
  return apply(nativeStringIndexOf, value, position === undefined ? [search] : [search, position]);
}

export function translationStringSlice(value: string, start: number, end?: number): string {
  return apply(nativeStringSlice, value, end === undefined ? [start] : [start, end]);
}

export function translationStringSplit(value: string, separator: string): string[] {
  if (separator.length === 0) {
    throw new NativeTypeError('Translation literal split separator must not be empty.');
  }
  const result: string[] = [];
  let sourceIndex = 0;
  while (true) {
    const matchIndex = translationStringIndexOf(value, separator, sourceIndex);
    if (matchIndex < 0) break;
    translationArrayAppend(result, translationStringSlice(value, sourceIndex, matchIndex));
    sourceIndex = matchIndex + separator.length;
  }
  translationArrayAppend(result, translationStringSlice(value, sourceIndex));
  return result;
}

export function translationStringTrim(value: string): string {
  return apply(nativeStringTrim, value, []);
}

export function translationStringFromCodePoint(value: number): string {
  return apply(nativeStringFromCodePoint, NativeString, [value]);
}

export function translationRegExpTest(expression: RegExp, value: string): boolean {
  expression.lastIndex = 0;
  return apply<RegExpExecArray | null>(nativeRegExpExec, expression, [value]) !== null;
}

export function translationRegExpMatches(expression: RegExp, value: string): string[] {
  if (typeof nativeRegExpGlobal !== 'function') {
    throw new NativeTypeError('Translation RegExp global control is unavailable.');
  }
  const global = apply<boolean>(nativeRegExpGlobal, expression, []);
  const matches: string[] = [];
  expression.lastIndex = 0;
  while (true) {
    const match = apply<RegExpExecArray | null>(nativeRegExpExec, expression, [value]);
    if (match === null) return matches;
    const matched = translationGetOwnPropertyDescriptor(match, 0)?.value;
    if (typeof matched !== 'string')
      throw new NativeTypeError('Translation RegExp match is invalid.');
    translationArrayAppend(matches, matched);
    if (!global) return matches;
    if (matched.length === 0) {
      throw new NativeTypeError('Translation global RegExp must not produce empty matches.');
    }
  }
}

export function translationRegExpReplace(
  expression: RegExp,
  value: string,
  replacement: (...captures: (string | undefined)[]) => string,
): string {
  if (typeof nativeRegExpGlobal !== 'function') {
    throw new NativeTypeError('Translation RegExp global control is unavailable.');
  }
  const global = apply<boolean>(nativeRegExpGlobal, expression, []);
  let output = '';
  let sourceIndex = 0;
  expression.lastIndex = 0;
  while (true) {
    const match = apply<RegExpExecArray | null>(nativeRegExpExec, expression, [value]);
    if (match === null) break;
    const index = translationGetOwnPropertyDescriptor(match, 'index')?.value;
    const matched = translationGetOwnPropertyDescriptor(match, 0)?.value;
    if (
      typeof index !== 'number' ||
      !translationNumberIsSafeInteger(index) ||
      index < sourceIndex ||
      typeof matched !== 'string'
    ) {
      throw new NativeTypeError('Translation RegExp match is invalid.');
    }
    output += translationStringSlice(value, sourceIndex, index);
    const captures: (string | undefined)[] = [];
    const matchLength = translationArrayLength(match);
    for (let captureIndex = 0; captureIndex < matchLength; captureIndex += 1) {
      const capture = translationGetOwnPropertyDescriptor(match, captureIndex)?.value;
      if (capture !== undefined && typeof capture !== 'string') {
        throw new NativeTypeError('Translation RegExp capture is invalid.');
      }
      translationArrayAppend(captures, capture);
    }
    output += apply<string>(replacement, undefined, captures);
    sourceIndex = index + matched.length;
    if (!global) break;
    if (matched.length === 0) {
      throw new NativeTypeError('Translation global RegExp must not produce empty matches.');
    }
  }
  return output + translationStringSlice(value, sourceIndex);
}

export function translationSyntaxError(message: string): SyntaxError {
  return new NativeSyntaxError(message);
}

export function translationTypeError(message: string): TypeError {
  return new NativeTypeError(message);
}

export function translationErrorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'unknown error';
  let prototype: object | null = error;
  let isError = false;
  for (let depth = 0; prototype !== null && depth < 16; depth += 1) {
    if (prototype === NativeErrorPrototype) {
      isError = true;
      break;
    }
    prototype = translationGetPrototypeOf(prototype);
  }
  if (!isError) return 'unknown error';
  const message = translationGetOwnPropertyDescriptor(error, 'message')?.value;
  return typeof message === 'string' ? message : 'unknown error';
}
