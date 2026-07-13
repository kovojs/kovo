/* oxlint-disable typescript/unbound-method -- Boot-pinned controls are invoked through Reflect.apply. */
// Boot-pinned primitives for the devtool's HTML output boundary. App bundles and
// Vite plugins share this realm, so late prototype mutation must not be able to
// replace escaping, collection traversal, or lookup policy (SPEC §5.2 / §6.6).

const NativeArray = globalThis.Array;
const NativeMap = globalThis.Map;
const NativeMath = globalThis.Math;
const NativeNumber = globalThis.Number;
const NativeObject = globalThis.Object;
const NativeReflect = globalThis.Reflect;
const NativeRegExp = globalThis.RegExp;
const NativeSet = globalThis.Set;
const NativeString = globalThis.String;
const NativeTypeError = globalThis.TypeError;

const nativeArrayIsArray = NativeArray.isArray;
const nativeDefineProperty = NativeObject.defineProperty;
const nativeFreeze = NativeObject.freeze;
const nativeGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeGetPrototypeOf = NativeObject.getPrototypeOf;
const nativeObjectIsFrozen = NativeObject.isFrozen;
const nativeObjectPrototype = NativeObject.prototype;
const nativeMapGet = NativeMap.prototype.get;
const nativeMapHas = NativeMap.prototype.has;
const nativeMapSet = NativeMap.prototype.set;
const nativeMathLog = NativeMath.log;
const nativeNumberIsFinite = NativeNumber.isFinite;
const nativeNumberIsSafeInteger = NativeNumber.isSafeInteger;
const nativeObjectIs = NativeObject.is;
const nativeReflectApply = NativeReflect.apply;
const nativeRegExpExec = NativeRegExp.prototype.exec;
const nativeRegExpTest = NativeRegExp.prototype.test;
const nativeSetAdd = NativeSet.prototype.add;
const nativeSetHas = NativeSet.prototype.has;
const nativeStringCharCodeAt = NativeString.prototype.charCodeAt;
const nativeStringEndsWith = NativeString.prototype.endsWith;
const nativeStringIncludes = NativeString.prototype.includes;
const nativeStringSlice = NativeString.prototype.slice;
const nativeStringSplit = NativeString.prototype.split;
const nativeStringStartsWith = NativeString.prototype.startsWith;
const nativeStringToLowerCase = NativeString.prototype.toLowerCase;
const nativeStringTrim = NativeString.prototype.trim;
const nativeEncodeURIComponent = globalThis.encodeURIComponent;
const nativeNumberToFixed = NativeNumber.prototype.toFixed;

function apply(fn, receiver, args) {
  return nativeReflectApply(fn, receiver, args);
}

function ownDescriptor(value, key) {
  return apply(nativeGetOwnPropertyDescriptor, NativeObject, [value, key]);
}

function hasOwnDescriptorValue(descriptor) {
  return descriptor !== undefined && ownDescriptor(descriptor, 'value') !== undefined;
}

function sameDataDescriptor(left, right) {
  if (left === undefined || right === undefined) return left === right;
  return (
    hasOwnDescriptorValue(left) &&
    hasOwnDescriptorValue(right) &&
    apply(nativeObjectIs, NativeObject, [left.value, right.value]) &&
    left.configurable === right.configurable &&
    left.enumerable === right.enumerable &&
    left.writable === right.writable
  );
}

const controlsSound = (() => {
  try {
    const list = ['safe'];
    const defined = {};
    const map = new NativeMap();
    const set = new NativeSet();
    apply(nativeDefineProperty, NativeObject, [
      defined,
      'safe',
      { configurable: false, enumerable: true, value: 'defined', writable: false },
    ]);
    apply(nativeMapSet, map, ['key', 'value']);
    apply(nativeSetAdd, set, ['value']);
    const frozen = apply(nativeFreeze, NativeObject, [defined]);
    const split = apply(nativeStringSplit, 'safe output', [' ']);
    return (
      apply(nativeArrayIsArray, NativeArray, [list]) === true &&
      apply(nativeArrayIsArray, NativeArray, [{}]) === false &&
      ownDescriptor(list, 0)?.value === 'safe' &&
      ownDescriptor(defined, 'safe')?.value === 'defined' &&
      frozen === defined &&
      apply(nativeObjectIsFrozen, NativeObject, [defined]) === true &&
      apply(nativeGetPrototypeOf, NativeObject, [defined]) === nativeObjectPrototype &&
      apply(nativeObjectIs, NativeObject, [defined, frozen]) === true &&
      apply(nativeMapGet, map, ['key']) === 'value' &&
      apply(nativeMapHas, map, ['key']) === true &&
      apply(nativeSetHas, set, ['value']) === true &&
      apply(nativeRegExpExec, /^safe$/u, ['safe'])?.[0] === 'safe' &&
      apply(nativeRegExpTest, /safe/u, ['safe']) === true &&
      apply(nativeStringSlice, 'safe', [1]) === 'afe' &&
      apply(nativeStringCharCodeAt, 'safe', [0]) === 115 &&
      apply(nativeStringEndsWith, 'safe-output', ['output']) === true &&
      apply(nativeStringIncludes, 'safe-output', ['-out']) === true &&
      ownDescriptor(split, 0)?.value === 'safe' &&
      ownDescriptor(split, 1)?.value === 'output' &&
      apply(nativeStringStartsWith, 'safe-output', ['safe-']) === true &&
      apply(nativeStringToLowerCase, 'SaFe', []) === 'safe' &&
      apply(nativeStringTrim, ' safe ', []) === 'safe' &&
      apply(nativeNumberIsFinite, NativeNumber, [1]) === true &&
      apply(nativeNumberIsSafeInteger, NativeNumber, [1]) === true &&
      apply(nativeNumberIsSafeInteger, NativeNumber, [1.5]) === false &&
      apply(nativeNumberToFixed, 1.25, [1]) === '1.3' &&
      apply(nativeMathLog, NativeMath, [1]) === 0 &&
      apply(NativeString, undefined, [42]) === '42' &&
      nativeEncodeURIComponent('a b') === 'a%20b'
    );
  } catch {
    return false;
  }
})();

function assertControls() {
  if (!controlsSound) {
    throw new NativeTypeError('Kovo devtool output security controls are unavailable.');
  }
}

export function isArray(value) {
  assertControls();
  return apply(nativeArrayIsArray, NativeArray, [value]) === true;
}

export function arrayLength(values, label = 'array') {
  if (!isArray(values)) throw new NativeTypeError(`${label} must be an array.`);
  const descriptor = ownDescriptor(values, 'length');
  const confirmed = ownDescriptor(values, 'length');
  if (!sameDataDescriptor(descriptor, confirmed)) {
    throw new NativeTypeError(`${label}.length changed while it was inspected.`);
  }
  if (
    descriptor === undefined ||
    !hasOwnDescriptorValue(descriptor) ||
    typeof descriptor.value !== 'number' ||
    !apply(nativeNumberIsSafeInteger, NativeNumber, [descriptor.value]) ||
    descriptor.value < 0
  ) {
    throw new NativeTypeError(`${label} must have a stable dense length.`);
  }
  return descriptor.value;
}

export function arrayValue(values, index, label = 'array') {
  const descriptor = ownDescriptor(values, index);
  const confirmed = ownDescriptor(values, index);
  if (!sameDataDescriptor(descriptor, confirmed)) {
    throw new NativeTypeError(`${label}[${index}] changed while it was inspected.`);
  }
  if (descriptor === undefined || !hasOwnDescriptorValue(descriptor) || !descriptor.enumerable) {
    throw new NativeTypeError(`${label}[${index}] must be an enumerable own data property.`);
  }
  return descriptor.value;
}

export function arrayAppend(values, value, label = 'array') {
  const index = arrayLength(values, label);
  apply(nativeDefineProperty, NativeObject, [
    values,
    index,
    { configurable: true, enumerable: true, value, writable: true },
  ]);
  if (!apply(nativeObjectIs, NativeObject, [arrayValue(values, index, label), value])) {
    throw new NativeTypeError(`${label} append failed.`);
  }
}

export function arrayMap(values, callback, label = 'array') {
  const output = [];
  const length = arrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    arrayAppend(output, callback(arrayValue(values, index, label), index), `${label} map`);
  }
  return output;
}

export function arrayFilter(values, predicate, label = 'array') {
  const output = [];
  const length = arrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    const value = arrayValue(values, index, label);
    if (predicate(value, index)) arrayAppend(output, value, `${label} filter`);
  }
  return output;
}

export function arraySome(values, predicate, label = 'array') {
  const length = arrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    if (predicate(arrayValue(values, index, label), index)) return true;
  }
  return false;
}

export function arrayFind(values, predicate, label = 'array') {
  const length = arrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    const value = arrayValue(values, index, label);
    if (predicate(value, index)) return value;
  }
  return undefined;
}

export function arrayReduce(values, reducer, initial, label = 'array') {
  let result = initial;
  const length = arrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    result = reducer(result, arrayValue(values, index, label), index);
  }
  return result;
}

export function arraySlice(values, start, end = arrayLength(values), label = 'array') {
  const output = [];
  const length = arrayLength(values, label);
  const fromCandidate = start < 0 ? length + start : start;
  const toCandidate = end < 0 ? length + end : end;
  const from = fromCandidate < 0 ? 0 : fromCandidate > length ? length : fromCandidate;
  const to = toCandidate < 0 ? 0 : toCandidate > length ? length : toCandidate;
  for (let index = from; index < to; index += 1) {
    arrayAppend(output, arrayValue(values, index, label), `${label} slice`);
  }
  return output;
}

export function arrayReverseCopy(values, label = 'array') {
  const output = [];
  for (let index = arrayLength(values, label) - 1; index >= 0; index -= 1) {
    arrayAppend(output, arrayValue(values, index, label), `${label} reverse`);
  }
  return output;
}

export function arraySort(values, compare, label = 'array') {
  if (typeof compare !== 'function') {
    throw new NativeTypeError(`${label} comparator must be a function.`);
  }
  let source = arraySlice(values, 0, arrayLength(values, label), label);
  const length = arrayLength(source, `${label} sort`);
  if (length < 2) return source;

  let target = [];
  for (let index = 0; index < length; index += 1) {
    arrayAppend(target, undefined, `${label} sort workspace`);
  }

  // Bottom-up stable merge sort keeps graph layout and BM25 ranking O(n log n)
  // without dispatching through a late-poisonable Array.prototype.sort.
  for (let width = 1; width < length; width *= 2) {
    const span = width * 2;
    for (let start = 0; start < length; start += span) {
      let left = start;
      const leftCandidate = start + width;
      const leftEnd = leftCandidate < length ? leftCandidate : length;
      let right = leftEnd;
      const rightCandidate = start + span;
      const rightEnd = rightCandidate < length ? rightCandidate : length;

      for (let write = start; write < rightEnd; write += 1) {
        const takeLeft =
          left < leftEnd &&
          (right >= rightEnd ||
            compare(
              arrayValue(source, left, `${label} sort`),
              arrayValue(source, right, `${label} sort`),
            ) <= 0);
        const value = takeLeft
          ? arrayValue(source, left++, `${label} sort`)
          : arrayValue(source, right++, `${label} sort`);
        defineOwnData(target, write, value);
      }
    }
    const previous = source;
    source = target;
    target = previous;
  }
  return source;
}

export function arrayIncludes(values, expected, label = 'array') {
  const length = arrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    if (apply(nativeObjectIs, NativeObject, [arrayValue(values, index, label), expected]))
      return true;
  }
  return false;
}

export function joinStrings(values, separator = '', label = 'strings') {
  let output = '';
  const length = arrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    const value = arrayValue(values, index, label);
    if (typeof value !== 'string')
      throw new NativeTypeError(`${label}[${index}] must be a string.`);
    if (index > 0) output += separator;
    output += value;
  }
  return output;
}

export function defineOwnData(record, key, value) {
  apply(nativeDefineProperty, NativeObject, [
    record,
    key,
    { configurable: true, enumerable: true, value, writable: true },
  ]);
  return record;
}

export function freeze(value) {
  assertControls();
  const frozen = apply(nativeFreeze, NativeObject, [value]);
  if (
    !apply(nativeObjectIs, NativeObject, [frozen, value]) ||
    !apply(nativeObjectIsFrozen, NativeObject, [frozen])
  ) {
    throw new NativeTypeError('Kovo devtool immutable snapshot commit failed.');
  }
  return frozen;
}

export function stableOwnData(record, key, label) {
  if (typeof record !== 'object' || record === null) {
    throw new NativeTypeError(`${label} must be an object.`);
  }
  const before = ownDescriptor(record, key);
  const after = ownDescriptor(record, key);
  if (!sameDataDescriptor(before, after)) {
    throw new NativeTypeError(
      `${label}.${apply(NativeString, undefined, [key])} changed while it was inspected.`,
    );
  }
  if (before === undefined) return { found: false, value: undefined };
  if (!hasOwnDescriptorValue(before) || !before.enumerable) {
    throw new NativeTypeError(
      `${label}.${apply(NativeString, undefined, [key])} must be an enumerable own data property.`,
    );
  }
  return { found: true, value: before.value };
}

export function assertPlainCarrier(value, label) {
  if (typeof value !== 'object' || value === null || isArray(value)) {
    throw new NativeTypeError(`${label} must be an object.`);
  }
  const prototype = apply(nativeGetPrototypeOf, NativeObject, [value]);
  if (prototype !== nativeObjectPrototype && prototype !== null) {
    throw new NativeTypeError(`${label} must have Object.prototype or null as its prototype.`);
  }
  return value;
}

export function createMap() {
  assertControls();
  return new NativeMap();
}

export function mapGet(map, key) {
  assertControls();
  return apply(nativeMapGet, map, [key]);
}

export function mapHas(map, key) {
  assertControls();
  return apply(nativeMapHas, map, [key]) === true;
}

export function mapSet(map, key, value) {
  assertControls();
  apply(nativeMapSet, map, [key, value]);
  if (!mapHas(map, key) || !apply(nativeObjectIs, NativeObject, [mapGet(map, key), value])) {
    throw new NativeTypeError('Kovo devtool Map commit failed.');
  }
}

export function createSet() {
  assertControls();
  return new NativeSet();
}

export function setAdd(set, value) {
  assertControls();
  apply(nativeSetAdd, set, [value]);
  if (!setHas(set, value)) throw new NativeTypeError('Kovo devtool Set commit failed.');
}

export function setHas(set, value) {
  assertControls();
  return apply(nativeSetHas, set, [value]) === true;
}

export function stringSlice(value, start, end) {
  if (typeof value !== 'string')
    throw new NativeTypeError('Kovo devtool string slice requires text.');
  return apply(nativeStringSlice, value, end === undefined ? [start] : [start, end]);
}

export function stringCharCodeAt(value, index) {
  if (typeof value !== 'string')
    throw new NativeTypeError('Kovo devtool character read requires text.');
  return apply(nativeStringCharCodeAt, value, [index]);
}

export function stringEndsWith(value, suffix) {
  if (typeof value !== 'string' || typeof suffix !== 'string') return false;
  return apply(nativeStringEndsWith, value, [suffix]) === true;
}

export function stringIncludes(value, search) {
  if (typeof value !== 'string' || typeof search !== 'string') return false;
  return apply(nativeStringIncludes, value, [search]) === true;
}

export function stringSplit(value, separator) {
  if (typeof value !== 'string' || typeof separator !== 'string') {
    throw new NativeTypeError('Kovo devtool string split requires text.');
  }
  return apply(nativeStringSplit, value, [separator]);
}

export function stringStartsWith(value, prefix) {
  if (typeof value !== 'string' || typeof prefix !== 'string') return false;
  return apply(nativeStringStartsWith, value, [prefix]) === true;
}

export function stringToLowerCase(value) {
  if (typeof value !== 'string') throw new NativeTypeError('Kovo devtool lowercase requires text.');
  return apply(nativeStringToLowerCase, value, []);
}

export function stringTrim(value) {
  if (typeof value !== 'string') throw new NativeTypeError('Kovo devtool trim requires text.');
  return apply(nativeStringTrim, value, []);
}

export function regexpExec(pattern, value) {
  if (typeof value !== 'string')
    throw new NativeTypeError('Kovo devtool RegExp input must be text.');
  return apply(nativeRegExpExec, pattern, [value]);
}

export function regexpTest(pattern, value) {
  if (typeof value !== 'string') return false;
  return apply(nativeRegExpTest, pattern, [value]) === true;
}

export function numberToFixed(value, digits) {
  if (typeof value !== 'number' || !apply(nativeNumberIsFinite, NativeNumber, [value])) {
    throw new NativeTypeError('Kovo devtool score must be finite.');
  }
  return apply(nativeNumberToFixed, value, [digits]);
}

export function numberLog(value) {
  if (
    typeof value !== 'number' ||
    value <= 0 ||
    !apply(nativeNumberIsFinite, NativeNumber, [value])
  ) {
    throw new NativeTypeError('Kovo devtool logarithm input must be positive and finite.');
  }
  return apply(nativeMathLog, NativeMath, [value]);
}

export function isSafeInteger(value) {
  return typeof value === 'number' && apply(nativeNumberIsSafeInteger, NativeNumber, [value]);
}

export function encodeQueryValue(value) {
  if (typeof value !== 'string')
    throw new NativeTypeError('Kovo devtool query value must be text.');
  return nativeEncodeURIComponent(value);
}

function textPrimitive(value, label) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && apply(nativeNumberIsFinite, NativeNumber, [value])) {
    return apply(NativeString, undefined, [value]);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null || value === undefined) return '';
  throw new NativeTypeError(`${label} must be a text primitive.`);
}

function escapeHtml(value, attribute) {
  const text = textPrimitive(value, attribute ? 'HTML attribute' : 'HTML text');
  let output = '';
  for (let index = 0; index < text.length; index += 1) {
    const code = apply(nativeStringCharCodeAt, text, [index]);
    if (code === 38) output += '&amp;';
    else if (code === 60) output += '&lt;';
    else if (code === 62) output += '&gt;';
    else if (attribute && code === 34) output += '&quot;';
    else if (attribute && code === 39) output += '&#39;';
    else if (code === 0) output += '&#0;';
    else output += apply(nativeStringSlice, text, [index, index + 1]);
  }
  return output;
}

export function escapeHtmlText(value) {
  assertControls();
  return escapeHtml(value, false);
}

export function escapeHtmlAttribute(value) {
  assertControls();
  return escapeHtml(value, true);
}

/** Encode a stylesheet for an HTML raw-text element without granting tag-breakout authority. */
export function renderStyleElement(css) {
  assertControls();
  if (typeof css !== 'string') throw new NativeTypeError('Kovo devtool stylesheet must be text.');
  let safe = '';
  for (let index = 0; index < css.length; index += 1) {
    const code = apply(nativeStringCharCodeAt, css, [index]);
    safe += code === 60 ? '\\3c ' : apply(nativeStringSlice, css, [index, index + 1]);
  }
  return `<style>${safe}</style>`;
}
