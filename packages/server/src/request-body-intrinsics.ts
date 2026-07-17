import {
  createSecurityNullRecord,
  securityArrayIsArray,
  securityArrayJoin,
  securityArrayPush,
  securityGetPrototypeOf,
  securityStringCharCodeAt,
  securityStringIncludes,
  securityStringIndexOf,
  securityStringReplaceAll,
  securityStringSlice,
  securityStringSplit,
  securityStringToLowerCase,
  securityStringTrim,
  securityTextEncode,
} from './response-security-intrinsics.js';
import {
  createWitnessWeakMap,
  witnessGetOwnPropertyDescriptor,
  witnessGetPrototypeOf,
  witnessDefineProperty,
  witnessReflectApply,
  witnessReflectGet,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';
import { requestForAuthorityNeutralMetadata } from './request-carrier.js';

/**
 * Package-private intrinsic membrane for attacker-controlled Request and FormData carriers.
 *
 * The application realm may replace fetch/body and collection prototypes after framework boot.
 * Security gates must therefore parse the original Request and FormData bytes through captured,
 * semantically checked platform operations (SPEC §6.6/§9.1/§9.2).
 */

const NativeBlob = globalThis.Blob;
const NativeFile = globalThis.File;
const NativeFormData = globalThis.FormData;
const NativeFunction = globalThis.Function;
const NativeHeaders = globalThis.Headers;
const NativeJSON = globalThis.JSON;
const NativeObject = globalThis.Object;
const NativeRequest = globalThis.Request;
const NativeReadableStream = globalThis.ReadableStream;
const NativeTextDecoder = globalThis.TextDecoder;
const NativeUint8Array = globalThis.Uint8Array;
const NativeURL = globalThis.URL;
const NativeURLSearchParams = globalThis.URLSearchParams;
const nativeIteratorSymbol: typeof Symbol.iterator = Symbol.iterator;
const MAX_REQUEST_BODY_CHUNKS = 4_096;

const nativeDecodeURIComponent = globalThis.decodeURIComponent;
const nativeFunctionHasInstance = NativeFunction.prototype[Symbol.hasInstance];
const nativeHeadersEntries = stablePlatformMethod(NativeHeaders.prototype, 'entries');
const nativeHeadersGet = stablePlatformMethod(NativeHeaders.prototype, 'get');
const nativeRequestBody = stablePlatformAccessor(NativeRequest.prototype, 'body');
const nativeRequestClone = stablePlatformMethod(NativeRequest.prototype, 'clone');
const nativeRequestHeaders = stablePlatformAccessor(NativeRequest.prototype, 'headers');
const nativeRequestMethod = stablePlatformAccessor(NativeRequest.prototype, 'method');
const nativeRequestUrl = stablePlatformAccessor(NativeRequest.prototype, 'url');
const nativeUrlHash = stablePlatformAccessor(NativeURL.prototype, 'hash');
const nativeUrlHref = stablePlatformAccessor(NativeURL.prototype, 'href');
const nativeUrlOrigin = stablePlatformAccessor(NativeURL.prototype, 'origin');
const nativeUrlPathname = stablePlatformAccessor(NativeURL.prototype, 'pathname');
const nativeUrlProtocol = stablePlatformAccessor(NativeURL.prototype, 'protocol');
const nativeUrlSearch = stablePlatformAccessor(NativeURL.prototype, 'search');
const nativeUrlSearchParams = stablePlatformAccessor(NativeURL.prototype, 'searchParams');
const nativeFormDataAppend = stablePlatformMethod(NativeFormData.prototype, 'append');
const nativeFormDataEntries = stablePlatformMethod(NativeFormData.prototype, 'entries');
const nativeFormDataGet = stablePlatformMethod(NativeFormData.prototype, 'get');
const nativeFormDataGetAll = stablePlatformMethod(NativeFormData.prototype, 'getAll');
const nativeFormDataValues = stablePlatformMethod(NativeFormData.prototype, 'values');
const nativeUrlSearchParamsEntries = stablePlatformMethod(
  NativeURLSearchParams.prototype,
  'entries',
);
const nativeUrlSearchParamsAppend = stablePlatformMethod(NativeURLSearchParams.prototype, 'append');
const nativeUrlSearchParamsToString = stablePlatformMethod(
  NativeURLSearchParams.prototype,
  'toString',
);
const nativeBlobArrayBuffer = stablePlatformMethod(NativeBlob.prototype, 'arrayBuffer');
const nativeBlobSize = stablePlatformAccessor(NativeBlob.prototype, 'size');
const nativeBlobType = stablePlatformAccessor(NativeBlob.prototype, 'type');
const nativeFileName = stablePlatformAccessor(NativeFile.prototype, 'name');
const nativeJsonParse = NativeJSON.parse;
const nativeTextDecoderDecode = stablePlatformMethod(NativeTextDecoder.prototype, 'decode');
const nativeTypedArrayLength = stablePlatformAccessor(NativeUint8Array.prototype, 'length');
const nativeObjectPrototype = NativeObject.prototype;
const textDecoder = new NativeTextDecoder();
const formDataProxyTargets = createWitnessWeakMap<object, FormData>();
const formDataExactEntries = createWitnessWeakMap<
  object,
  (readonly [string, FormDataEntryValue])[]
>();

const streamControlRequest = new NativeRequest('https://kovo.invalid/stream', {
  body: 'control',
  method: 'POST',
});
const streamControl = witnessReflectApply<ReadableStream<Uint8Array>>(
  nativeRequestBody,
  streamControlRequest,
  [],
);
const nativeStreamGetReader = stablePlatformMethod(streamControl, 'getReader');
const streamReaderControl = witnessReflectApply<ReadableStreamDefaultReader<Uint8Array>>(
  nativeStreamGetReader,
  streamControl,
  [],
);
const nativeStreamReaderRead = stablePlatformMethod(streamReaderControl, 'read');
const nativeStreamReaderReleaseLock = stablePlatformMethod(streamReaderControl, 'releaseLock');
witnessReflectApply(nativeStreamReaderReleaseLock, streamReaderControl, []);

const headersIteratorControl = new NativeHeaders({ control: 'genuine' });
const headersEntriesIteratorControl = witnessReflectApply<object>(
  nativeHeadersEntries,
  headersIteratorControl,
  [],
);
const nativeHeadersEntriesNext = stablePlatformMethod(headersEntriesIteratorControl, 'next');

const iteratorControl = new NativeFormData();
witnessReflectApply(nativeFormDataAppend, iteratorControl, ['control', 'genuine']);
const entriesIteratorControl = witnessReflectApply<object>(
  nativeFormDataEntries,
  iteratorControl,
  [],
);
const valuesIteratorControl = witnessReflectApply<object>(
  nativeFormDataValues,
  iteratorControl,
  [],
);
const nativeFormDataEntriesNext = stablePlatformMethod(entriesIteratorControl, 'next');
const nativeFormDataValuesNext = stablePlatformMethod(valuesIteratorControl, 'next');
const urlSearchParamsIteratorControl = new NativeURLSearchParams([
  ['control', 'genuine'],
  ['second', 'value'],
]);
const urlSearchParamsEntriesIteratorControl = witnessReflectApply<object>(
  nativeUrlSearchParamsEntries,
  urlSearchParamsIteratorControl,
  [],
);
const nativeUrlSearchParamsEntriesNext = stablePlatformMethod(
  urlSearchParamsEntriesIteratorControl,
  'next',
);

function stablePlatformMethod(source: object, property: PropertyKey): Function {
  let owner: object | null = source;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      if (!('value' in descriptor) || typeof descriptor.value !== 'function') {
        throw new TypeError(`Kovo request body control ${String(property)} is unavailable.`);
      }
      return descriptor.value;
    }
    owner = witnessGetPrototypeOf(owner);
  }
  throw new TypeError(`Kovo request body control ${String(property)} is unavailable.`);
}

function stablePlatformAccessor(source: object, property: PropertyKey): Function {
  let owner: object | null = source;
  for (let depth = 0; owner !== null && depth < 16; depth += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(owner, property);
    if (descriptor !== undefined) {
      if (typeof descriptor.get !== 'function') {
        throw new TypeError(`Kovo request body control ${String(property)} is unavailable.`);
      }
      return descriptor.get;
    }
    owner = witnessGetPrototypeOf(owner);
  }
  throw new TypeError(`Kovo request body control ${String(property)} is unavailable.`);
}

function capturedRequestControlsAreSound(): boolean {
  try {
    const request = new NativeRequest('https://kovo.invalid/submit', {
      body: '{"carrier":"json"}',
      headers: { 'content-type': 'application/json; charset=utf-8', 'x-kovo': 'control' },
      method: 'POST',
    });
    const headers = witnessReflectApply<Headers>(nativeRequestHeaders, request, []);
    if (witnessReflectApply(nativeHeadersGet, headers, ['x-kovo']) !== 'control') return false;
    if (witnessReflectApply(nativeHeadersGet, headers, ['missing']) !== null) return false;
    if (headerValueUnchecked(headers, 'x-kovo') !== 'control') return false;
    if (headerValueUnchecked(headers, 'missing') !== null) return false;
    if (witnessReflectApply(nativeRequestUrl, request, []) !== 'https://kovo.invalid/submit') {
      return false;
    }
    if (witnessReflectApply(nativeRequestMethod, request, []) !== 'POST') return false;
    const clone = witnessReflectApply<Request>(nativeRequestClone, request, []);
    if (
      clone === request ||
      !isInstanceUnchecked(NativeRequest, clone) ||
      request.bodyUsed ||
      clone.bodyUsed
    ) {
      return false;
    }

    const form = new NativeFormData();
    requestFormDataAppendUnchecked(form, 'csrf', 'submitted');
    requestFormDataAppendUnchecked(form, 'csrf', 'second');
    if (witnessReflectApply(nativeFormDataGet, form, ['csrf']) !== 'submitted') return false;
    if (witnessReflectApply(nativeFormDataGet, form, ['missing']) !== null) return false;
    const all = witnessReflectApply<FormDataEntryValue[]>(nativeFormDataGetAll, form, ['csrf']);
    if (all.length !== 2 || all[0] !== 'submitted' || all[1] !== 'second') return false;
    const entries = formDataEntriesUnchecked(form);
    if (
      entries.length !== 2 ||
      entries[0]?.[0] !== 'csrf' ||
      entries[0]?.[1] !== 'submitted' ||
      entries[1]?.[1] !== 'second'
    ) {
      return false;
    }
    const values = formDataValuesUnchecked(form);
    if (values.length !== 2 || values[0] !== 'submitted' || values[1] !== 'second') return false;
    if (!isInstanceUnchecked(NativeFormData, form) || isInstanceUnchecked(NativeFormData, {})) {
      return false;
    }
    const searchParams = new NativeURLSearchParams([
      ['control', 'genuine'],
      ['second', 'value'],
    ]);
    const appendedSearchParams = new NativeURLSearchParams();
    witnessReflectApply(nativeUrlSearchParamsAppend, appendedSearchParams, ['control', 'genuine']);
    witnessReflectApply(nativeUrlSearchParamsAppend, appendedSearchParams, ['second', 'value']);
    const searchEntries = urlSearchParamsEntriesUnchecked(searchParams);
    const parsedUrl = new NativeURL('https://kovo.invalid/path?control=genuine&second=value');
    const parsedSearchParams = witnessReflectApply<URLSearchParams>(
      nativeUrlSearchParams,
      parsedUrl,
      [],
    );
    if (
      !isInstanceUnchecked(NativeURLSearchParams, searchParams) ||
      isInstanceUnchecked(NativeURLSearchParams, {}) ||
      searchEntries.length !== 2 ||
      searchEntries[0]?.[0] !== 'control' ||
      searchEntries[0]?.[1] !== 'genuine' ||
      searchEntries[1]?.[0] !== 'second' ||
      searchEntries[1]?.[1] !== 'value' ||
      witnessReflectApply(nativeUrlSearchParamsToString, searchParams, []) !==
        'control=genuine&second=value' ||
      witnessReflectApply(nativeUrlSearchParamsToString, appendedSearchParams, []) !==
        'control=genuine&second=value' ||
      witnessReflectApply(nativeUrlSearchParamsToString, parsedSearchParams, []) !==
        'control=genuine&second=value' ||
      witnessReflectApply(nativeUrlHref, parsedUrl, []) !==
        'https://kovo.invalid/path?control=genuine&second=value' ||
      witnessReflectApply(nativeUrlOrigin, parsedUrl, []) !== 'https://kovo.invalid' ||
      witnessReflectApply(nativeUrlPathname, parsedUrl, []) !== '/path' ||
      witnessReflectApply(nativeUrlProtocol, parsedUrl, []) !== 'https:' ||
      witnessReflectApply(nativeUrlSearch, parsedUrl, []) !== '?control=genuine&second=value' ||
      witnessReflectApply(nativeUrlHash, parsedUrl, []) !== ''
    ) {
      return false;
    }

    const blob = new NativeBlob(['safe'], { type: 'text/plain' });
    if (!isInstanceUnchecked(NativeBlob, blob) || isInstanceUnchecked(NativeBlob, {})) return false;
    if (typeof NativeFile === 'function') {
      const file = new NativeFile(['safe'], 'safe.txt', { type: 'text/plain' });
      if (!isInstanceUnchecked(NativeFile, file) || isInstanceUnchecked(NativeFile, {}))
        return false;
      if (
        witnessReflectApply(nativeFileName, file, []) !== 'safe.txt' ||
        witnessReflectApply(nativeBlobType, file, []) !== 'text/plain' ||
        witnessReflectApply(nativeBlobSize, file, []) !== 4
      ) {
        return false;
      }
    }

    if (
      securityStringToLowerCase('Application/JSON; Charset=UTF-8') !==
      'application/json; charset=utf-8'
    ) {
      return false;
    }
    if (!securityStringIncludes('application/json; charset=utf-8', 'application/json')) {
      return false;
    }
    if (securityStringIncludes('text/plain', 'application/json')) return false;
    const cookieParts = securityStringSplit('sid=a=b; other=x', ';');
    if (
      cookieParts.length !== 2 ||
      securityStringTrim(cookieParts[0]!) !== 'sid=a=b' ||
      securityArrayJoin(securityStringSplit('a=b', '='), '=') !== 'a=b'
    ) {
      return false;
    }
    if (witnessReflectApply(nativeDecodeURIComponent, undefined, ['a%3Db']) !== 'a=b') return false;

    const decoded = witnessReflectApply<string>(nativeTextDecoderDecode, textDecoder, [
      new Uint8Array([0x7b, 0x22, 0x6f, 0x6b, 0x22, 0x3a, 0x74, 0x72, 0x75, 0x65, 0x7d]),
    ]);
    if (decoded !== '{"ok":true}') return false;
    const parsed = witnessReflectApply<Record<string, unknown>>(nativeJsonParse, NativeJSON, [
      decoded,
    ]);
    if (parsed.ok !== true) return false;
    let rejected = false;
    try {
      witnessReflectApply(nativeJsonParse, NativeJSON, ['{"broken"']);
    } catch {
      rejected = true;
    }
    if (!rejected) return false;

    if (securityGetPrototypeOf({}) !== nativeObjectPrototype) return false;
    if (securityGetPrototypeOf(createSecurityNullRecord()) !== null) return false;
    return true;
  } catch {
    return false;
  }
}

async function asynchronousRequestControlsAreSound(): Promise<boolean> {
  try {
    const jsonRequest = new NativeRequest('https://kovo.invalid/json', {
      body: '{"carrier":"json"}',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    const file = new NativeFile(['safe'], 'safe.txt', { type: 'text/plain' });
    const fileBytesPromise = witnessReflectApply<Promise<ArrayBuffer>>(
      nativeBlobArrayBuffer,
      file,
      [],
    );
    const jsonBytes = await requestBytesUnchecked(jsonRequest);
    if (
      typedArrayLengthUnchecked(jsonBytes) !== 18 ||
      jsonBytes[0] !== 0x7b ||
      jsonBytes[17] !== 0x7d
    ) {
      return false;
    }
    const jsonText = decodeUtf8Unchecked(jsonBytes);
    const json = witnessReflectApply<unknown>(nativeJsonParse, NativeJSON, [jsonText]);
    if (!requestIsPlainRecord(json) || json.carrier !== 'json') return false;
    const fileBytes = new NativeUint8Array(await fileBytesPromise);
    if (
      typedArrayLengthUnchecked(fileBytes) !== 4 ||
      fileBytes[0] !== 0x73 ||
      fileBytes[3] !== 0x65
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

const capturedRequestControlsSound = capturedRequestControlsAreSound();
const asynchronousRequestControlsSound = asynchronousRequestControlsAreSound();

export function assertRequestBodyIntrinsics(): void {
  if (!capturedRequestControlsSound) {
    throw new TypeError(
      'Kovo request body controls are unavailable because the server realm intrinsics were modified before framework initialization.',
    );
  }
}

export async function assertRequestBodyAsyncIntrinsics(): Promise<void> {
  assertRequestBodyIntrinsics();
  if (!(await asynchronousRequestControlsSound)) {
    throw new TypeError(
      'Kovo asynchronous request body controls are unavailable because the server realm intrinsics were modified before framework initialization.',
    );
  }
}

export function requestHeaders(request: Request): Headers {
  assertRequestBodyIntrinsics();
  try {
    return witnessReflectApply(nativeRequestHeaders, request, []);
  } catch (error) {
    if (!isRequestUnchecked(request)) throw error;
    const headers = witnessReflectGet(request, 'headers', request);
    if (!isHeadersUnchecked(headers)) throw error;
    return headers;
  }
}

export function requestHeader(request: Request, name: string): string | null {
  const headers = requestHeaders(request);
  return headerValueUnchecked(headers, securityStringToLowerCase(name));
}

function headerValueUnchecked(headers: Headers, target: string): string | null {
  const iterator = witnessReflectApply<object>(nativeHeadersEntries, headers, []);
  for (let count = 0; count <= 100_000; count += 1) {
    const result = witnessReflectApply<{ done?: unknown; value?: unknown }>(
      nativeHeadersEntriesNext,
      iterator,
      [],
    );
    if (typeof result !== 'object' || result === null) {
      throw new TypeError('Kovo received an invalid Headers iterator result.');
    }
    if (result.done === true) return null;
    if (
      result.done !== false ||
      !securityArrayIsArray(result.value) ||
      result.value.length !== 2 ||
      typeof result.value[0] !== 'string' ||
      typeof result.value[1] !== 'string'
    ) {
      throw new TypeError('Kovo received an invalid Headers entry.');
    }
    if (result.value[0] === target) return result.value[1];
  }
  throw new TypeError('Kovo refused an unbounded Headers carrier.');
}

export function requestClone(request: Request): Request {
  assertRequestBodyIntrinsics();
  try {
    return witnessReflectApply(nativeRequestClone, request, []);
  } catch (error) {
    if (!isRequestUnchecked(request)) throw error;
    const clone = witnessReflectGet(request, 'clone', request);
    if (typeof clone !== 'function') throw error;
    const result = witnessReflectApply<unknown>(clone, request, []);
    if (!isRequestUnchecked(result)) throw error;
    return result;
  }
}

export async function requestJson(request: Request): Promise<unknown> {
  await assertRequestBodyAsyncIntrinsics();
  const bytes = await requestBytesUnchecked(request);
  return witnessReflectApply(nativeJsonParse, NativeJSON, [decodeUtf8Unchecked(bytes)]);
}

export async function requestFormData(request: Request): Promise<FormData> {
  await assertRequestBodyAsyncIntrinsics();
  const contentType = requestHeader(request, 'content-type');
  if (contentType === null) {
    throw new TypeError('Kovo form request is missing a Content-Type header.');
  }
  return parseFormDataBytes(await requestBytesUnchecked(request), contentType);
}

async function requestBytesUnchecked(request: Request): Promise<Uint8Array> {
  const stream = requestBodyUnchecked(request);
  if (stream === null) return new NativeUint8Array(0);

  const reader = witnessReflectApply<ReadableStreamDefaultReader<Uint8Array>>(
    nativeStreamGetReader,
    stream,
    [],
  );
  const chunks: Uint8Array[] = [];
  let chunkCount = 0;
  let total = 0;
  try {
    while (true) {
      const result = await witnessReflectApply<Promise<ReadableStreamReadResult<Uint8Array>>>(
        nativeStreamReaderRead,
        reader,
        [],
      );
      if (result.done === true) break;
      if (result.done !== false || !isInstanceUnchecked(NativeUint8Array, result.value)) {
        throw new TypeError('Kovo received an invalid request body stream chunk.');
      }
      chunkCount += 1;
      if (chunkCount > MAX_REQUEST_BODY_CHUNKS) {
        throw new TypeError('Kovo refused a request body with too many stream chunks.');
      }
      const length = typedArrayLengthUnchecked(result.value);
      if (length > 9_007_199_254_740_991 - total) {
        throw new TypeError('Kovo refused an unbounded request body stream.');
      }
      total += length;
      securityArrayPush(chunks, result.value);
    }
  } finally {
    witnessReflectApply(nativeStreamReaderReleaseLock, reader, []);
  }

  const bytes = new NativeUint8Array(total);
  let offset = 0;
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex]!;
    const length = typedArrayLengthUnchecked(chunk);
    for (let index = 0; index < length; index += 1) {
      bytes[offset] = chunk[index]!;
      offset += 1;
    }
  }
  return bytes;
}

function requestBodyUnchecked(request: Request): ReadableStream<Uint8Array> | null {
  try {
    return witnessReflectApply(nativeRequestBody, request, []);
  } catch (error) {
    if (!isRequestUnchecked(request)) throw error;
    const stream = witnessReflectGet(request, 'body', request);
    if (stream === null) return null;
    if (!isReadableStreamUnchecked(stream)) throw error;
    return stream;
  }
}

function isReadableStreamUnchecked(value: unknown): value is ReadableStream<Uint8Array> {
  return isInstanceUnchecked(NativeReadableStream, value);
}

function decodeUtf8Unchecked(value: Uint8Array): string {
  return witnessReflectApply(nativeTextDecoderDecode, textDecoder, [value]);
}

function typedArrayLengthUnchecked(value: Uint8Array): number {
  return witnessReflectApply(nativeTypedArrayLength, value, []);
}

function parseFormDataBytes(bytes: Uint8Array, contentType: string): FormData {
  const type = parseParameterizedHeader(contentType);
  if (type.head === 'application/x-www-form-urlencoded') {
    return parseUrlEncodedForm(bytes);
  }
  if (type.head === 'multipart/form-data') {
    const boundary = type.parameters.boundary;
    if (boundary === undefined) {
      throw new TypeError('Kovo multipart form is missing its boundary.');
    }
    validateMultipartBoundary(boundary);
    return parseMultipartForm(bytes, boundary);
  }
  throw new TypeError('Kovo request body is not a supported form carrier.');
}

function parseUrlEncodedForm(bytes: Uint8Array): FormData {
  const form = createRegisteredFormDataUnchecked();
  const body = decodeUtf8Unchecked(bytes);
  if (body.length === 0) return form;

  const pairs = securityStringSplit(body, '&');
  for (let index = 0; index < pairs.length; index += 1) {
    const pair = pairs[index]!;
    if (pair.length === 0) continue;
    const separator = securityStringIndexOf(pair, '=');
    const name = decodeUrlEncodedComponent(
      separator === -1 ? pair : securityStringSlice(pair, 0, separator),
    );
    const value = decodeUrlEncodedComponent(
      separator === -1 ? '' : securityStringSlice(pair, separator + 1),
    );
    requestFormDataAppendUnchecked(form, name, value);
  }
  return form;
}

function decodeUrlEncodedComponent(value: string): string {
  return witnessReflectApply(nativeDecodeURIComponent, undefined, [
    securityStringReplaceAll(value, '+', ' '),
  ]);
}

interface ParsedParameterizedHeader {
  head: string;
  parameters: Record<string, string>;
}

function parseParameterizedHeader(value: string): ParsedParameterizedHeader {
  const parameters = createSecurityNullRecord<string>() as Record<string, string>;
  const firstSeparator = securityStringIndexOf(value, ';');
  const rawHead = firstSeparator === -1 ? value : securityStringSlice(value, 0, firstSeparator);
  const head = securityStringToLowerCase(securityStringTrim(rawHead));
  let position = firstSeparator === -1 ? value.length : firstSeparator;

  while (position < value.length) {
    if (securityStringCharCodeAt(value, position) !== 0x3b) {
      throw new TypeError('Kovo received an invalid parameterized header.');
    }
    position += 1;
    position = skipOptionalWhitespace(value, position);
    if (position >= value.length) {
      throw new TypeError('Kovo received an empty header parameter.');
    }

    const nameStart = position;
    while (position < value.length) {
      const code = securityStringCharCodeAt(value, position);
      if (code === 0x3d || code === 0x3b) break;
      position += 1;
    }
    if (position >= value.length || securityStringCharCodeAt(value, position) !== 0x3d) {
      throw new TypeError('Kovo received a header parameter without a value.');
    }
    const name = securityStringToLowerCase(
      securityStringTrim(securityStringSlice(value, nameStart, position)),
    );
    if (name.length === 0) {
      throw new TypeError('Kovo received a header parameter without a name.');
    }
    position += 1;
    position = skipOptionalWhitespace(value, position);

    let parameterValue = '';
    if (position < value.length && securityStringCharCodeAt(value, position) === 0x22) {
      position += 1;
      let closed = false;
      while (position < value.length) {
        const code = securityStringCharCodeAt(value, position);
        if (code === 0x22) {
          position += 1;
          closed = true;
          break;
        }
        if (code === 0x5c) {
          position += 1;
          if (position >= value.length) {
            throw new TypeError('Kovo received an invalid quoted header parameter.');
          }
        }
        parameterValue += securityStringSlice(value, position, position + 1);
        position += 1;
      }
      if (!closed) {
        throw new TypeError('Kovo received an unterminated quoted header parameter.');
      }
      position = skipOptionalWhitespace(value, position);
      if (position < value.length && securityStringCharCodeAt(value, position) !== 0x3b) {
        throw new TypeError('Kovo received bytes after a quoted header parameter.');
      }
    } else {
      const valueStart = position;
      while (position < value.length && securityStringCharCodeAt(value, position) !== 0x3b) {
        position += 1;
      }
      parameterValue = securityStringTrim(securityStringSlice(value, valueStart, position));
    }

    if (parameters[name] !== undefined) {
      throw new TypeError(`Kovo received duplicate ${name} header parameters.`);
    }
    parameters[name] = parameterValue;
  }

  return { head, parameters };
}

function skipOptionalWhitespace(value: string, start: number): number {
  let position = start;
  while (position < value.length) {
    const code = securityStringCharCodeAt(value, position);
    if (code !== 0x20 && code !== 0x09) break;
    position += 1;
  }
  return position;
}

function validateMultipartBoundary(boundary: string): void {
  if (boundary.length < 1 || boundary.length > 70) {
    throw new TypeError('Kovo received an invalid multipart boundary length.');
  }
  for (let index = 0; index < boundary.length; index += 1) {
    const code = securityStringCharCodeAt(boundary, index);
    if (code < 0x21 || code > 0x7e) {
      throw new TypeError('Kovo received a non-ASCII multipart boundary.');
    }
  }
}

function parseMultipartForm(bytes: Uint8Array, boundary: string): FormData {
  const form = createRegisteredFormDataUnchecked();
  const delimiter = securityTextEncode(`--${boundary}`);
  const nextDelimiter = securityTextEncode(`\r\n--${boundary}`);
  const headerTerminator = byteSequence(0x0d, 0x0a, 0x0d, 0x0a);
  const bytesLength = typedArrayLengthUnchecked(bytes);
  const delimiterLength = typedArrayLengthUnchecked(delimiter);
  if (!bytesStartWithAt(bytes, delimiter, 0)) {
    throw new TypeError('Kovo multipart body does not start with its declared boundary.');
  }

  let position = delimiterLength;
  let parts = 0;
  while (position <= bytesLength) {
    if (bytes[position] === 0x2d && bytes[position + 1] === 0x2d) {
      return form;
    }
    if (bytes[position] !== 0x0d || bytes[position + 1] !== 0x0a) {
      throw new TypeError('Kovo multipart boundary is not followed by CRLF.');
    }
    position += 2;

    const headerEnd = indexOfBytes(bytes, headerTerminator, position);
    if (headerEnd === -1 || headerEnd - position > 65_536) {
      throw new TypeError('Kovo multipart part headers are missing or too large.');
    }
    const headers = parseMultipartPartHeaders(copyBytes(bytes, position, headerEnd));
    const bodyStart = headerEnd + typedArrayLengthUnchecked(headerTerminator);
    const boundaryPosition = findMultipartBoundary(bytes, nextDelimiter, bodyStart);
    if (boundaryPosition === -1) {
      throw new TypeError('Kovo multipart part is missing its closing boundary.');
    }
    const body = copyBytes(bytes, bodyStart, boundaryPosition);
    if (headers.filename === undefined) {
      requestFormDataAppendUnchecked(form, headers.name, decodeUtf8Unchecked(body));
    } else {
      const file = new NativeFile(safeBlobParts(body), headers.filename, {
        type: headers.contentType ?? 'text/plain',
      });
      requestFormDataAppendUnchecked(form, headers.name, file);
    }

    parts += 1;
    if (parts > 100_000) {
      throw new TypeError('Kovo refused a multipart form with too many parts.');
    }
    position = boundaryPosition + typedArrayLengthUnchecked(nextDelimiter);
  }

  throw new TypeError('Kovo multipart body ended before its closing boundary.');
}

interface MultipartPartHeaders {
  contentType?: string;
  filename?: string;
  name: string;
}

function parseMultipartPartHeaders(bytes: Uint8Array): MultipartPartHeaders {
  const block = decodeUtf8Unchecked(bytes);
  const lines = securityStringSplit(block, '\r\n');
  let contentDisposition: string | undefined;
  let contentType: string | undefined;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const separator = securityStringIndexOf(line, ':');
    if (separator <= 0) {
      throw new TypeError('Kovo received an invalid multipart part header.');
    }
    const name = securityStringToLowerCase(
      securityStringTrim(securityStringSlice(line, 0, separator)),
    );
    const value = securityStringTrim(securityStringSlice(line, separator + 1));
    if (name === 'content-disposition') {
      if (contentDisposition !== undefined) {
        throw new TypeError('Kovo received duplicate multipart Content-Disposition headers.');
      }
      contentDisposition = value;
    } else if (name === 'content-type') {
      if (contentType !== undefined) {
        throw new TypeError('Kovo received duplicate multipart Content-Type headers.');
      }
      contentType = value;
    }
  }

  if (contentDisposition === undefined) {
    throw new TypeError('Kovo multipart part is missing Content-Disposition.');
  }
  const disposition = parseParameterizedHeader(contentDisposition);
  if (disposition.head !== 'form-data' || disposition.parameters.name === undefined) {
    throw new TypeError('Kovo multipart Content-Disposition is not a named form-data part.');
  }
  return {
    name: disposition.parameters.name,
    ...(contentType === undefined ? {} : { contentType }),
    ...(disposition.parameters.filename === undefined
      ? {}
      : { filename: disposition.parameters.filename }),
  };
}

function findMultipartBoundary(bytes: Uint8Array, delimiter: Uint8Array, start: number): number {
  let candidate = indexOfBytes(bytes, delimiter, start);
  while (candidate !== -1) {
    const suffix = candidate + typedArrayLengthUnchecked(delimiter);
    if (
      (bytes[suffix] === 0x2d && bytes[suffix + 1] === 0x2d) ||
      (bytes[suffix] === 0x0d && bytes[suffix + 1] === 0x0a)
    ) {
      return candidate;
    }
    candidate = indexOfBytes(bytes, delimiter, candidate + 1);
  }
  return -1;
}

function indexOfBytes(bytes: Uint8Array, search: Uint8Array, start: number): number {
  const bytesLength = typedArrayLengthUnchecked(bytes);
  const searchLength = typedArrayLengthUnchecked(search);
  for (let index = start; index + searchLength <= bytesLength; index += 1) {
    if (bytesStartWithAt(bytes, search, index)) return index;
  }
  return -1;
}

function bytesStartWithAt(bytes: Uint8Array, search: Uint8Array, start: number): boolean {
  const searchLength = typedArrayLengthUnchecked(search);
  for (let index = 0; index < searchLength; index += 1) {
    if (bytes[start + index] !== search[index]) return false;
  }
  return true;
}

function copyBytes(bytes: Uint8Array, start: number, end: number): Uint8Array<ArrayBuffer> {
  const copy = new NativeUint8Array(end - start);
  for (let index = 0; index < end - start; index += 1) {
    copy[index] = bytes[start + index]!;
  }
  return copy;
}

function byteSequence(...values: number[]): Uint8Array {
  const bytes = new NativeUint8Array(values.length);
  for (let index = 0; index < values.length; index += 1) {
    bytes[index] = values[index]!;
  }
  return bytes;
}

function safeBlobParts(value: BlobPart): BlobPart[] {
  const parts: BlobPart[] = [value];
  witnessDefineProperty(parts, nativeIteratorSymbol, {
    configurable: true,
    value(): IterableIterator<BlobPart> {
      let emitted = false;
      const iterator: IterableIterator<BlobPart> = {
        next(): IteratorResult<BlobPart> {
          if (emitted) return { done: true, value: undefined };
          emitted = true;
          return { done: false, value };
        },
        [nativeIteratorSymbol](): IterableIterator<BlobPart> {
          return this;
        },
      };
      return iterator;
    },
  });
  return parts;
}

export function requestCreateFormData(): FormData {
  assertRequestBodyIntrinsics();
  return createRegisteredFormDataUnchecked();
}

function createRegisteredFormDataUnchecked(): FormData {
  const form = new NativeFormData();
  witnessWeakMapSet(formDataExactEntries, form, []);
  return form;
}

export function requestIsRequest(value: unknown): value is Request {
  assertRequestBodyIntrinsics();
  return isRequestUnchecked(value);
}

export interface RequestUrlSnapshot {
  readonly hash: string;
  readonly href: string;
  readonly origin: string;
  readonly pathname: string;
  readonly protocol: string;
  readonly search: string;
  readonly searchParams: URLSearchParams;
}

export function requestMethod(request: Request): string {
  assertRequestBodyIntrinsics();
  if (!isRequestUnchecked(request)) {
    throw new TypeError('Kovo request method requires a genuine Request carrier.');
  }
  try {
    return witnessReflectApply(nativeRequestMethod, request, []);
  } catch (error) {
    const source = requestForAuthorityNeutralMetadata(request);
    if (source === request) throw error;
    return witnessReflectApply(nativeRequestMethod, source, []);
  }
}

export function requestUrl(request: Request): string {
  assertRequestBodyIntrinsics();
  if (!isRequestUnchecked(request)) {
    throw new TypeError('Kovo request URL requires a genuine Request carrier.');
  }
  try {
    return witnessReflectApply(nativeRequestUrl, request, []);
  } catch (error) {
    const source = requestForAuthorityNeutralMetadata(request);
    if (source === request) throw error;
    return witnessReflectApply(nativeRequestUrl, source, []);
  }
}

export function requestCreateUrl(input: string, base?: string): URL {
  assertRequestBodyIntrinsics();
  return base === undefined ? new NativeURL(input) : new NativeURL(input, base);
}

export function requestUrlSnapshot(url: URL): RequestUrlSnapshot {
  assertRequestBodyIntrinsics();
  if (!isInstanceUnchecked(NativeURL, url)) {
    throw new TypeError('Kovo request URL snapshot requires a genuine URL carrier.');
  }
  return {
    hash: witnessReflectApply(nativeUrlHash, url, []),
    href: witnessReflectApply(nativeUrlHref, url, []),
    origin: witnessReflectApply(nativeUrlOrigin, url, []),
    pathname: witnessReflectApply(nativeUrlPathname, url, []),
    protocol: witnessReflectApply(nativeUrlProtocol, url, []),
    search: witnessReflectApply(nativeUrlSearch, url, []),
    searchParams: witnessReflectApply(nativeUrlSearchParams, url, []),
  };
}

export function requestIsFormData(value: unknown): value is FormData {
  assertRequestBodyIntrinsics();
  return isInstanceUnchecked(NativeFormData, value);
}

export function requestIsUrlSearchParams(value: unknown): value is URLSearchParams {
  assertRequestBodyIntrinsics();
  return isInstanceUnchecked(NativeURLSearchParams, value);
}

export function requestUrlSearchParams(url: URL): URLSearchParams {
  assertRequestBodyIntrinsics();
  if (!isInstanceUnchecked(NativeURL, url)) {
    throw new TypeError('Kovo request URL must be a genuine URL carrier.');
  }
  return witnessReflectApply(nativeUrlSearchParams, url, []);
}

export function requestUrlSearchParamsEntries(
  searchParams: URLSearchParams,
): readonly (readonly [string, string])[] {
  assertRequestBodyIntrinsics();
  if (!isInstanceUnchecked(NativeURLSearchParams, searchParams)) {
    throw new TypeError('Kovo query search input must be a genuine URLSearchParams carrier.');
  }
  return urlSearchParamsEntriesUnchecked(searchParams);
}

export function requestSerializeUrlSearchParamsEntries(
  entries: readonly (readonly [string, string])[],
): string {
  assertRequestBodyIntrinsics();
  const searchParams = new NativeURLSearchParams();
  for (let index = 0; index < entries.length; index += 1) {
    const descriptor = witnessGetOwnPropertyDescriptor(entries, index);
    if (
      descriptor === undefined ||
      !('value' in descriptor) ||
      !securityArrayIsArray(descriptor.value) ||
      descriptor.value.length !== 2 ||
      typeof descriptor.value[0] !== 'string' ||
      typeof descriptor.value[1] !== 'string'
    ) {
      throw new TypeError('Kovo query search entries must be stable string pairs.');
    }
    witnessReflectApply(nativeUrlSearchParamsAppend, searchParams, [
      descriptor.value[0],
      descriptor.value[1],
    ]);
  }
  return witnessReflectApply(nativeUrlSearchParamsToString, searchParams, []);
}

function urlSearchParamsEntriesUnchecked(
  searchParams: URLSearchParams,
): readonly (readonly [string, string])[] {
  const iterator = witnessReflectApply<object>(nativeUrlSearchParamsEntries, searchParams, []);
  const entries: (readonly [string, string])[] = [];
  for (let count = 0; count <= 100_000; count += 1) {
    const result = witnessReflectApply<{ done?: unknown; value?: unknown }>(
      nativeUrlSearchParamsEntriesNext,
      iterator,
      [],
    );
    if (typeof result !== 'object' || result === null) {
      throw new TypeError('Kovo received an invalid URLSearchParams iterator result.');
    }
    if (result.done === true) return entries;
    if (
      result.done !== false ||
      !securityArrayIsArray(result.value) ||
      result.value.length !== 2 ||
      typeof result.value[0] !== 'string' ||
      typeof result.value[1] !== 'string'
    ) {
      throw new TypeError('Kovo received an invalid URLSearchParams entry.');
    }
    securityArrayPush(entries, [result.value[0], result.value[1]] as const);
  }
  throw new TypeError('Kovo refused an unbounded URLSearchParams carrier.');
}

export function requestIsBlob(value: unknown): value is Blob {
  assertRequestBodyIntrinsics();
  return isInstanceUnchecked(NativeBlob, value);
}

export function requestIsFile(value: unknown): value is File {
  assertRequestBodyIntrinsics();
  return isFileUnchecked(value);
}

export function requestFileName(value: File): string {
  assertRequestBodyIntrinsics();
  return witnessReflectApply(nativeFileName, value, []);
}

export function requestBlobSize(value: Blob): number {
  assertRequestBodyIntrinsics();
  return witnessReflectApply(nativeBlobSize, value, []);
}

export function requestBlobType(value: Blob): string {
  assertRequestBodyIntrinsics();
  return witnessReflectApply(nativeBlobType, value, []);
}

export async function requestBlobArrayBuffer(value: Blob): Promise<ArrayBuffer> {
  await assertRequestBodyAsyncIntrinsics();
  return await witnessReflectApply<Promise<ArrayBuffer>>(nativeBlobArrayBuffer, value, []);
}

function isRequestUnchecked(value: unknown): value is Request {
  return isInstanceUnchecked(NativeRequest, value);
}

function isHeadersUnchecked(value: unknown): value is Headers {
  return isInstanceUnchecked(NativeHeaders, value);
}

function isFileUnchecked(value: unknown): value is File {
  return isInstanceUnchecked(NativeFile, value);
}

function isInstanceUnchecked(constructor: Function, value: unknown): boolean {
  return witnessReflectApply(nativeFunctionHasInstance, constructor, [value]);
}

export function requestFormDataGet(form: FormData, name: string): FormDataEntryValue | null {
  assertRequestBodyIntrinsics();
  const target = requestFormDataTarget(form);
  const exact = witnessWeakMapGet(formDataExactEntries, target);
  if (exact !== undefined) {
    for (let index = 0; index < exact.length; index += 1) {
      if (exact[index]![0] === name) return exact[index]![1];
    }
    return null;
  }
  return witnessReflectApply(nativeFormDataGet, target, [name]);
}

export function requestFormDataGetAll(form: FormData, name: string): FormDataEntryValue[] {
  assertRequestBodyIntrinsics();
  const target = requestFormDataTarget(form);
  const snapshot: FormDataEntryValue[] = [];
  const exact = witnessWeakMapGet(formDataExactEntries, target);
  if (exact !== undefined) {
    for (let index = 0; index < exact.length; index += 1) {
      if (exact[index]![0] === name) securityArrayPush(snapshot, exact[index]![1]);
    }
  } else {
    const values = witnessReflectApply<FormDataEntryValue[]>(nativeFormDataGetAll, target, [name]);
    for (let index = 0; index < values.length; index += 1) {
      securityArrayPush(snapshot, values[index]!);
    }
  }
  return snapshot;
}

export function requestFormDataAppend(
  form: FormData,
  name: string,
  value: string | Blob,
  filename?: string,
): void {
  assertRequestBodyIntrinsics();
  requestFormDataAppendUnchecked(form, name, value, filename);
}

function requestFormDataAppendUnchecked(
  form: FormData,
  name: string,
  value: string | Blob,
  filename?: string,
): void {
  const target = requestFormDataTarget(form);
  const exact = witnessWeakMapGet(formDataExactEntries, target);
  if (exact !== undefined) {
    securityArrayPush(exact, [name, normalizeFormDataEntry(value, filename)] as const);
  }
  try {
    witnessReflectApply(
      nativeFormDataAppend,
      target,
      filename === undefined ? [name, value] : [name, value, filename],
    );
  } catch (error) {
    if (exact === undefined) throw error;
  }
}

function normalizeFormDataEntry(
  value: string | Blob,
  filename: string | undefined,
): FormDataEntryValue {
  if (typeof value === 'string') return value;
  if (filename === undefined && isFileUnchecked(value)) return value;
  const type = witnessReflectApply<string>(nativeBlobType, value, []);
  return new NativeFile(safeBlobParts(value), filename ?? 'blob', { type });
}

export function requestFormDataEntries(
  form: FormData,
): readonly (readonly [string, FormDataEntryValue])[] {
  assertRequestBodyIntrinsics();
  return formDataEntriesUnchecked(form);
}

function formDataEntriesUnchecked(
  form: FormData,
): readonly (readonly [string, FormDataEntryValue])[] {
  const target = requestFormDataTarget(form);
  const exact = witnessWeakMapGet(formDataExactEntries, target);
  if (exact !== undefined) return snapshotExactFormDataEntries(exact);
  return nativeFormDataEntriesUnchecked(target);
}

function nativeFormDataEntriesUnchecked(
  form: FormData,
): readonly (readonly [string, FormDataEntryValue])[] {
  const iterator = witnessReflectApply<object>(nativeFormDataEntries, form, []);
  return consumeFormDataIterator(iterator, nativeFormDataEntriesNext, true) as readonly (readonly [
    string,
    FormDataEntryValue,
  ])[];
}

export function requestFormDataValues(form: FormData): readonly FormDataEntryValue[] {
  assertRequestBodyIntrinsics();
  return formDataValuesUnchecked(form);
}

function formDataValuesUnchecked(form: FormData): readonly FormDataEntryValue[] {
  const target = requestFormDataTarget(form);
  const exact = witnessWeakMapGet(formDataExactEntries, target);
  if (exact !== undefined) {
    const values: FormDataEntryValue[] = [];
    for (let index = 0; index < exact.length; index += 1) {
      securityArrayPush(values, exact[index]![1]);
    }
    return values;
  }
  const iterator = witnessReflectApply<object>(nativeFormDataValues, target, []);
  return consumeFormDataIterator(
    iterator,
    nativeFormDataValuesNext,
    false,
  ) as readonly FormDataEntryValue[];
}

function consumeFormDataIterator(
  iterator: object,
  next: Function,
  entries: boolean,
): readonly unknown[] {
  const values: unknown[] = [];
  for (let count = 0; count <= 1_000_000; count += 1) {
    const result = witnessReflectApply<{ done?: unknown; value?: unknown }>(next, iterator, []);
    if (typeof result !== 'object' || result === null) {
      throw new TypeError('Kovo received an invalid FormData iterator result.');
    }
    if (result.done === true) return values;
    if (result.done !== false)
      throw new TypeError('Kovo received an invalid FormData iterator state.');
    if (entries) {
      if (
        !securityArrayIsArray(result.value) ||
        result.value.length !== 2 ||
        typeof result.value[0] !== 'string'
      ) {
        throw new TypeError('Kovo received an invalid FormData entry.');
      }
      securityArrayPush(values, [result.value[0], result.value[1]] as const);
    } else {
      securityArrayPush(values, result.value);
    }
  }
  throw new TypeError('Kovo refused an unbounded FormData carrier.');
}

export function requestIterableIterator<Value>(values: readonly Value[]): IterableIterator<Value> {
  assertRequestBodyIntrinsics();
  let index = 0;
  return {
    next(): IteratorResult<Value> {
      if (index >= values.length) return { done: true, value: undefined };
      const value = values[index]!;
      index += 1;
      return { done: false, value };
    },
    [nativeIteratorSymbol](): IterableIterator<Value> {
      return this;
    },
  };
}

export function requestRegisterFormDataProxy(proxy: FormData, target: FormData): void {
  assertRequestBodyIntrinsics();
  if (witnessWeakMapGet(formDataExactEntries, target) === undefined) {
    witnessWeakMapSet(
      formDataExactEntries,
      target,
      snapshotExactFormDataEntries(nativeFormDataEntriesUnchecked(target)),
    );
  }
  witnessWeakMapSet(formDataProxyTargets, proxy, target);
}

function snapshotExactFormDataEntries(
  entries: readonly (readonly [string, FormDataEntryValue])[],
): (readonly [string, FormDataEntryValue])[] {
  const snapshot: (readonly [string, FormDataEntryValue])[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const pair = entries[index]!;
    securityArrayPush(snapshot, [pair[0], pair[1]] as const);
  }
  return snapshot;
}

function requestFormDataTarget(form: FormData): FormData {
  return witnessWeakMapGet(formDataProxyTargets, form) ?? form;
}

export function requestDecodeURIComponent(value: string): string {
  assertRequestBodyIntrinsics();
  return witnessReflectApply(nativeDecodeURIComponent, undefined, [value]);
}

export function requestDecodeUtf8(value: ArrayBuffer | Uint8Array): string {
  assertRequestBodyIntrinsics();
  return witnessReflectApply(nativeTextDecoderDecode, textDecoder, [value]);
}

export function requestParseJson(value: string): unknown {
  assertRequestBodyIntrinsics();
  return witnessReflectApply(nativeJsonParse, NativeJSON, [value]);
}

export function requestIsPlainRecord(value: unknown): value is Record<string, unknown> {
  assertRequestBodyIntrinsics();
  if (typeof value !== 'object' || value === null || securityArrayIsArray(value)) return false;
  const prototype = securityGetPrototypeOf(value);
  return prototype === nativeObjectPrototype || prototype === null;
}

export function requestReflectGet(
  target: object,
  property: PropertyKey,
  receiver: unknown,
): unknown {
  assertRequestBodyIntrinsics();
  return witnessReflectGet(target, property, receiver);
}

export function requestApply<Return>(
  target: Function,
  receiver: unknown,
  args: readonly unknown[],
): Return {
  assertRequestBodyIntrinsics();
  return witnessReflectApply(target, receiver, args);
}

export function requestCreateNullRecord<Value = unknown>(): Record<PropertyKey, Value> {
  assertRequestBodyIntrinsics();
  return createSecurityNullRecord<Value>();
}
