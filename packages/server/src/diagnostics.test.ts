import { secret } from '@kovojs/core';
import { describe, expect, it, vi } from 'vitest';

import { reportServerError } from './diagnostics.js';

describe('reportServerError secret lifecycle (SPEC §6.6 / DEC5)', () => {
  it('scrubs secret-tagged error and context values before app diagnostics hooks', () => {
    const onError = vi.fn();
    const error = new Error('provider failed');
    Object.defineProperty(error, 'token', {
      configurable: true,
      enumerable: true,
      value: secret('sk_live_q5_report_error'),
    });
    const request = { headers: { authorization: secret('bearer_q5_report_context') } };

    reportServerError(onError, error, {
      operation: 'route-page',
      request,
      url: 'https://app.test/account',
    });

    expect(onError).toHaveBeenCalledTimes(1);
    const [reportedError, context] = onError.mock.calls[0]!;
    expect(reportedError).toBeInstanceOf(Error);
    expect(reportedError).not.toBe(error);
    expect((reportedError as Error & { token?: unknown }).token).toBe('[secret]');
    expect(context).toMatchObject({
      operation: 'route-page',
      request: { headers: { authorization: '[secret]' } },
    });
    expect(JSON.stringify(onError.mock.calls)).not.toContain('sk_live_q5_report');
  });

  it('preserves ordinary error and context identity when no secret tags are present', () => {
    const onError = vi.fn();
    const error = new Error('ordinary failure');
    const request = { id: 'req_1' };
    const context = {
      operation: 'route-page' as const,
      request,
      url: '/account',
    };

    reportServerError(onError, error, context);

    expect(onError).toHaveBeenCalledWith(error, context);
  });

  it('removes every request query value from onError context, Request views, and error text', () => {
    const token = 'CAPABILITY_BEARER_SHOULD_NEVER_LOG';
    const referrerToken = 'REFERRER_BEARER_SHOULD_NEVER_LOG';
    const headerToken = 'REFERER_HEADER_SHOULD_NEVER_LOG';
    const originalUrlToken = 'ORIGINAL_URL_SHOULD_NEVER_LOG';
    const accessKey = 'ACCESS_KEY_SHOULD_NEVER_LOG';
    const request = new Request(
      `https://app.test/_kovo/storage/a?kovo-cap=${token}&State=oauth&state=duplicate`,
      {
        headers: {
          Authorization: 'Bearer diagnostic-secret',
          Cookie: 'sid=victim',
          Referer: `https://idp.test/callback?code=${headerToken}&state=oauth`,
          'X-Access-Key': accessKey,
          'X-Original-URL': `/internal?credential=${originalUrlToken}`,
        },
        referrer: `https://app.test/reset?token=${referrerToken}&next=account`,
      },
    );
    Object.defineProperty(request, 'rawCapture', {
      configurable: true,
      get(this: Request) {
        return this.url;
      },
    });
    const error = new Error(
      `storage failed while reading ${request.url} from ${request.referrer} via ${request.headers.get('referer')} isolated=${token} original=${originalUrlToken} access=${accessKey}`,
    );
    error.name = `StorageError ${request.url}`;
    Object.defineProperty(error, 'requestUrl', {
      configurable: true,
      enumerable: true,
      value: request.url,
    });
    let overriddenRequestGetterReads = 0;
    Object.defineProperties(request, {
      signal: {
        configurable: true,
        get() {
          overriddenRequestGetterReads += 1;
          throw new Error('untrusted signal getter must not run');
        },
      },
      url: {
        configurable: true,
        get() {
          overriddenRequestGetterReads += 1;
          return 'https://attacker.invalid/?token=GETTER_SECRET';
        },
      },
    });
    const onError = vi.fn();

    reportServerError(onError, error, {
      operation: 'app-request',
      request,
      url: `/_kovo/storage/a?kovo-cap=${token}&State=oauth&state=duplicate`,
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(overriddenRequestGetterReads).toBe(0);
    const [reportedError, context] = onError.mock.calls[0]!;
    expect(context.url).toBe('/_kovo/storage/a?kovo-cap&State&state');
    expect(context.request).toBeInstanceOf(Request);
    expect(context.request).not.toBe(request);
    expect(context.request.url).toBe('https://app.test/_kovo/storage/a?kovo-cap&State&state');
    expect(context.request.clone().url).toBe(
      'https://app.test/_kovo/storage/a?kovo-cap&State&state',
    );
    expect(context.request.referrer).toBe('https://app.test/reset?token&next');
    expect(context.request.headers.get('referer')).toBeNull();
    expect(context.request.headers.get('x-original-url')).toBeNull();
    expect(context.request.headers.get('cookie')).toBeNull();
    expect(context.request.headers.get('authorization')).toBeNull();
    expect(context.request.body).toBeNull();
    expect(context.request.clone().body).toBeNull();
    expect('rawCapture' in context.request).toBe(false);
    Object.defineProperty(context.request, 'capture', {
      configurable: true,
      get(this: Request) {
        return this.url;
      },
    });
    Object.defineProperty(context.request, 'captureMethod', {
      configurable: true,
      value(this: Request) {
        return this.url;
      },
    });
    expect(Reflect.get(context.request, 'capture')).toBe(
      'https://app.test/_kovo/storage/a?kovo-cap&State&state',
    );
    expect((context.request as Request & { captureMethod(): string }).captureMethod()).toBe(
      'https://app.test/_kovo/storage/a?kovo-cap&State&state',
    );
    const prototype = Object.create(Request.prototype, {
      prototypeCapture: {
        configurable: true,
        get(this: Request) {
          return this.url;
        },
      },
    });
    Object.setPrototypeOf(context.request, prototype);
    expect(Reflect.get(context.request, 'prototypeCapture')).toBe(
      'https://app.test/_kovo/storage/a?kovo-cap&State&state',
    );
    expect(reportedError).toBeInstanceOf(Error);
    expect((reportedError as Error).message).toContain('/_kovo/storage/a?kovo-cap&State&state');
    expect((reportedError as Error).name).toContain('/_kovo/storage/a?kovo-cap&State&state');
    expect((reportedError as Error & { requestUrl?: string }).requestUrl).toBe(
      '/_kovo/storage/a?kovo-cap&State&state',
    );
    expect(JSON.stringify(onError.mock.calls)).not.toContain(token);
    expect(JSON.stringify(onError.mock.calls)).not.toContain(referrerToken);
    expect(JSON.stringify(onError.mock.calls)).not.toContain(headerToken);
    expect(JSON.stringify(onError.mock.calls)).not.toContain(originalUrlToken);
    expect(JSON.stringify(onError.mock.calls)).not.toContain(accessKey);
    expect(String((reportedError as Error).stack)).not.toContain(token);
  });

  it('redacts decoded and raw standalone query values and neutralizes abort reasons', () => {
    const decoded = 'capability/secret';
    const raw = 'capability%2Fsecret';
    const abort = new AbortController();
    const abortSecret = { token: 'ABORT_REASON_SECRET' };
    abort.abort(abortSecret);
    const request = new Request(`https://app.test/download?kovo-cap=${raw}`, {
      signal: abort.signal,
    });
    const onError = vi.fn();

    reportServerError(onError, new Error(`decoded=${decoded} raw=${raw}`), {
      operation: 'app-request',
      request,
    });

    const [error, context] = onError.mock.calls[0]!;
    expect((error as Error).message).toBe('decoded=[redacted] raw=[redacted]');
    expect(context.request.signal.aborted).toBe(true);
    expect(context.request.signal.reason).not.toBe(abortSecret);
    expect(String(context.request.signal.reason)).not.toContain('ABORT_REASON_SECRET');
    expect(JSON.stringify(onError.mock.calls)).not.toContain(decoded);
    expect(JSON.stringify(onError.mock.calls)).not.toContain(raw);
  });

  it('mirrors later diagnostic cancellation without copying its reason', () => {
    const abort = new AbortController();
    const request = new Request('https://app.test/clean', { signal: abort.signal });
    const onError = vi.fn();

    reportServerError(onError, new Error('failed'), {
      operation: 'app-request',
      request,
    });
    const diagnosticRequest = onError.mock.calls[0]?.[1].request as Request;
    const secret = { token: 'LATE_DIAGNOSTIC_ABORT_SECRET' };
    expect(diagnosticRequest.signal.aborted).toBe(false);

    abort.abort(secret);

    expect(diagnosticRequest.signal.aborted).toBe(true);
    expect(diagnosticRequest.signal.reason).not.toBe(secret);
    expect(String(diagnosticRequest.signal.reason)).not.toContain(secret.token);
  });

  it('sanitizes a secret referrer even when the request URL itself is clean', () => {
    const token = 'CLEAN_URL_REFERRER_SECRET';
    const request = new Request('https://app.test/clean', {
      referrer: `https://idp.test/reset?token=${token}`,
    });
    const onError = vi.fn();

    reportServerError(onError, new Error(`failed from ${request.referrer}`), {
      operation: 'app-request',
      request,
    });

    const [error, context] = onError.mock.calls[0]!;
    expect(context.request).not.toBe(request);
    expect(context.request.referrer).toBe('https://idp.test/reset?token');
    expect((error as Error).message).toBe('failed from /reset?token');
    expect(JSON.stringify(onError.mock.calls)).not.toContain(token);
  });

  it('removes credential-bearing absolute header URLs from onError and stderr text', () => {
    const password = 'DIAGNOSTIC_URL_PASSWORD_MUST_NOT_SURVIVE';
    const upstream = `https://diagnostic-user:${password}@idp.example/callback`;
    const request = new Request('https://app.test/fail', {
      headers: { 'X-Callback-URL': upstream },
    });
    const error = new Error(`callback failed at ${upstream}`);
    const onError = vi.fn();
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      reportServerError(onError, error, { operation: 'app-request', request });
      reportServerError(undefined, error, { operation: 'app-request', request });

      expect(onError).toHaveBeenCalledTimes(1);
      expect((onError.mock.calls[0]?.[0] as Error).message).toBe('callback failed at /callback');
      expect(JSON.stringify(onError.mock.calls)).not.toContain(password);
      expect(JSON.stringify(stderr.mock.calls)).not.toContain(password);
      expect(String(stderr.mock.calls[0]?.[1])).toContain('/callback');
    } finally {
      stderr.mockRestore();
    }
  });

  it('descriptor-walks nested diagnostic carriers without invoking app accessors', () => {
    const cookieSecret = 'COOKIE VALUE/QUOTED';
    const sessionSecret = 'SESSION_ID_NESTED_SECRET';
    const apiKeySecret = 'API_KEY_V2_NESTED_SECRET';
    const basicUser = 'diagnostic-user';
    const basicPassword = 'BASIC_PASSWORD_NESTED_SECRET';
    const basic = btoa(`${basicUser}:${basicPassword}`);
    const request = new Request('https://app.test/fail?credentialId=query-secret', {
      headers: {
        Authorization: `Basic ${basic}`,
        Cookie: `sid="${encodeURIComponent(cookieSecret)}"`,
        'X-Api-Key-V2': apiKeySecret,
        'X-Session-Id': sessionSecret,
      },
    });
    let getterReads = 0;
    const nested = {
      headers: request.headers,
      map: new Map([['secret', sessionSecret]]),
      request,
      set: new Set([apiKeySecret]),
      url: new URL(`https://app.test/private?sessionId=${sessionSecret}`),
    } as Record<string, unknown>;
    Object.defineProperty(nested, 'getter', {
      enumerable: true,
      get() {
        getterReads += 1;
        return cookieSecret;
      },
    });
    const error = new Error(
      `cookie=${cookieSecret} session=${sessionSecret} key=${apiKeySecret} user=${basicUser} password=${basicPassword} basic=${basic}`,
    );
    Object.defineProperty(error, `credential-${sessionSecret}`, {
      configurable: true,
      enumerable: true,
      value: nested,
    });
    Object.defineProperty(error, Symbol(sessionSecret), {
      configurable: true,
      enumerable: true,
      value: apiKeySecret,
    });
    const onError = vi.fn();

    reportServerError(onError, error, { operation: 'app-request', request });

    expect(getterReads).toBe(0);
    const [reported] = onError.mock.calls[0]!;
    const keys = Reflect.ownKeys(reported as object);
    expect(keys.some((key) => typeof key === 'symbol')).toBe(false);
    expect(keys).toContain('credential-[redacted]');
    const safeNested = (reported as unknown as Record<string, unknown>)[
      'credential-[redacted]'
    ] as Record<string, unknown>;
    expect(safeNested.getter).toBe('[redacted]');
    expect(safeNested.headers).toBeInstanceOf(Headers);
    expect([...(safeNested.headers as Headers).entries()]).toEqual([]);
    expect(safeNested.map).toBe('[redacted]');
    expect(safeNested.set).toBe('[redacted]');
    expect(safeNested.url).toBe('[redacted]');
    expect((safeNested.request as Request).headers.get('cookie')).toBeNull();
    const serialized = JSON.stringify(onError.mock.calls);
    for (const secretValue of [
      cookieSecret,
      encodeURIComponent(cookieSecret),
      sessionSecret,
      apiKeySecret,
      basic,
      basicUser,
      basicPassword,
    ]) {
      expect(serialized).not.toContain(secretValue);
      expect((reported as Error).message).not.toContain(secretValue);
    }
  });

  it('keeps request secrets and nested Secret branches closed after late realm poisoning', () => {
    const basicUser = 'poisoned-diagnostic-user';
    const basicPassword = 'POISONED_BASIC_PASSWORD';
    const cookieSecret = 'POISONED_COOKIE_SECRET';
    const taggedSecret = secret('POISONED_TAGGED_SECRET');
    const basic = btoa(`${basicUser}:${basicPassword}`);
    const request = new Request('https://app.test/fail?token=POISONED_QUERY_SECRET', {
      headers: {
        Authorization: `Basic ${basic}`,
        Cookie: `sid=${cookieSecret}`,
      },
    });
    let accessorReads = 0;
    const nested: Record<string, unknown> = { tagged: [taggedSecret] };
    Object.defineProperty(nested, 'accessor', {
      enumerable: true,
      get() {
        accessorReads += 1;
        return cookieSecret;
      },
    });
    const error = new Error(
      `user=${basicUser} password=${basicPassword} cookie=${cookieSecret} basic=${basic}`,
    );
    Object.defineProperty(error, 'nested', { enumerable: true, value: nested });
    const onError = vi.fn();

    const originalArrayIsArray = Array.isArray;
    const originalArraySome = Array.prototype.some;
    const originalArraySort = Array.prototype.sort;
    const originalMapGet = Map.prototype.get;
    const originalSetHas = Set.prototype.has;
    const originalWeakMapGet = WeakMap.prototype.get;
    const originalWeakMapSet = WeakMap.prototype.set;
    const originalObjectDefineProperty = Object.defineProperty;
    const originalObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
    const originalObjectGetPrototypeOf = Object.getPrototypeOf;
    const originalReflectOwnKeys = Reflect.ownKeys;
    const originalExec = RegExp.prototype.exec;
    const originalEndsWith = String.prototype.endsWith;
    const originalIncludes = String.prototype.includes;
    const originalReplaceAll = String.prototype.replaceAll;
    try {
      Array.isArray = () => false;
      Array.prototype.some = () => false;
      Array.prototype.sort = function () {
        return this;
      };
      Map.prototype.get = () => undefined;
      Set.prototype.has = () => false;
      WeakMap.prototype.get = () => undefined;
      WeakMap.prototype.set = function () {
        return this;
      };
      Object.defineProperty = ((value: object) => value) as typeof Object.defineProperty;
      Object.getOwnPropertyDescriptor = () => undefined;
      Object.getPrototypeOf = () => null;
      Reflect.ownKeys = () => [];
      RegExp.prototype.exec = () => null;
      String.prototype.endsWith = () => false;
      String.prototype.includes = () => false;
      String.prototype.replaceAll = function () {
        return this.valueOf();
      };

      reportServerError(onError, error, { operation: 'app-request', request });
    } finally {
      Array.isArray = originalArrayIsArray;
      Array.prototype.some = originalArraySome;
      Array.prototype.sort = originalArraySort;
      Map.prototype.get = originalMapGet;
      Set.prototype.has = originalSetHas;
      WeakMap.prototype.get = originalWeakMapGet;
      WeakMap.prototype.set = originalWeakMapSet;
      Object.defineProperty = originalObjectDefineProperty;
      Object.getOwnPropertyDescriptor = originalObjectGetOwnPropertyDescriptor;
      Object.getPrototypeOf = originalObjectGetPrototypeOf;
      Reflect.ownKeys = originalReflectOwnKeys;
      RegExp.prototype.exec = originalExec;
      String.prototype.endsWith = originalEndsWith;
      String.prototype.includes = originalIncludes;
      String.prototype.replaceAll = originalReplaceAll;
    }

    expect(accessorReads).toBe(0);
    expect(onError).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(onError.mock.calls);
    for (const value of [basic, basicUser, basicPassword, cookieSecret, 'POISONED_TAGGED_SECRET']) {
      expect(serialized).not.toContain(value);
    }
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe(
      'user=[redacted] password=[redacted] cookie=[redacted] basic=[redacted]',
    );
  });

  it('uses import-time Web constructors when app code replaces global Request', () => {
    const NativeRequest = Request;
    const NativeAbortController = AbortController;
    const abortConstructorCalls: string[] = [];
    const requestConstructorInputs: unknown[] = [];
    class CapturingRequest extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        requestConstructorInputs.push(input, init);
        super(input, init);
      }
    }
    class CapturingAbortController extends NativeAbortController {
      constructor() {
        abortConstructorCalls.push('AbortController');
        super();
      }
    }
    const request = new NativeRequest('https://app.test/fail?token=CONSTRUCTOR_SECRET', {
      headers: { Cookie: 'sid=CONSTRUCTOR_COOKIE_SECRET' },
    });
    const onError = vi.fn();

    globalThis.Request = CapturingRequest as typeof Request;
    globalThis.AbortController = CapturingAbortController as typeof AbortController;
    try {
      reportServerError(onError, new Error(`failed at ${request.url}`), {
        operation: 'app-request',
        request,
      });
    } finally {
      globalThis.Request = NativeRequest;
      globalThis.AbortController = NativeAbortController;
    }

    expect(requestConstructorInputs).toEqual([]);
    expect(abortConstructorCalls.length).toBeGreaterThan(0);
    const [reportedError, context] = onError.mock.calls[0]!;
    expect(context.request).toBeInstanceOf(NativeRequest);
    expect(context.request.url).toBe('https://app.test/fail?token');
    expect(context.request.headers.get('cookie')).toBeNull();
    expect((reportedError as Error).message).not.toContain('CONSTRUCTOR_SECRET');
  });

  it('uses the captured Error brand and constructor after app code poisons global Error', () => {
    const NativeError = Error;
    const error = new NativeError('ordinary captured error');
    const onError = vi.fn();
    class PoisonError {
      static [Symbol.hasInstance](): boolean {
        throw new NativeError('error hasInstance trap');
      }

      constructor() {
        throw new NativeError('error constructor trap');
      }
    }

    let thrown: unknown;
    globalThis.Error = PoisonError as unknown as ErrorConstructor;
    try {
      reportServerError(onError, error, { operation: 'app-request', url: '/safe' });
    } catch (caught) {
      thrown = caught;
    } finally {
      globalThis.Error = NativeError;
    }

    expect(thrown).toBeUndefined();
    expect(onError).toHaveBeenCalledWith(error, {
      operation: 'app-request',
      url: '/safe',
    });
  });

  it('applies the same URL sanitization before default stderr', () => {
    const token = 'RESET_BEARER_SHOULD_NEVER_LOG';
    const url = `/reset?Token=${token}&token=duplicate`;
    const error = new Error(`reset provider failed at ${url}`);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      reportServerError(undefined, error, { operation: 'app-request', url });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(token);
      expect(errorSpy.mock.calls[0]?.[0]).toContain('url=/reset?Token&token');
      expect(String(errorSpy.mock.calls[0]?.[1])).toContain('/reset?Token&token');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('neutralizes control characters at the default stderr sink', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      reportServerError(undefined, new Error('failed\nFORGED\u001b[31m'), {
        mutationKey: 'save\rFORGED-METADATA',
        operation: 'mutation-handler',
      });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const output = errorSpy.mock.calls[0]!.map(String).join(' ');
      expect(output).not.toMatch(/[\n\r\u001b]/u);
      expect(output).toContain('\\u000aFORGED');
      expect(output).toContain('\\u000dFORGED-METADATA');
      expect(output).toContain('\\u001b[31m');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
