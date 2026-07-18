import { describe, expect, it } from 'vitest';

import {
  createRequestIngressClassifier,
  type NodeHttp1RequestIngressInput,
  type NodeHttp2RequestIngressInput,
  type PlatformFetchRequestIngressInput,
  type VercelNodeRequestIngressInput,
} from './request-ingress-policy.js';

const classifier = createRequestIngressClassifier({
  canonicalClientIp(value) {
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(value)) {
      const parts = value.split('.');
      return parts.every((part) => String(Number(part)) === part && Number(part) <= 255)
        ? value
        : undefined;
    }
    try {
      const parsed = new URL(`http://[${value}]/`);
      const canonical = parsed.hostname.slice(1, -1);
      return canonical === value ? value : undefined;
    } catch {
      return undefined;
    }
  },
  charCodeAt: (value, index) => value.charCodeAt(index),
  isArray: Array.isArray,
  parseAuthority(authority, scheme) {
    try {
      const parsed = new URL(`${scheme}://${authority}`);
      return {
        hash: parsed.hash,
        host: parsed.host,
        origin: parsed.origin,
        password: parsed.password,
        pathname: parsed.pathname,
        search: parsed.search,
        username: parsed.username,
      };
    } catch {
      return undefined;
    }
  },
  parseTarget(target, base) {
    try {
      const parsed = base === undefined ? new URL(target) : new URL(target, base);
      return {
        hash: parsed.hash,
        host: parsed.host,
        href: parsed.href,
        origin: parsed.origin,
        password: parsed.password,
        pathname: parsed.pathname,
        protocol: parsed.protocol,
        search: parsed.search,
        username: parsed.username,
      };
    } catch {
      return undefined;
    }
  },
});

// @kovo-security-classifier-corpus request-ingress
describe('SPEC §9.5 finite request-ingress classifier', () => {
  it('admits exactly canonical standard methods plus byte-stable extension tokens', () => {
    for (const method of ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT']) {
      expect(classifier.classifyMethod(method), method).toBe(true);
    }
    for (const method of ['PATCH', 'PURGE', 'M-SEARCH', 'custom', "X!#$%&'*+-.^_`|~"]) {
      expect(classifier.classifyMethod(method), method).toBe(true);
    }
    for (const method of [
      '',
      'get',
      'Get',
      'post',
      'PoSt',
      'delete',
      'head',
      'options',
      'put',
      'CONNECT',
      'connect',
      'TRACE',
      'trace',
      'TRACK',
      'track',
      'bad method',
      'X\tY',
      'X/Y',
      'X:Y',
      'X?Y',
      'X\\Y',
      'X\u007fY',
    ]) {
      expect(classifier.classifyMethod(method), method).toBe(false);
    }

    const tokenPunctuation = new Set("!#$%&'*+-.^_`|~");
    for (let code = 0; code <= 0x7f; code += 1) {
      const character = String.fromCharCode(code);
      const expected =
        (code >= 0x30 && code <= 0x39) ||
        (code >= 0x41 && code <= 0x5a) ||
        (code >= 0x61 && code <= 0x7a) ||
        tokenPunctuation.has(character);
      expect(classifier.classifyMethod(`X${character}Y`), `ASCII ${code}`).toBe(expected);
    }
  });

  it('binds HTTP/1 to exactly one raw Host and never borrows HTTP/2 evidence', () => {
    expect(classifier.classify(http1())).toEqual(accepted());
    expect(classifier.classify(http1({ encrypted: true }))).toEqual(accepted({ scheme: 'https' }));
    expect(
      classifier.classify(http1({ forwardedProto: 'http, https', trustedProxy: true })),
    ).toEqual(accepted({ scheme: 'https' }));

    for (const input of [
      http1({ pseudoAuthority: 'app.example' }),
      http1({ pseudoScheme: 'http' }),
      http1({ httpVersion: '2.0' }),
    ]) {
      expect(classifier.classify(input)).toEqual({ issue: 'source', ok: false });
    }
    for (const input of [
      http1({ rawHostHeaderCount: undefined }),
      http1({ rawHostHeaderCount: 0 }),
      http1({ rawHostHeaderCount: 2 }),
      http1({ rawHostHeaderValue: 'other.example' }),
      http1({ host: undefined }),
    ]) {
      expect(classifier.classify(input)).toEqual({ issue: 'authority', ok: false });
    }
  });

  it('binds HTTP/2 to exact pseudo authority/scheme and rejects incompatible fields', () => {
    expect(classifier.classify(http2())).toEqual(accepted({ scheme: 'https' }));
    expect(
      classifier.classify(http2({ encrypted: false, pseudoScheme: 'https', trustedProxy: true })),
    ).toEqual(accepted({ scheme: 'https' }));

    for (const input of [
      http2({ pseudoScheme: 'HTTPS' }),
      http2({ pseudoScheme: 'Http' }),
      http2({ pseudoScheme: undefined }),
      http2({ encrypted: false, pseudoScheme: 'https', trustedProxy: false }),
    ]) {
      expect(classifier.classify(input)).toEqual({ issue: 'pseudo-scheme', ok: false });
    }
    for (const input of [
      http2({ host: 'app.example' }),
      http2({ forwardedProto: 'https' }),
      http2({ httpVersion: '1.1' }),
      http2({ rawHostHeaderCount: 1 }),
    ]) {
      expect(classifier.classify(input)).toEqual({ issue: 'source', ok: false });
    }
  });

  it('requires canonical authority under both schemes for every source posture', () => {
    for (const authority of [
      'app.example',
      'app.example:8443',
      '127.0.0.1',
      '127.0.0.1:8080',
      '[2001:db8::1]',
      '[2001:db8::1]:8080',
    ]) {
      expect(
        classifier.classify(http1({ host: authority, rawHostHeaderValue: authority })),
        authority,
      ).toMatchObject({
        authority,
        ok: true,
      });
    }
    for (const authority of [
      '',
      'victim.example@evil.example',
      'victim.example/ignored',
      'victim.example\\ignored',
      'victim.example?ignored',
      'victim.example#ignored',
      'victim.example, evil.example',
      'victim.example:99999',
      '%65xample.com',
      'éxample.com',
      'EXAMPLE.com',
      'example.com:80',
      'example.com:443',
      '127.000.000.001',
      '[2001:0db8::1]:8080',
      'app.example\u0000',
      'app.example\t',
    ]) {
      expect(
        classifier.classify(http1({ host: authority, rawHostHeaderValue: authority })),
        authority,
      ).toEqual({
        issue: 'authority',
        ok: false,
      });
    }
  });

  it('classifies request-target form before URL or route dispatch', () => {
    for (const rawTarget of ['/', '/a/b?x=1', '/_m/cart/add?source=buy']) {
      expect(classifier.classify(http1({ rawTarget })), rawTarget).toMatchObject({
        ok: true,
        target: rawTarget,
        targetForm: 'origin',
      });
    }
    expect(
      classifier.classify(http1({ rawTarget: 'http://app.example/absolute?x=1' })),
    ).toMatchObject({ ok: true, target: '/absolute?x=1', targetForm: 'absolute' });

    for (const rawTarget of [
      '*',
      '//evil.example/path',
      '/\\evil.example/path',
      '/a/../_m/cart/add',
      '/%2e%2e/_m/cart/add',
      '/a#fragment',
      'javascript:alert(1)',
      'mailto:user@example.com',
      'authority.example:443',
      'http://evil.example/path',
      'http://user:pass@app.example/path',
      'https://app.example/path',
      'HTTP://app.example/path',
      'http://app.example:80/path',
      'http://app.example',
    ]) {
      expect(classifier.classify(http1({ rawTarget })), rawTarget).toEqual({
        issue: 'target',
        ok: false,
      });
    }
    expect(classifier.classify(http1({ method: 'OPTIONS', rawTarget: '*' }))).toEqual({
      issue: 'target',
      ok: false,
    });
  });

  it('requires Vercel edge-owned scheme and canonical client provenance', () => {
    expect(classifier.classify(vercelNode())).toEqual(
      accepted({ clientIp: '203.0.113.9', scheme: 'https' }),
    );
    for (const platformScheme of [undefined, '', 'HTTPS', 'https, http', ['https']]) {
      expect(classifier.classify(vercelNode({ platformScheme }))).toEqual({
        issue: 'platform-scheme',
        ok: false,
      });
    }
    for (const platformClientIp of [
      undefined,
      '',
      'unknown',
      '203.0.113.09',
      '203.0.113.9, 198.51.100.1',
      ['203.0.113.9'],
    ]) {
      expect(classifier.classify(vercelNode({ platformClientIp }))).toEqual({
        issue: 'platform-client',
        ok: false,
      });
    }
  });

  it('applies the same finite target ceiling to a platform-owned Fetch bridge', () => {
    expect(classifier.classify(platformFetch())).toEqual(
      accepted({ scheme: 'https', targetForm: 'absolute' }),
    );
    expect(classifier.classify(platformFetch({ method: 'post' }))).toEqual({
      issue: 'method',
      ok: false,
    });
    expect(classifier.classify(platformFetch({ scheme: 'ftp' }))).toEqual({
      issue: 'platform-scheme',
      ok: false,
    });
    expect(classifier.classify(platformFetch({ rawTarget: 'javascript:alert(1)' }))).toEqual({
      issue: 'target',
      ok: false,
    });
  });

  it('fails closed for an unknown runtime source discriminant', () => {
    expect(classifier.classify({ ...http1(), source: 'future-carrier' } as never)).toEqual({
      issue: 'source',
      ok: false,
    });
  });
});

function accepted(
  overrides: Partial<{
    authority: string;
    clientIp: string;
    method: string;
    scheme: 'http' | 'https';
    target: string;
    targetForm: 'absolute' | 'origin';
  }> = {},
) {
  return {
    authority: 'app.example',
    method: 'GET',
    ok: true,
    scheme: 'http',
    target: '/probe',
    targetForm: 'origin',
    ...overrides,
  };
}

function http1(
  overrides: Partial<NodeHttp1RequestIngressInput> = {},
): NodeHttp1RequestIngressInput {
  return {
    encrypted: false,
    forwardedProto: undefined,
    host: 'app.example',
    httpVersion: '1.1',
    method: 'GET',
    pseudoAuthority: undefined,
    pseudoScheme: undefined,
    rawHostHeaderCount: 1,
    rawHostHeaderValue: 'app.example',
    rawTarget: '/probe',
    source: 'node-http1',
    trustedProxy: false,
    ...overrides,
  };
}

function http2(
  overrides: Partial<NodeHttp2RequestIngressInput> = {},
): NodeHttp2RequestIngressInput {
  return {
    encrypted: true,
    forwardedProto: undefined,
    host: undefined,
    httpVersion: '2.0',
    method: 'GET',
    pseudoAuthority: 'app.example',
    pseudoScheme: 'https',
    rawHostHeaderCount: 0,
    rawHostHeaderValue: undefined,
    rawTarget: '/probe',
    source: 'node-http2',
    trustedProxy: false,
    ...overrides,
  };
}

function vercelNode(
  overrides: Partial<VercelNodeRequestIngressInput> = {},
): VercelNodeRequestIngressInput {
  return {
    host: 'app.example',
    httpVersion: '1.1',
    method: 'GET',
    platformClientIp: '203.0.113.9',
    platformScheme: 'https',
    pseudoAuthority: undefined,
    pseudoScheme: undefined,
    rawHostHeaderCount: 1,
    rawHostHeaderValue: 'app.example',
    rawTarget: '/probe',
    source: 'vercel-node',
    ...overrides,
  };
}

function platformFetch(
  overrides: Partial<PlatformFetchRequestIngressInput> = {},
): PlatformFetchRequestIngressInput {
  return {
    authority: 'app.example',
    method: 'GET',
    rawTarget: 'https://app.example/probe',
    scheme: 'https',
    source: 'platform-fetch',
    ...overrides,
  };
}
