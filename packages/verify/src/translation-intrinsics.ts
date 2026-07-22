import { Parser as AcornParser } from 'acorn';

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
const NativeBoolean = globalThis.Boolean;
const NativeError = globalThis.Error;
const NativeEvalError = globalThis.EvalError;
const NativeFunction = globalThis.Function;
const NativeJSON = globalThis.JSON;
const NativeMap = globalThis.Map;
const NativeMath = globalThis.Math;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativeRangeError = globalThis.RangeError;
const NativeReferenceError = globalThis.ReferenceError;
const NativeReflect = globalThis.Reflect;
const NativeRegExp = globalThis.RegExp;
const NativeSet = globalThis.Set;
const NativeString = globalThis.String;
const NativeSymbol = globalThis.Symbol;
const NativeSyntaxError = globalThis.SyntaxError;
const NativeTypeError = globalThis.TypeError;
const NativeURIError = globalThis.URIError;
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
const nativeReflectDeleteProperty = NativeReflect.deleteProperty;
const nativeReflectOwnKeys = NativeReflect.ownKeys;
const nativeReflectSetPrototypeOf = NativeReflect.setPrototypeOf;
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

interface TranslationParserSurfaceDefinition {
  exact: boolean;
  owner: object;
  selectedKeys?: readonly PropertyKey[];
}

interface TranslationParserSurfaceState {
  definition: TranslationParserSurfaceDefinition;
  descriptors: Map<PropertyKey, PropertyDescriptor>;
  keys: readonly PropertyKey[];
  prototype: object | null | undefined;
}

const parserGlobalKeys: readonly PropertyKey[] = [
  'Array',
  'BigInt',
  'Boolean',
  'Error',
  'EvalError',
  'Function',
  'JSON',
  'Map',
  'Math',
  'Number',
  'Object',
  'RangeError',
  'ReferenceError',
  'Reflect',
  'RegExp',
  'Set',
  'String',
  'Symbol',
  'SyntaxError',
  'TypeError',
  'URIError',
  'parseFloat',
  'parseInt',
];

/**
 * Mutable objects reachable by the pinned Acorn 8.17.0 parser.
 *
 * Acorn exposes its complete mutable parser graph from `Parser`/`Parser.acorn`: the parser
 * prototype and statics, defaultOptions, token/context tables and constructors, identifier/newline
 * helpers, and exported RegExp instances. Recursively following own data/accessor descriptors also
 * captures RegExp `lastIndex` and source-mode mutations that cannot reach the private bundled graph.
 * Explicit intrinsic roots cover every late host lookup made by that graph. `globalThis` is limited
 * to the reviewed names above because unrelated application globals are not parser controls.
 */
const parserExactRoots: readonly object[] = [
  NativeObjectPrototype,
  NativeArrayPrototype,
  NativeBigIntPrototype,
  NativeFunctionPrototype,
  NativeNumberPrototype,
  NativeRegExpPrototype,
  NativeStringPrototype,
  NativeBoolean.prototype,
  NativeError.prototype,
  NativeEvalError.prototype,
  NativeRangeError.prototype,
  NativeReferenceError.prototype,
  NativeSyntaxError.prototype,
  NativeTypeError.prototype,
  NativeURIError.prototype,
  NativeSymbol.prototype,
  NativeArray,
  NativeBigInt,
  NativeBoolean,
  NativeError,
  NativeEvalError,
  NativeFunction,
  NativeJSON,
  NativeMap,
  NativeMath,
  NativeNumber,
  NativeObject,
  NativeRangeError,
  NativeReferenceError,
  NativeReflect,
  NativeRegExp,
  NativeSet,
  NativeString,
  NativeSymbol,
  NativeSyntaxError,
  NativeTypeError,
  NativeURIError,
  AcornParser,
];

const translationParserSurfaceDefinitions = parserSurfaceDefinitions();
const translationParserBootState = captureParserState(translationParserSurfaceDefinitions);

/**
 * Run the pinned parser without letting post-bootstrap plugin mutations alter its AST.
 *
 * Acorn performs inherited enumeration while normalizing options, so restoring a named method is
 * insufficient: an arbitrary enumerable getter on Object.prototype can execute and re-poison a
 * method after installation. Before parsing, this scope therefore reconciles every reachable
 * object to its exact boot descriptor/prototype census. It snapshots and restores the caller's
 * complete state afterward, continuing best-effort cleanup after any individual restoration error.
 * A non-restorable entry drift closes without invoking the parser.
 */
export function translationWithParserControls<Value>(parse: () => Value): Value {
  const callerState = captureParserState(translationParserSurfaceDefinitions);
  try {
    if (!reconcileParserState(translationParserBootState)) {
      throw new NativeTypeError('Translation parser controls could not be installed.');
    }
    return parse();
  } finally {
    const restored = reconcileParserState(callerState, true);
    if (!restored) {
      throw new NativeTypeError('Translation parser controls could not be fully restored.');
    }
  }
}

function parserSurfaceDefinitions(): readonly TranslationParserSurfaceDefinition[] {
  const definitions: TranslationParserSurfaceDefinition[] = [
    { exact: true, owner: NativeObjectPrototype },
    { exact: false, owner: globalThis, selectedKeys: parserGlobalKeys },
  ];
  const owners = parserReachableObjects(parserExactRoots);
  for (let index = 0; index < translationArrayLength(owners); index += 1) {
    if (apply<boolean>(nativeObjectIs, NativeObject, [owners[index], NativeObjectPrototype])) {
      continue;
    }
    translationArrayAppend(definitions, { exact: true, owner: owners[index]! });
  }
  return definitions;
}

function parserReachableObjects(roots: readonly object[]): object[] {
  const owners: object[] = [];
  const pending = translationArrayCopy(roots);
  const seen = new NativeSet<object>();
  while (translationArrayLength(pending) > 0) {
    const owner = translationArrayPop(pending)!;
    if (apply<boolean>(nativeSetHas, seen, [owner])) continue;
    apply(nativeSetAdd, seen, [owner]);
    translationArrayAppend(owners, owner);
    const prototype = apply<object | null>(nativeObjectGetPrototypeOf, NativeObject, [owner]);
    if (prototype !== null) translationArrayAppend(pending, prototype);
    const keys = apply<(string | symbol)[]>(nativeReflectOwnKeys, NativeReflect, [owner]);
    for (let index = 0; index < translationArrayLength(keys); index += 1) {
      const descriptor = apply<PropertyDescriptor | undefined>(
        nativeObjectGetOwnPropertyDescriptor,
        NativeObject,
        [owner, keys[index]!],
      );
      if (descriptor === undefined) continue;
      if (descriptorIsData(descriptor)) {
        appendParserObject(pending, descriptor.value);
      } else {
        appendParserObject(pending, descriptor.get);
        appendParserObject(pending, descriptor.set);
      }
    }
  }
  return owners;
}

function appendParserObject(target: object[], value: unknown): void {
  if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
    translationArrayAppend(target, value);
  }
}

function captureParserState(
  definitions: readonly TranslationParserSurfaceDefinition[],
): TranslationParserSurfaceState[] {
  const states: TranslationParserSurfaceState[] = [];
  for (let index = 0; index < translationArrayLength(definitions); index += 1) {
    const definition = definitions[index]!;
    const keys = definition.exact
      ? apply<(string | symbol)[]>(nativeReflectOwnKeys, NativeReflect, [definition.owner])
      : translationArrayCopy(definition.selectedKeys ?? []);
    const descriptors = new NativeMap<PropertyKey, PropertyDescriptor>();
    for (let keyIndex = 0; keyIndex < translationArrayLength(keys); keyIndex += 1) {
      const key = keys[keyIndex]!;
      const descriptor = apply<PropertyDescriptor | undefined>(
        nativeObjectGetOwnPropertyDescriptor,
        NativeObject,
        [definition.owner, key],
      );
      if (descriptor !== undefined) apply(nativeMapSet, descriptors, [key, descriptor]);
    }
    translationArrayAppend(states, {
      definition,
      descriptors,
      keys,
      prototype: definition.exact
        ? apply<object | null>(nativeObjectGetPrototypeOf, NativeObject, [definition.owner])
        : undefined,
    });
  }
  return states;
}

function reconcileParserState(
  targets: readonly TranslationParserSurfaceState[],
  reverse = false,
): boolean {
  let complete = true;
  for (let offset = 0; offset < translationArrayLength(targets); offset += 1) {
    const index = reverse ? translationArrayLength(targets) - offset - 1 : offset;
    if (!reconcileParserSurface(targets[index]!)) complete = false;
  }
  return complete;
}

function reconcileParserSurface(target: TranslationParserSurfaceState): boolean {
  const { definition } = target;
  const { owner } = definition;
  let complete = true;
  if (definition.exact) {
    try {
      const currentPrototype = apply<object | null>(nativeObjectGetPrototypeOf, NativeObject, [
        owner,
      ]);
      if (
        !apply<boolean>(nativeObjectIs, NativeObject, [currentPrototype, target.prototype]) &&
        !apply<boolean>(nativeReflectSetPrototypeOf, NativeReflect, [owner, target.prototype])
      ) {
        complete = false;
      }
    } catch {
      complete = false;
    }
  }

  let currentKeys: readonly PropertyKey[];
  try {
    currentKeys = definition.exact
      ? apply<(string | symbol)[]>(nativeReflectOwnKeys, NativeReflect, [owner])
      : translationArrayCopy(definition.selectedKeys ?? []);
  } catch {
    return false;
  }

  for (let index = 0; index < translationArrayLength(currentKeys); index += 1) {
    const key = currentKeys[index]!;
    if (apply<boolean>(nativeMapHas, target.descriptors, [key])) continue;
    try {
      if (!apply<boolean>(nativeReflectDeleteProperty, NativeReflect, [owner, key])) {
        complete = false;
      }
    } catch {
      complete = false;
    }
  }

  for (let index = 0; index < translationArrayLength(target.keys); index += 1) {
    const key = target.keys[index]!;
    const expected = apply<PropertyDescriptor | undefined>(nativeMapGet, target.descriptors, [key]);
    if (expected === undefined) continue;
    let current: PropertyDescriptor | undefined;
    try {
      current = apply<PropertyDescriptor | undefined>(
        nativeObjectGetOwnPropertyDescriptor,
        NativeObject,
        [owner, key],
      );
      if (samePropertyDescriptor(current, expected)) continue;
      apply(nativeObjectDefineProperty, NativeObject, [owner, key, expected]);
    } catch {
      complete = false;
      if (!restoreCompatibleDataValue(owner, key, current, expected)) complete = false;
    }
  }

  return parserSurfaceMatches(target) && complete;
}

function restoreCompatibleDataValue(
  owner: object,
  key: PropertyKey,
  current: PropertyDescriptor | undefined,
  expected: PropertyDescriptor,
): boolean {
  if (
    current === undefined ||
    !descriptorIsData(current) ||
    !descriptorIsData(expected) ||
    current.configurable !== false ||
    current.writable !== true
  ) {
    return false;
  }
  try {
    apply(nativeObjectDefineProperty, NativeObject, [owner, key, { value: expected.value }]);
    return true;
  } catch {
    return false;
  }
}

function parserSurfaceMatches(target: TranslationParserSurfaceState): boolean {
  const { definition } = target;
  const { owner } = definition;
  try {
    if (
      definition.exact &&
      !apply<boolean>(nativeObjectIs, NativeObject, [
        apply<object | null>(nativeObjectGetPrototypeOf, NativeObject, [owner]),
        target.prototype,
      ])
    ) {
      return false;
    }
    const keys = definition.exact
      ? apply<(string | symbol)[]>(nativeReflectOwnKeys, NativeReflect, [owner])
      : translationArrayCopy(definition.selectedKeys ?? []);
    let descriptorCount = 0;
    for (let index = 0; index < translationArrayLength(keys); index += 1) {
      const key = keys[index]!;
      const current = apply<PropertyDescriptor | undefined>(
        nativeObjectGetOwnPropertyDescriptor,
        NativeObject,
        [owner, key],
      );
      const expected = apply<PropertyDescriptor | undefined>(nativeMapGet, target.descriptors, [
        key,
      ]);
      if (!samePropertyDescriptor(current, expected)) return false;
      if (current !== undefined) descriptorCount += 1;
    }
    let expectedDescriptorCount = 0;
    for (let index = 0; index < translationArrayLength(target.keys); index += 1) {
      if (apply<boolean>(nativeMapHas, target.descriptors, [target.keys[index]!])) {
        expectedDescriptorCount += 1;
      }
    }
    return descriptorCount === expectedDescriptorCount;
  } catch {
    return false;
  }
}

function descriptorIsData(
  descriptor: PropertyDescriptor,
): descriptor is PropertyDescriptor & { value: unknown } {
  return (
    apply<PropertyDescriptor | undefined>(nativeObjectGetOwnPropertyDescriptor, NativeObject, [
      descriptor,
      'value',
    ]) !== undefined
  );
}

function descriptorOwnValue(descriptor: PropertyDescriptor, key: PropertyKey): unknown {
  return apply<PropertyDescriptor | undefined>(nativeObjectGetOwnPropertyDescriptor, NativeObject, [
    descriptor,
    key,
  ])?.value;
}

function samePropertyDescriptor(
  left: PropertyDescriptor | undefined,
  right: PropertyDescriptor | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  const leftIsData = descriptorIsData(left);
  const rightIsData = descriptorIsData(right);
  if (
    descriptorOwnValue(left, 'configurable') !== descriptorOwnValue(right, 'configurable') ||
    descriptorOwnValue(left, 'enumerable') !== descriptorOwnValue(right, 'enumerable') ||
    leftIsData !== rightIsData
  ) {
    return false;
  }
  if (leftIsData && rightIsData) {
    return (
      apply<boolean>(nativeObjectIs, NativeObject, [left.value, right.value]) &&
      descriptorOwnValue(left, 'writable') === descriptorOwnValue(right, 'writable')
    );
  }
  return (
    apply<boolean>(nativeObjectIs, NativeObject, [
      descriptorOwnValue(left, 'get'),
      descriptorOwnValue(right, 'get'),
    ]) &&
    apply<boolean>(nativeObjectIs, NativeObject, [
      descriptorOwnValue(left, 'set'),
      descriptorOwnValue(right, 'set'),
    ])
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
    !descriptorIsData(descriptor) ||
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
  if (
    left === undefined ||
    right === undefined ||
    !descriptorIsData(left) ||
    !descriptorIsData(right)
  ) {
    return false;
  }
  return (
    apply<boolean>(nativeObjectIs, NativeObject, [left.value, right.value]) &&
    descriptorOwnValue(left, 'configurable') === descriptorOwnValue(right, 'configurable') &&
    descriptorOwnValue(left, 'enumerable') === descriptorOwnValue(right, 'enumerable') &&
    descriptorOwnValue(left, 'writable') === descriptorOwnValue(right, 'writable')
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
