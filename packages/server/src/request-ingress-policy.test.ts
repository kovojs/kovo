import { describe, expect, it } from 'vitest';

import {
  createRequestIngressClassifier,
  type RequestIngressAuthorityInput,
} from './request-ingress-policy.js';

const classifier = createRequestIngressClassifier({
  charCodeAt: (value, index) => value.charCodeAt(index),
  isArray: Array.isArray,
  parseAuthority(authority, scheme) {
    try {
      const parsed = new URL(`${scheme}://${authority}`);
      return {
        hash: parsed.hash,
        host: parsed.host,
        origin: parsed.origin,
        pathname: parsed.pathname,
        search: parsed.search,
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

  it('accepts only one byte-identical authority under both supported schemes', () => {
    for (const authority of [
      'app.example',
      'app.example:8443',
      '127.0.0.1',
      '127.0.0.1:8080',
      '[2001:db8::1]',
      '[2001:db8::1]:8080',
    ]) {
      expect(classifier.classifyAuthority(http1Authority(authority)), authority).toEqual({
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
      expect(classifier.classifyAuthority(http1Authority(authority)), authority).toEqual({
        ok: false,
      });
    }

    expect(
      classifier.classifyAuthority({
        host: 'app.example',
        httpVersion: '1.1',
        pseudoAuthority: undefined,
        rawHostHeaderCount: 2,
      }),
    ).toEqual({ ok: false });
    expect(
      classifier.classifyAuthority({
        host: undefined,
        httpVersion: '1.1',
        pseudoAuthority: undefined,
        rawHostHeaderCount: 0,
      }),
    ).toEqual({ ok: false });
    expect(
      classifier.classifyAuthority({
        host: undefined,
        httpVersion: '1.0',
        pseudoAuthority: undefined,
        rawHostHeaderCount: 0,
      }),
    ).toEqual({ ok: true });
    expect(
      classifier.classifyAuthority({
        host: 'attacker.example',
        httpVersion: '2.0',
        pseudoAuthority: 'app.example',
      }),
    ).toEqual({ authority: 'app.example', ok: true });
    expect(
      classifier.classifyAuthority({
        host: 'app.example',
        httpVersion: '2.0',
        pseudoAuthority: ['app.example', 'evil.example'],
      }),
    ).toEqual({ ok: false });
  });

  it('selects transport-owned scheme sources before applying one strict grammar', () => {
    expect(
      classifier.classifyNode({
        ...http1Authority('app.example'),
        encrypted: false,
        forwardedProto: 'https',
        method: 'GET',
        pseudoScheme: 'https',
        trustedProxy: false,
      }),
    ).toEqual({ authority: 'app.example', method: 'GET', ok: true, scheme: 'http' });
    expect(
      classifier.classifyNode({
        ...http1Authority('app.example'),
        encrypted: true,
        forwardedProto: undefined,
        method: 'POST',
        pseudoScheme: undefined,
        trustedProxy: false,
      }),
    ).toEqual({ authority: 'app.example', method: 'POST', ok: true, scheme: 'https' });

    for (const [forwardedProto, scheme] of [
      ['attacker, https', 'https'],
      ['attacker,\t http \t', 'http'],
      [['https', 'http'], 'http'],
    ] as const) {
      expect(
        classifier.classifyNode({
          ...http1Authority('app.example'),
          encrypted: false,
          forwardedProto,
          method: 'GET',
          pseudoScheme: 'javascript',
          trustedProxy: true,
        }),
      ).toEqual({ authority: 'app.example', method: 'GET', ok: true, scheme });
    }

    for (const forwardedProto of ['', 'https, ', 'https, ftp', [], ['https', 1]]) {
      expect(
        classifier.classifyNode({
          ...http1Authority('app.example'),
          encrypted: false,
          forwardedProto,
          method: 'GET',
          pseudoScheme: undefined,
          trustedProxy: true,
        }),
        JSON.stringify(forwardedProto),
      ).toEqual({ issue: 'forwarded-scheme', ok: false });
    }

    expect(
      classifier.classifyNode({
        ...http1Authority('app.example'),
        encrypted: false,
        forwardedProto: undefined,
        method: 'GET',
        pseudoScheme: 'HTTPS',
        trustedProxy: true,
      }),
    ).toEqual({ authority: 'app.example', method: 'GET', ok: true, scheme: 'https' });
    for (const pseudoScheme of ['', 'ftp', 'https, http', ['https']]) {
      expect(
        classifier.classifyNode({
          ...http1Authority('app.example'),
          encrypted: false,
          forwardedProto: undefined,
          method: 'GET',
          pseudoScheme,
          trustedProxy: true,
        }),
        JSON.stringify(pseudoScheme),
      ).toEqual({ issue: 'pseudo-scheme', ok: false });
    }
  });

  it('applies the same finite verdict to the platform-owned Fetch bridge', () => {
    expect(
      classifier.classifyPlatformFetch({
        authority: 'worker.example:8443',
        method: 'PURGE',
        scheme: 'https',
      }),
    ).toEqual({
      authority: 'worker.example:8443',
      method: 'PURGE',
      ok: true,
      scheme: 'https',
    });
    expect(
      classifier.classifyPlatformFetch({
        authority: 'worker.example',
        method: 'post',
        scheme: 'https',
      }),
    ).toEqual({ issue: 'method', ok: false });
    expect(
      classifier.classifyPlatformFetch({
        authority: '%77orker.example',
        method: 'GET',
        scheme: 'https',
      }),
    ).toEqual({ issue: 'authority', ok: false });
    expect(
      classifier.classifyPlatformFetch({
        authority: 'worker.example',
        method: 'GET',
        scheme: 'ftp',
      }),
    ).toEqual({ issue: 'platform-scheme', ok: false });
  });
});

function http1Authority(authority: string): RequestIngressAuthorityInput {
  return {
    host: authority,
    httpVersion: '1.1',
    pseudoAuthority: undefined,
    rawHostHeaderCount: 1,
  };
}
