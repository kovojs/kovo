import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import {
  kovoSecurityReportResponse,
  kovoSecurityReportSnapshot,
} from './reporting.js';

const endpoint = 'https://example.test/_kovo/reports/csp';
const reportingModuleUrl = new URL('./reporting.ts', import.meta.url).href;

function reportRequest(value: unknown): Request {
  return new Request(endpoint, {
    body: JSON.stringify(value),
    headers: { 'Content-Type': 'application/reports+json' },
    method: 'POST',
  });
}

function report(blockedURL: string): object {
  return { body: { blockedURL }, type: 'csp-violation' };
}

describe('security reporting intrinsic boundary', () => {
  it('never persists capability paths or queries after a late URL origin getter replacement', async () => {
    const app = createApp();
    const secret = 'CAPABILITY_PATH_SECRET_7d91';
    const request = reportRequest(
      report(`https://cdn.example.test/reset/${secret}?token=${secret}#${secret}`),
    );
    const descriptor = Object.getOwnPropertyDescriptor(URL.prototype, 'origin');
    if (descriptor?.get === undefined) throw new Error('URL origin getter unavailable in test realm');
    const nativeOrigin = descriptor.get;
    try {
      Object.defineProperty(URL.prototype, 'origin', {
        ...descriptor,
        get() {
          const href = this.href;
          return href.includes(secret) ? href : Reflect.apply(nativeOrigin, this, []);
        },
      });
      expect((await kovoSecurityReportResponse(app, request)).status).toBe(204);
    } finally {
      Object.defineProperty(URL.prototype, 'origin', descriptor);
    }

    const snapshot = kovoSecurityReportSnapshot(app);
    expect(snapshot.aggregates[0]?.report.blocked).toBe('https://cdn.example.test');
    expect(JSON.stringify(snapshot)).not.toContain(secret);
  });

  it('pins request method/body, JSON, text decoding, and string controls after late poisoning', async () => {
    const app = createApp();
    const secret = 'CAPABILITY_BODY_SECRET_81f2';
    const request = reportRequest(
      report(`https://assets.example.test/download/${secret}?signature=${secret}`),
    );
    const bodyDescriptor = Object.getOwnPropertyDescriptor(Request.prototype, 'body');
    const methodDescriptor = Object.getOwnPropertyDescriptor(Request.prototype, 'method');
    if (bodyDescriptor?.get === undefined || methodDescriptor?.get === undefined) {
      throw new Error('Request getters unavailable in test realm');
    }
    const nativeBody = bodyDescriptor.get;
    const nativeMethod = methodDescriptor.get;
    const nativeJsonParse = JSON.parse;
    const nativeToUpperCase = String.prototype.toUpperCase;
    const nativeTrim = String.prototype.trim;
    const NativeTextDecoder = globalThis.TextDecoder;
    let status: number | undefined;
    try {
      Object.defineProperty(Request.prototype, 'body', {
        ...bodyDescriptor,
        get() {
          return this === request ? null : Reflect.apply(nativeBody, this, []);
        },
      });
      Object.defineProperty(Request.prototype, 'method', {
        ...methodDescriptor,
        get() {
          return this === request ? 'GET' : Reflect.apply(nativeMethod, this, []);
        },
      });
      JSON.parse = ((value: string) =>
        value.includes(secret) ? null : nativeJsonParse(value)) as typeof JSON.parse;
      String.prototype.toUpperCase = function () {
        return String(this) === 'POST' ? 'GET' : Reflect.apply(nativeToUpperCase, this, []);
      };
      String.prototype.trim = function () {
        return String(this).includes(secret) ? '' : Reflect.apply(nativeTrim, this, []);
      };
      globalThis.TextDecoder = class {
        decode(): string {
          return '';
        }
      } as unknown as typeof TextDecoder;

      status = (await kovoSecurityReportResponse(app, request)).status;
    } finally {
      Object.defineProperty(Request.prototype, 'body', bodyDescriptor);
      Object.defineProperty(Request.prototype, 'method', methodDescriptor);
      JSON.parse = nativeJsonParse;
      String.prototype.toUpperCase = nativeToUpperCase;
      String.prototype.trim = nativeTrim;
      globalThis.TextDecoder = NativeTextDecoder;
    }

    expect(status).toBe(204);
    const snapshot = kovoSecurityReportSnapshot(app);
    expect(snapshot.aggregates[0]?.report.blocked).toBe('https://assets.example.test');
    expect(JSON.stringify(snapshot)).not.toContain(secret);
  });

  it('preserves aggregate identity after selective WeakMap/Map and clock poisoning', async () => {
    const app = createApp();
    const body = report('https://cdn.example.test/one.js?secret=one');
    await kovoSecurityReportResponse(app, reportRequest(body));

    const originalDateNow = Date.now;
    const originalMapGet = Map.prototype.get;
    const originalWeakMapGet = WeakMap.prototype.get;
    try {
      Date.now = () => originalDateNow() + 365 * 24 * 60 * 60_000;
      WeakMap.prototype.get = function (key: object) {
        if (key === app) return undefined;
        return originalWeakMapGet.call(this, key);
      };
      Map.prototype.get = function (key: unknown) {
        if (typeof key === 'string' && key.includes('csp-violation')) return undefined;
        return originalMapGet.call(this, key);
      };
      await kovoSecurityReportResponse(app, reportRequest(body));
    } finally {
      Date.now = originalDateNow;
      Map.prototype.get = originalMapGet;
      WeakMap.prototype.get = originalWeakMapGet;
    }

    expect(kovoSecurityReportSnapshot(app)).toMatchObject({
      aggregates: [{ count: 2, report: { blocked: 'https://cdn.example.test' } }],
      dropped: 0,
    });
  });

  it('does not let a late clock advance reset the report rate window', async () => {
    const app = createApp();
    const emptyReport = new Request(endpoint, { method: 'POST' });
    for (let index = 0; index < 1_200; index += 1) {
      await kovoSecurityReportResponse(app, emptyReport);
    }

    const originalDateNow = Date.now;
    try {
      Date.now = () => originalDateNow() + 365 * 24 * 60 * 60_000;
      await kovoSecurityReportResponse(app, emptyReport);
    } finally {
      Date.now = originalDateNow;
    }

    expect(kovoSecurityReportSnapshot(app)).toEqual({ aggregates: [], dropped: 1 });
  });

  it('keeps aggregate cardinality bounded after a late Map size getter replacement', async () => {
    const app = createApp();
    for (let batch = 0; batch < 26; batch += 1) {
      const remaining = 512 - batch * 20;
      const count = remaining < 20 ? remaining : 20;
      if (count <= 0) break;
      const reports = Array.from({ length: count }, (_unused, index) =>
        report(`https://cdn-${batch}-${index}.example.test/secret`),
      );
      await kovoSecurityReportResponse(app, reportRequest(reports));
    }
    expect(kovoSecurityReportSnapshot(app).aggregates).toHaveLength(512);

    const sizeDescriptor = Object.getOwnPropertyDescriptor(Map.prototype, 'size');
    if (sizeDescriptor?.get === undefined) throw new Error('Map size getter unavailable in test realm');
    try {
      Object.defineProperty(Map.prototype, 'size', {
        ...sizeDescriptor,
        get() {
          return 0;
        },
      });
      await kovoSecurityReportResponse(
        app,
        reportRequest(report('https://new-origin.example.test/capability/secret')),
      );
    } finally {
      Object.defineProperty(Map.prototype, 'size', sizeDescriptor);
    }

    const snapshot = kovoSecurityReportSnapshot(app);
    expect(snapshot.aggregates).toHaveLength(512);
    expect(snapshot.dropped).toBe(1);
  });

  it('fails closed when request controls were replaced before reporting initialization', async () => {
    const methodDescriptor = Object.getOwnPropertyDescriptor(Request.prototype, 'method');
    if (methodDescriptor?.get === undefined) {
      throw new Error('Request method getter unavailable in test realm');
    }
    let poisonedReporting: typeof import('./reporting.js') | undefined;
    try {
      Object.defineProperty(Request.prototype, 'method', {
        ...methodDescriptor,
        get() {
          return 'GET';
        },
      });
      poisonedReporting = (await import(
        `${reportingModuleUrl}?poisoned-request-method`
      )) as typeof import('./reporting.js');
    } finally {
      Object.defineProperty(Request.prototype, 'method', methodDescriptor);
    }

    await expect(
      poisonedReporting!.kovoSecurityReportResponse(
        createApp(),
        new Request(endpoint, { method: 'POST' }),
      ),
    ).rejects.toThrow(/intrinsics were modified before framework initialization/u);
  });
});
