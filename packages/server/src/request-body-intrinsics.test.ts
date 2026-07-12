import { describe, expect, it } from 'vitest';

import { csrfToken, validateCsrfToken } from './csrf.js';
import {
  assertRequestBodyAsyncIntrinsics,
  requestSerializeUrlSearchParamsEntries,
  requestUrlSearchParamsEntries,
} from './request-body-intrinsics.js';
import { formLikeToRecord } from './schema.js';
import {
  parseUntrustedJsonBodyBytes,
  readCsrfCarrierFromRequest,
  readUntrustedCookieValue,
  readUntrustedRequestBody,
  readUntrustedRequestHeader,
  revealUntrustedRequestValue,
  tagUntrustedRequestValue,
} from './untrusted-request-body.js';

const intrinsicModuleUrl = new URL('./request-body-intrinsics.ts', import.meta.url).href;

describe('request body carrier intrinsic closure', () => {
  it('pins URLSearchParams entry and serialization controls for guarded query input', () => {
    const submitted = new URLSearchParams([['token', 'attacker-submitted']]);
    const victim = new URLSearchParams([['token', 'victim-capability']]);
    const nativeAppend = URLSearchParams.prototype.append;
    const nativeEntries = URLSearchParams.prototype.entries;
    const nativeIterator = URLSearchParams.prototype[Symbol.iterator];
    const nativeToString = URLSearchParams.prototype.toString;
    const iteratorPrototype = Object.getPrototypeOf(
      Reflect.apply(nativeEntries, submitted, []),
    ) as { next: (...args: unknown[]) => IteratorResult<[string, string]> };
    const nativeNext = iteratorPrototype.next;
    let entries: readonly (readonly [string, string])[];
    let serialized: string;
    try {
      URLSearchParams.prototype.append = function poisonedAppend() {
        Reflect.apply(nativeAppend, this, ['token', 'victim-capability']);
      };
      URLSearchParams.prototype.entries = function poisonedEntries() {
        return Reflect.apply(nativeEntries, victim, []);
      };
      URLSearchParams.prototype[Symbol.iterator] = function poisonedIterator() {
        return Reflect.apply(nativeIterator, victim, []);
      };
      URLSearchParams.prototype.toString = () => 'token=victim-capability';
      iteratorPrototype.next = () => ({ done: true, value: undefined });

      entries = requestUrlSearchParamsEntries(submitted);
      serialized = requestSerializeUrlSearchParamsEntries(entries);
    } finally {
      iteratorPrototype.next = nativeNext;
      URLSearchParams.prototype.toString = nativeToString;
      URLSearchParams.prototype[Symbol.iterator] = nativeIterator;
      URLSearchParams.prototype.entries = nativeEntries;
      URLSearchParams.prototype.append = nativeAppend;
    }

    expect(entries).toEqual([['token', 'attacker-submitted']]);
    expect(serialized).toBe('token=attacker-submitted');
  });

  it('does not replace the submitted FormData token through a poisoned entries method', () => {
    const request = { sessionId: 'victim-session' };
    const csrf = {
      field: 'csrf',
      secret: 'test-csrf-secret-0123456789abcdef012345',
      sessionId(input: typeof request) {
        return input.sessionId;
      },
    };
    const victimToken = csrfToken(request, csrf);
    const forgedToken = 'v1.attacker.attacker';
    const victimForm = new FormData();
    victimForm.append('csrf', victimToken);
    const submittedForm = new FormData();
    submittedForm.append('csrf', forgedToken);
    const nativeEntries = FormData.prototype.entries;
    let carrierToken: unknown;
    let forgedAccepted = true;
    try {
      FormData.prototype.entries = function poisonedEntries() {
        return Reflect.apply(nativeEntries, this === submittedForm ? victimForm : this, []);
      };
      const tagged = tagUntrustedRequestValue(submittedForm);
      carrierToken = revealUntrustedRequestValue(
        formLikeToRecord(tagged).csrf,
        'request-carrier intrinsic proof',
      );
      forgedAccepted = validateCsrfToken(tagged, request, csrf);
    } finally {
      FormData.prototype.entries = nativeEntries;
    }

    expect(carrierToken).toBe(forgedToken);
    expect(forgedAccepted).toBe(false);
  });

  it('pins Request, FormData, JSON, decoder, content-type, and recursive carrier operations', async () => {
    await assertRequestBodyAsyncIntrinsics();
    const jsonBody = '{"csrf":"submitted","nested":[{"safe":true}]}';
    const requestInit = {
      body: jsonBody,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        cookie: 'sid=a%3Db; other=x',
        'x-carrier': 'submitted-header',
      },
      method: 'POST',
    };
    const jsonRequest = new Request('https://kovo.invalid/json', requestInit);
    const cloneRequest = new Request('https://kovo.invalid/json-clone', requestInit);
    const formRequest = new Request('https://kovo.invalid/form', {
      body: 'csrf=submitted&csrf=second',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      method: 'POST',
    });
    const directJsonRequest = new Request('https://kovo.invalid/direct', requestInit);
    const headerRequest = new Request('https://kovo.invalid/header', requestInit);
    const cookieRequest = new Request('https://kovo.invalid/cookie', requestInit);
    const victimForm = new FormData();
    victimForm.append('csrf', 'victim');
    const victimHeaders = new Headers({ 'content-type': 'text/plain', 'x-carrier': 'victim' });
    const victimBodyRequest = new Request('https://attacker.invalid/body', {
      body: '{"csrf":"victim"}',
      method: 'POST',
    });
    const nativeRequestClone = Request.prototype.clone;
    const nativeRequestJson = Request.prototype.json;
    const nativeRequestFormData = Request.prototype.formData;
    const nativeRequestHeaders = Object.getOwnPropertyDescriptor(Request.prototype, 'headers')!;
    const nativeRequestBody = Object.getOwnPropertyDescriptor(Request.prototype, 'body')!;
    const nativeHeadersEntries = Headers.prototype.entries;
    const nativeHeadersGet = Headers.prototype.get;
    const headersIteratorPrototype = Object.getPrototypeOf(
      Reflect.apply(nativeHeadersEntries, victimHeaders, []),
    ) as { next: (...args: unknown[]) => IteratorResult<[string, string]> };
    const nativeHeadersIteratorNext = headersIteratorPrototype.next;
    const nativeFormDataAppend = FormData.prototype.append;
    const nativeFormDataEntries = FormData.prototype.entries;
    const nativeFormDataGet = FormData.prototype.get;
    const nativeFormDataGetAll = FormData.prototype.getAll;
    const nativeFormDataValues = FormData.prototype.values;
    const iteratorPrototype = Object.getPrototypeOf(
      Reflect.apply(nativeFormDataEntries, victimForm, []),
    ) as { next: (...args: unknown[]) => IteratorResult<[string, FormDataEntryValue]> };
    const nativeIteratorNext = iteratorPrototype.next;
    const nativeJsonParse = JSON.parse;
    const nativeDecoderDecode = TextDecoder.prototype.decode;
    const nativeStreamGetReader = ReadableStream.prototype.getReader;
    const nativeStreamReaderRead = ReadableStreamDefaultReader.prototype.read;
    const nativeArrayIsArray = Array.isArray;
    const nativeArrayMap = Array.prototype.map;
    const nativeArrayPush = Array.prototype.push;
    const nativeArrayJoin = Array.prototype.join;
    const nativeObjectCreate = Object.create;
    const nativeObjectEntries = Object.entries;
    const nativeObjectGetPrototypeOf = Object.getPrototypeOf;
    const nativeStringIncludes = String.prototype.includes;
    const nativeStringCharCodeAt = String.prototype.charCodeAt;
    const nativeStringIndexOf = String.prototype.indexOf;
    const nativeStringReplaceAll = String.prototype.replaceAll;
    const nativeStringSlice = String.prototype.slice;
    const nativeStringSplit = String.prototype.split;
    const nativeStringToLowerCase = String.prototype.toLowerCase;
    const nativeStringTrim = String.prototype.trim;
    const nativeDecodeURIComponent = globalThis.decodeURIComponent;
    let directJson: unknown;
    let parsedJson: unknown;
    let clonedCarrier: unknown;
    let parsedForm: unknown;
    let parsedFormValues: unknown;
    let parsedBytes: unknown;
    let header: unknown;
    let cookie: unknown;
    let recursive: unknown;
    try {
      Request.prototype.clone = () =>
        new Request('https://attacker.invalid/', {
          body: '{"csrf":"victim"}',
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        });
      Request.prototype.json = async () => ({ csrf: 'victim' });
      Request.prototype.formData = async () => victimForm;
      Object.defineProperty(Request.prototype, 'headers', {
        configurable: true,
        get: () => new Headers({ 'content-type': 'text/plain', 'x-carrier': 'victim' }),
      });
      Object.defineProperty(Request.prototype, 'body', {
        configurable: true,
        get: () => Reflect.apply(nativeRequestBody.get!, victimBodyRequest, []),
      });
      Headers.prototype.entries = function poisonedEntries() {
        return Reflect.apply(nativeHeadersEntries, victimHeaders, []);
      };
      Headers.prototype.get = () => 'victim';
      headersIteratorPrototype.next = function poisonedNext() {
        return { done: true, value: undefined };
      };
      FormData.prototype.append = function poisonedAppend() {};
      FormData.prototype.entries = function poisonedEntries() {
        return Reflect.apply(nativeFormDataEntries, victimForm, []);
      };
      FormData.prototype.get = () => 'victim';
      FormData.prototype.getAll = () => ['victim'];
      FormData.prototype.values = function poisonedValues() {
        return Reflect.apply(nativeFormDataValues, victimForm, []);
      };
      iteratorPrototype.next = function poisonedNext() {
        return { done: true, value: undefined };
      };
      JSON.parse = () => ({ csrf: 'victim' });
      TextDecoder.prototype.decode = () => '{"csrf":"victim"}';
      ReadableStream.prototype.getReader = function poisonedGetReader() {
        return Reflect.apply(nativeStreamGetReader, victimBodyRequest.body!, []);
      };
      ReadableStreamDefaultReader.prototype.read = async () => ({
        done: true,
        value: undefined,
      });
      Array.isArray = () => false;
      Array.prototype.map = () => ['victim'];
      Array.prototype.push = function poisonedPush() {
        return this.length;
      };
      Array.prototype.join = () => 'victim';
      Object.create = (() => ({ csrf: 'victim' })) as typeof Object.create;
      Object.entries = () => [['csrf', 'victim']];
      Object.getPrototypeOf = () => Object.prototype;
      String.prototype.includes = () => false;
      String.prototype.charCodeAt = () => 0;
      String.prototype.indexOf = () => -1;
      String.prototype.replaceAll = () => 'victim';
      String.prototype.slice = () => 'victim';
      String.prototype.split = () => ['victim'];
      String.prototype.toLowerCase = () => 'text/plain';
      String.prototype.trim = () => 'victim';
      globalThis.decodeURIComponent = () => 'victim';

      directJson = await directJsonRequest.json();
      clonedCarrier = revealUntrustedRequestValue(
        await readCsrfCarrierFromRequest(cloneRequest),
        'request carrier test',
      );
      const jsonResult = await readUntrustedRequestBody(jsonRequest);
      parsedJson = jsonResult.ok
        ? revealUntrustedRequestValue(jsonResult.value, 'request carrier test')
        : jsonResult;
      const formResult = await readUntrustedRequestBody(formRequest);
      parsedFormValues = formResult.ok
        ? revealUntrustedRequestValue(
            (formResult.value as FormData).getAll('csrf'),
            'request carrier test',
          )
        : formResult;
      parsedForm = formResult.ok
        ? revealUntrustedRequestValue(formLikeToRecord(formResult.value), 'request carrier test')
        : formResult;
      const bytesResult = parseUntrustedJsonBodyBytes(new TextEncoder().encode(jsonBody));
      parsedBytes = bytesResult.ok
        ? revealUntrustedRequestValue(bytesResult.value, 'request carrier test')
        : bytesResult;
      header = revealUntrustedRequestValue(
        readUntrustedRequestHeader(headerRequest, 'x-carrier'),
        'request carrier test',
      );
      cookie = revealUntrustedRequestValue(
        readUntrustedCookieValue(cookieRequest, 'sid'),
        'request carrier test',
      );
      recursive = revealUntrustedRequestValue(
        tagUntrustedRequestValue({ nested: [{ csrf: 'submitted' }] }),
        'request carrier test',
      );
    } finally {
      Request.prototype.clone = nativeRequestClone;
      Request.prototype.json = nativeRequestJson;
      Request.prototype.formData = nativeRequestFormData;
      Object.defineProperty(Request.prototype, 'headers', nativeRequestHeaders);
      Object.defineProperty(Request.prototype, 'body', nativeRequestBody);
      Headers.prototype.entries = nativeHeadersEntries;
      Headers.prototype.get = nativeHeadersGet;
      headersIteratorPrototype.next = nativeHeadersIteratorNext;
      FormData.prototype.append = nativeFormDataAppend;
      FormData.prototype.entries = nativeFormDataEntries;
      FormData.prototype.get = nativeFormDataGet;
      FormData.prototype.getAll = nativeFormDataGetAll;
      FormData.prototype.values = nativeFormDataValues;
      iteratorPrototype.next = nativeIteratorNext;
      JSON.parse = nativeJsonParse;
      TextDecoder.prototype.decode = nativeDecoderDecode;
      ReadableStream.prototype.getReader = nativeStreamGetReader;
      ReadableStreamDefaultReader.prototype.read = nativeStreamReaderRead;
      Array.isArray = nativeArrayIsArray;
      Array.prototype.map = nativeArrayMap;
      Array.prototype.push = nativeArrayPush;
      Array.prototype.join = nativeArrayJoin;
      Object.create = nativeObjectCreate;
      Object.entries = nativeObjectEntries;
      Object.getPrototypeOf = nativeObjectGetPrototypeOf;
      String.prototype.includes = nativeStringIncludes;
      String.prototype.charCodeAt = nativeStringCharCodeAt;
      String.prototype.indexOf = nativeStringIndexOf;
      String.prototype.replaceAll = nativeStringReplaceAll;
      String.prototype.slice = nativeStringSlice;
      String.prototype.split = nativeStringSplit;
      String.prototype.toLowerCase = nativeStringToLowerCase;
      String.prototype.trim = nativeStringTrim;
      globalThis.decodeURIComponent = nativeDecodeURIComponent;
    }

    expect(directJson).toEqual({ csrf: 'victim' });
    expect(parsedJson).toEqual({ csrf: 'submitted', nested: [{ safe: true }] });
    expect(clonedCarrier).toEqual({ csrf: 'submitted', nested: [{ safe: true }] });
    expect(parsedFormValues).toEqual(['submitted', 'second']);
    expect(parsedForm).toEqual({ csrf: ['submitted', 'second'] });
    expect(parsedBytes).toEqual({ csrf: 'submitted', nested: [{ safe: true }] });
    expect(header).toBe('submitted-header');
    expect(cookie).toBe('a=b');
    expect(recursive).toEqual({ nested: [{ csrf: 'submitted' }] });
  });

  it('parses multipart boundaries, headers, filenames, and file bytes through pinned controls', async () => {
    await assertRequestBodyAsyncIntrinsics();
    const boundary = 'KovoBoundary0123456789abcdefgh';
    const fileBody = `prefix\r\n--${boundary}-not-a-delimiter\r\nsuffix`;
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="csrf"',
      '',
      'submitted',
      `--${boundary}`,
      'Content-Disposition: form-data; name="upload"; filename="safe;name.txt"',
      'Content-Type: text/plain; charset=utf-8',
      'X-Ignored-Control: safe',
      '',
      fileBody,
      `--${boundary}--`,
      '',
    ].join('\r\n');
    const request = new Request('https://kovo.invalid/upload', {
      body,
      headers: { 'content-type': `multipart/form-data; boundary="${boundary}"` },
      method: 'POST',
    });
    const victimRequest = new Request('https://attacker.invalid/upload', {
      body: 'victim',
      method: 'POST',
    });
    const nativeRequestBody = Object.getOwnPropertyDescriptor(Request.prototype, 'body')!;
    const nativeFormDataAppend = FormData.prototype.append;
    const nativeFormDataEntries = FormData.prototype.entries;
    const nativeFormDataGetAll = FormData.prototype.getAll;
    const nativeDecoderDecode = TextDecoder.prototype.decode;
    const nativeArrayIterator = Array.prototype[Symbol.iterator];
    const nativeArrayPush = Array.prototype.push;
    const nativeStringCharCodeAt = String.prototype.charCodeAt;
    const nativeStringIndexOf = String.prototype.indexOf;
    const nativeStringReplaceAll = String.prototype.replaceAll;
    const nativeStringSlice = String.prototype.slice;
    const nativeStringSplit = String.prototype.split;
    const nativeStringToLowerCase = String.prototype.toLowerCase;
    const nativeStringTrim = String.prototype.trim;
    let record: Record<string, unknown> | undefined;
    try {
      Object.defineProperty(Request.prototype, 'body', {
        configurable: true,
        get: () => Reflect.apply(nativeRequestBody.get!, victimRequest, []),
      });
      FormData.prototype.append = function poisonedAppend() {};
      FormData.prototype.entries = function poisonedEntries() {
        return Reflect.apply(nativeFormDataEntries, new FormData(), []);
      };
      FormData.prototype.getAll = () => ['victim'];
      TextDecoder.prototype.decode = () => 'victim';
      Array.prototype[Symbol.iterator] = function poisonedIterator() {
        if (this.length === 1 && (this[0] instanceof Uint8Array || this[0] instanceof Blob)) {
          let emitted = false;
          return {
            next(): IteratorResult<unknown> {
              if (emitted) return { done: true, value: undefined };
              emitted = true;
              return { done: false, value: 'victim' };
            },
            [Symbol.iterator]() {
              return this;
            },
          };
        }
        return Reflect.apply(nativeArrayIterator, this, []);
      };
      Array.prototype.push = function poisonedPush() {
        return this.length;
      };
      String.prototype.charCodeAt = () => 0;
      String.prototype.indexOf = () => -1;
      String.prototype.replaceAll = () => 'victim';
      String.prototype.slice = () => 'victim';
      String.prototype.split = () => ['victim'];
      String.prototype.toLowerCase = () => 'text/plain';
      String.prototype.trim = () => 'victim';

      const result = await readUntrustedRequestBody(request);
      if (result.ok) {
        record = revealUntrustedRequestValue(
          formLikeToRecord(result.value),
          'multipart intrinsic test',
        ) as Record<string, unknown>;
      }
    } finally {
      Object.defineProperty(Request.prototype, 'body', nativeRequestBody);
      FormData.prototype.append = nativeFormDataAppend;
      FormData.prototype.entries = nativeFormDataEntries;
      FormData.prototype.getAll = nativeFormDataGetAll;
      TextDecoder.prototype.decode = nativeDecoderDecode;
      Array.prototype[Symbol.iterator] = nativeArrayIterator;
      Array.prototype.push = nativeArrayPush;
      String.prototype.charCodeAt = nativeStringCharCodeAt;
      String.prototype.indexOf = nativeStringIndexOf;
      String.prototype.replaceAll = nativeStringReplaceAll;
      String.prototype.slice = nativeStringSlice;
      String.prototype.split = nativeStringSplit;
      String.prototype.toLowerCase = nativeStringToLowerCase;
      String.prototype.trim = nativeStringTrim;
    }

    expect(record?.csrf).toBe('submitted');
    expect(record?.upload).toBeInstanceOf(Blob);
    const upload = record?.upload as File;
    expect(upload.name).toBe('safe;name.txt');
    expect(upload.type).toBe('text/plain; charset=utf-8');
    await expect(upload.text()).resolves.toBe(fileBody);
  });

  it('fails closed on missing, duplicate, and mismatched multipart controls', async () => {
    const boundary = 'KovoBoundary0123456789abcdefgh';
    const missingBoundary = new Request('https://kovo.invalid/missing-boundary', {
      body: 'not-a-form',
      headers: { 'content-type': 'multipart/form-data' },
      method: 'POST',
    });
    const duplicateDisposition = new Request('https://kovo.invalid/duplicate-header', {
      body: [
        `--${boundary}`,
        'Content-Disposition: form-data; name="csrf"',
        'Content-Disposition: form-data; name="victim"',
        '',
        'submitted',
        `--${boundary}--`,
        '',
      ].join('\r\n'),
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      method: 'POST',
    });
    const mismatchedBoundary = new Request('https://kovo.invalid/mismatched-boundary', {
      body: '--attacker\r\nContent-Disposition: form-data; name="csrf"\r\n\r\nvictim\r\n--attacker--\r\n',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      method: 'POST',
    });

    await expect(readUntrustedRequestBody(missingBoundary)).resolves.toEqual({
      ok: false,
      reason: 'invalid-form',
    });
    await expect(readUntrustedRequestBody(duplicateDisposition)).resolves.toEqual({
      ok: false,
      reason: 'invalid-form',
    });
    await expect(readUntrustedRequestBody(mismatchedBoundary)).resolves.toEqual({
      ok: false,
      reason: 'invalid-form',
    });
  });

  it('fails closed when FormData controls are poisoned before framework import', async () => {
    const nativeEntries = FormData.prototype.entries;
    const victim = new FormData();
    victim.append('control', 'forged');
    let controls: typeof import('./request-body-intrinsics.js') | undefined;
    try {
      FormData.prototype.entries = function poisonedEntries() {
        return Reflect.apply(nativeEntries, victim, []);
      };
      controls = await import(`${intrinsicModuleUrl}?poisoned-form-data`);
    } finally {
      FormData.prototype.entries = nativeEntries;
    }
    expect(() => controls?.assertRequestBodyIntrinsics()).toThrow(/intrinsics were modified/);
  });

  it('fails closed when Headers controls are poisoned before framework import', async () => {
    const nativeEntries = Headers.prototype.entries;
    const victim = new Headers({ 'x-kovo': 'forged' });
    let controls: typeof import('./request-body-intrinsics.js') | undefined;
    try {
      Headers.prototype.entries = function poisonedEntries() {
        return Reflect.apply(nativeEntries, victim, []);
      };
      controls = await import(`${intrinsicModuleUrl}?poisoned-headers`);
    } finally {
      Headers.prototype.entries = nativeEntries;
    }
    expect(() => controls?.assertRequestBodyIntrinsics()).toThrow(/intrinsics were modified/);
  });

  it('fails closed when request body bytes are substituted before framework import', async () => {
    const nativeBody = Object.getOwnPropertyDescriptor(Request.prototype, 'body')!;
    const victim = new Request('https://attacker.invalid/', {
      body: 'victim',
      method: 'POST',
    });
    let controls: typeof import('./request-body-intrinsics.js') | undefined;
    try {
      Object.defineProperty(Request.prototype, 'body', {
        configurable: true,
        get: () => Reflect.apply(nativeBody.get!, victim, []),
      });
      controls = await import(`${intrinsicModuleUrl}?poisoned-request-body`);
      await expect(controls.assertRequestBodyAsyncIntrinsics()).rejects.toThrow(
        /intrinsics were modified/,
      );
    } finally {
      Object.defineProperty(Request.prototype, 'body', nativeBody);
    }
  });
});
