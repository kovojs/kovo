import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { runMutation } from './mutation.js';
import { assertRequestBodyAsyncIntrinsics } from './request-body-intrinsics.js';
import { unsafeRegex } from './redos.js';
import { assertShapeWithinBudget, s } from './schema.js';
import { testMutation as mutation } from './test-fixtures.js';
import { sanitizeDownloadFilename, sniffUploadBytes } from './upload-sniff.js';

const responseIntrinsicsUrl = new URL('./response-security-intrinsics.ts', import.meta.url).href;
const uploadSniffUrl = new URL('./upload-sniff.ts', import.meta.url).href;

describe('schema security intrinsic closure', () => {
  it('does not skip a closed string validator and let invalid input reach the handler', async () => {
    let handlerReached = false;
    const updateAccount = mutation('account/update-email', {
      input: s.object({ email: s.string().email() }),
      handler(input) {
        handlerReached = true;
        return input.email;
      },
    });
    const nativeIterator = Array.prototype[Symbol.iterator];
    let result: Awaited<ReturnType<typeof runMutation>>;
    try {
      Array.prototype[Symbol.iterator] = function poisonedIterator() {
        const first = this[0] as { kind?: unknown } | undefined;
        if (this.length === 1 && first?.kind === 'format') {
          return {
            next: () => ({ done: true, value: undefined }),
            [Symbol.iterator]() {
              return this;
            },
          };
        }
        return Reflect.apply(nativeIterator, this, []);
      };
      result = await runMutation(updateAccount, { email: 'not-an-email' }, {});
    } finally {
      Array.prototype[Symbol.iterator] = nativeIterator;
    }

    expect(handlerReached).toBe(false);
    expect(result!).toMatchObject({ error: { code: 'VALIDATION' }, ok: false, status: 422 });
  });

  it('pins scalar, regex, date, file, shape, and validation-error controls after late poison', async () => {
    await assertRequestBodyAsyncIntrinsics();
    const email = s.string().email();
    const pattern = s.string().pattern('^safe$');
    const audited = s.string().matches(unsafeRegex(/^safe$/u, 'schema intrinsic test'));
    const controlled = s.string();
    const decimal = s.decimal({ scale: 2 });
    const date = s.date();
    const integer = s.number().int();
    const boolean = s.boolean();
    const json = s.json();
    const oversizedSchema = s.file({ maxBytes: 2 });
    const imageSchema = s.file().accept(['image/png']);
    const oversized = new File(['large'], 'large.txt', { type: 'text/plain' });
    const lyingHtml = new File(['<html><script>bad()</script></html>'], 'avatar.png', {
      type: 'image/png',
    });
    const polyglot = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74,
      0x3e,
    ]);
    const nestedMutation = mutation('schema/nested', {
      input: s.object({ values: s.array(s.number().int().min(1)) }),
      handler(input) {
        return input;
      },
    });
    const deep = { first: { second: { third: true } } };

    const nativeArrayIterator = Array.prototype[Symbol.iterator];
    const nativeArrayJoin = Array.prototype.join;
    const nativeArrayPop = Array.prototype.pop;
    const nativeArrayPush = Array.prototype.push;
    const nativeBlobArrayBuffer = Blob.prototype.arrayBuffer;
    const nativeBlobSize = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!;
    const nativeBlobType = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')!;
    const nativeFileName = Object.getOwnPropertyDescriptor(File.prototype, 'name')!;
    const nativeDateGetTime = Date.prototype.getTime;
    const nativeDateToISOString = Date.prototype.toISOString;
    const nativeDecoderDecode = TextDecoder.prototype.decode;
    const nativeJsonParse = JSON.parse;
    const nativeNumberIsFinite = Number.isFinite;
    const nativeNumberIsInteger = Number.isInteger;
    const nativeNumberIsNaN = Number.isNaN;
    const nativeRegExpTest = RegExp.prototype.test;
    const nativeStringCharCodeAt = String.prototype.charCodeAt;
    const nativeStringEndsWith = String.prototype.endsWith;
    const nativeStringFromCharCode = String.fromCharCode;
    const nativeStringIncludes = String.prototype.includes;
    const nativeStringIndexOf = String.prototype.indexOf;
    const nativeStringLastIndexOf = String.prototype.lastIndexOf;
    const nativeStringReplaceAll = String.prototype.replaceAll;
    const nativeStringSlice = String.prototype.slice;
    const nativeStringSplit = String.prototype.split;
    const nativeStringStartsWith = String.prototype.startsWith;
    const nativeStringToLowerCase = String.prototype.toLowerCase;
    const nativeStringTrim = String.prototype.trim;
    const nativeUint8Iterator = Uint8Array.prototype[Symbol.iterator];
    const nativeUint8Fill = Uint8Array.prototype.fill;
    const nativeUint8Slice = Uint8Array.prototype.slice;

    let acceptedEmail = true;
    let acceptedPattern = true;
    let acceptedAudited = true;
    let acceptedControl = true;
    let acceptedDecimal = true;
    let acceptedDate = true;
    let acceptedInteger = true;
    let acceptedBoolean = true;
    let acceptedJson = true;
    let acceptedLateConstructedPattern = true;
    let acceptedOversized = true;
    let acceptedLyingFile = true;
    let acceptedDeepShape = true;
    let sniffed: ReturnType<typeof sniffUploadBytes> | undefined;
    let sanitized = '';
    let nestedResult: Awaited<ReturnType<typeof runMutation>> | undefined;
    try {
      Array.prototype[Symbol.iterator] = function poisonedIterator() {
        const first = this[0] as { kind?: unknown } | number | string | undefined;
        if (
          typeof first === 'number' ||
          typeof first === 'string' ||
          (typeof first === 'object' && first !== null && 'kind' in first)
        ) {
          return {
            next: () => ({ done: true, value: undefined }),
            [Symbol.iterator]() {
              return this;
            },
          };
        }
        return Reflect.apply(nativeArrayIterator, this, []);
      };
      Array.prototype.join = () => 'victim/type';
      Array.prototype.pop = function poisonedPop() {
        const first = this[0];
        return typeof first === 'number' || Array.isArray(first)
          ? undefined
          : Reflect.apply(nativeArrayPop, this, []);
      };
      Array.prototype.push = function poisonedPush(...values: unknown[]) {
        const first = values[0];
        if (typeof first === 'number' || Array.isArray(first)) return this.length;
        return Reflect.apply(nativeArrayPush, this, values);
      };
      Blob.prototype.arrayBuffer = async () => new TextEncoder().encode('fake png').buffer;
      Object.defineProperty(Blob.prototype, 'size', { configurable: true, get: () => 0 });
      Object.defineProperty(Blob.prototype, 'type', {
        configurable: true,
        get: () => 'image/png',
      });
      Object.defineProperty(File.prototype, 'name', {
        configurable: true,
        get: () => 'victim.png',
      });
      Date.prototype.getTime = () => 0;
      Date.prototype.toISOString = () => '2026-02-30T00:00:00.000Z';
      TextDecoder.prototype.decode = () => 'safe';
      JSON.parse = () => ({ safe: true });
      Number.isFinite = () => true;
      Number.isInteger = () => true;
      Number.isNaN = () => false;
      RegExp.prototype.test = () => true;
      String.prototype.charCodeAt = () => 0x61;
      String.prototype.endsWith = () => false;
      String.fromCharCode = () => 'x';
      String.prototype.includes = () => false;
      String.prototype.indexOf = () => 1;
      String.prototype.lastIndexOf = () => 1;
      String.prototype.replaceAll = () => 'safe';
      String.prototype.slice = () => 'safe';
      String.prototype.split = () => ['safe'];
      String.prototype.startsWith = () => true;
      String.prototype.toLowerCase = () => 'true';
      String.prototype.trim = () => '1.00';
      Uint8Array.prototype[Symbol.iterator] = function poisonedIterator() {
        return {
          next: () => ({ done: true, value: undefined }),
          [Symbol.iterator]() {
            return this;
          },
        };
      };
      Uint8Array.prototype.fill = function poisonedFill() {
        return this;
      };
      Uint8Array.prototype.slice = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

      acceptedEmail = accepts(() => email.parse('not-an-email'));
      acceptedPattern = accepts(() => pattern.parse('unsafe'));
      acceptedAudited = accepts(() => audited.parse('unsafe'));
      acceptedControl = accepts(() => controlled.parse('\u0000'));
      acceptedDecimal = accepts(() => decimal.parse('not-decimal'));
      acceptedDate = accepts(() => date.parse('2026-02-30'));
      acceptedInteger = accepts(() => integer.parse('1.5'));
      acceptedBoolean = accepts(() => boolean.parse('maybe'));
      acceptedJson = accepts(() => json.parse('{broken'));
      acceptedLateConstructedPattern = accepts(() => s.string().pattern('^safe$').parse('unsafe'));
      acceptedOversized = accepts(() => oversizedSchema.parse(oversized));
      acceptedLyingFile = await acceptsAsync(() => imageSchema.parseAsync(lyingHtml));
      acceptedDeepShape = accepts(() =>
        assertShapeWithinBudget(deep, { maxBreadth: 10, maxDepth: 1, maxNodes: 10 }),
      );
      sniffed = sniffUploadBytes(polyglot);
      sanitized = sanitizeDownloadFilename('../../evil\r\n"x');
      nestedResult = await runMutation(nestedMutation, { values: [0] }, {});
    } finally {
      Array.prototype[Symbol.iterator] = nativeArrayIterator;
      Array.prototype.join = nativeArrayJoin;
      Array.prototype.pop = nativeArrayPop;
      Array.prototype.push = nativeArrayPush;
      Blob.prototype.arrayBuffer = nativeBlobArrayBuffer;
      Object.defineProperty(Blob.prototype, 'size', nativeBlobSize);
      Object.defineProperty(Blob.prototype, 'type', nativeBlobType);
      Object.defineProperty(File.prototype, 'name', nativeFileName);
      Date.prototype.getTime = nativeDateGetTime;
      Date.prototype.toISOString = nativeDateToISOString;
      TextDecoder.prototype.decode = nativeDecoderDecode;
      JSON.parse = nativeJsonParse;
      Number.isFinite = nativeNumberIsFinite;
      Number.isInteger = nativeNumberIsInteger;
      Number.isNaN = nativeNumberIsNaN;
      RegExp.prototype.test = nativeRegExpTest;
      String.prototype.charCodeAt = nativeStringCharCodeAt;
      String.prototype.endsWith = nativeStringEndsWith;
      String.fromCharCode = nativeStringFromCharCode;
      String.prototype.includes = nativeStringIncludes;
      String.prototype.indexOf = nativeStringIndexOf;
      String.prototype.lastIndexOf = nativeStringLastIndexOf;
      String.prototype.replaceAll = nativeStringReplaceAll;
      String.prototype.slice = nativeStringSlice;
      String.prototype.split = nativeStringSplit;
      String.prototype.startsWith = nativeStringStartsWith;
      String.prototype.toLowerCase = nativeStringToLowerCase;
      String.prototype.trim = nativeStringTrim;
      Uint8Array.prototype[Symbol.iterator] = nativeUint8Iterator;
      Uint8Array.prototype.fill = nativeUint8Fill;
      Uint8Array.prototype.slice = nativeUint8Slice;
    }

    expect({
      acceptedAudited,
      acceptedBoolean,
      acceptedControl,
      acceptedDate,
      acceptedDecimal,
      acceptedDeepShape,
      acceptedEmail,
      acceptedInteger,
      acceptedJson,
      acceptedLateConstructedPattern,
      acceptedLyingFile,
      acceptedOversized,
      acceptedPattern,
    }).toEqual({
      acceptedAudited: false,
      acceptedBoolean: false,
      acceptedControl: false,
      acceptedDate: false,
      acceptedDecimal: false,
      acceptedDeepShape: false,
      acceptedEmail: false,
      acceptedInteger: false,
      acceptedJson: false,
      acceptedLateConstructedPattern: false,
      acceptedLyingFile: false,
      acceptedOversized: false,
      acceptedPattern: false,
    });
    expect(sniffed).toEqual({ contentType: 'image/png', inlineSafe: false });
    expect(sanitized).toBe('evilx');
    expect(nestedResult).toMatchObject({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected number >= 1', path: ['values', '0'] }] },
      },
      ok: false,
      status: 422,
    });
  });

  it('keeps active-content sniffing safe after prototype poison', async () => {
    const bytes = new TextEncoder().encode('<html><script>bad()</script></html>');
    const sniff = await import(`${uploadSniffUrl}?active-content-late-poison`);
    const nativeRegExpTest = RegExp.prototype.test;
    const nativeIncludes = String.prototype.includes;
    let result: ReturnType<typeof sniffUploadBytes> | undefined;
    try {
      RegExp.prototype.test = () => false;
      String.prototype.includes = () => false;
      result = sniff.sniffUploadBytes(bytes);
    } finally {
      RegExp.prototype.test = nativeRegExpTest;
      String.prototype.includes = nativeIncludes;
    }
    expect(result).toEqual({ contentType: 'application/octet-stream', inlineSafe: false });
  });

  it('fails closed when a schema scalar control is poisoned before framework initialization', async () => {
    const nativeCharCodeAt = String.prototype.charCodeAt;
    let controls: typeof import('./response-security-intrinsics.js') | undefined;
    try {
      String.prototype.charCodeAt = () => 0x61;
      controls = await import(`${responseIntrinsicsUrl}?poisoned-schema-char-code`);
    } finally {
      String.prototype.charCodeAt = nativeCharCodeAt;
    }
    expect(() => controls?.assertResponseSecurityIntrinsics()).toThrow(/intrinsics were modified/);
  });

  it('fails closed when active-content RegExp control is poisoned before framework initialization', () => {
    const script = `
      const nativeExec = RegExp.prototype.exec;
      RegExp.prototype.exec = () => null;
      const controls = await import(${JSON.stringify(`${responseIntrinsicsUrl}?poisoned-upload-regexp`)});
      RegExp.prototype.exec = nativeExec;
      try {
        controls.assertResponseSecurityIntrinsics();
      } catch (error) {
        if (String(error).includes('intrinsics were modified')) process.exit(0);
      }
      process.exit(3);
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
    });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});

function accepts(operation: () => unknown): boolean {
  try {
    operation();
    return true;
  } catch {
    return false;
  }
}

async function acceptsAsync(operation: () => Promise<unknown>): Promise<boolean> {
  try {
    await operation();
    return true;
  } catch {
    return false;
  }
}
