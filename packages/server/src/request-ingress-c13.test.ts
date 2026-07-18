import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { nodeRequestToWebRequest } from './node.js';

// @kovo-security-classifier-corpus request-ingress
describe('SPEC §9.5 request-ingress closed corpus', () => {
  it('preserves the complete closed method-identity verdict before Fetch construction', () => {
    for (const method of [
      '',
      'bad method',
      'get',
      'Get',
      'post',
      'PoSt',
      'delete',
      'head',
      'options',
      'put',
      'CONNECT',
      'TRACE',
      'TRACK',
    ]) {
      expect(() => nodeRequestToWebRequest(http1Carrier({ method })), method).toThrow(
        'Kovo Node adapter cannot preserve this HTTP method through the Web Request boundary.',
      );
    }

    for (const method of ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS', 'PUT', 'PURGE', 'custom']) {
      expect(nodeRequestToWebRequest(http1Carrier({ method })).method, method).toBe(method);
    }
  });

  it('preserves explicit HTTP/1 and HTTP/2 source postures with exact authority evidence', () => {
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
      'EXAMPLE.com',
      'example.com:80',
      'example.com:443',
      '127.000.000.001',
      '[2001:0db8::1]:8080',
    ]) {
      expect(
        () =>
          nodeRequestToWebRequest(
            http1Carrier({ headers: { host: authority }, rawHeaders: ['Host', authority] }),
          ),
        authority,
      ).toThrow('Kovo Node adapter request authority must be one valid host[:port].');
    }

    for (const request of [
      http1Carrier({ rawHeaders: ['Host', 'app.example', 'Host', 'evil.example'] }),
      http1Carrier({ headers: { host: 'app.example' }, rawHeaders: ['Host', 'evil.example'] }),
      http1Carrier({ headers: {}, rawHeaders: [] }),
    ]) {
      expect(() => nodeRequestToWebRequest(request)).toThrow(
        'Kovo Node adapter request authority must be one valid host[:port].',
      );
    }

    const canonicalH2 = nodeRequestToWebRequest(http2Carrier());
    expect(canonicalH2.url).toBe('http://h2.example:8443/probe');
    expect(canonicalH2.headers.get('host')).toBe('h2.example:8443');

    for (const incompatible of [
      http2Carrier({
        headers: { ':authority': 'h2.example', ':scheme': 'http', host: 'h1.example' },
      }),
      http2Carrier({ rawHeaders: ['Host', 'h1.example'] }),
      http2Carrier({ httpVersion: '1.1' }),
    ]) {
      expect(() => nodeRequestToWebRequest(incompatible)).toThrow(
        'Kovo Node adapter request carrier does not match one supported transport posture.',
      );
    }

    const unknown = http1Carrier();
    delete (unknown as IncomingMessage & { __kovoRequestIngressSource?: string })
      .__kovoRequestIngressSource;
    expect(() => nodeRequestToWebRequest(unknown)).toThrow(
      'Kovo Node adapter received an unsupported request carrier posture.',
    );
  });

  it('selects only the explicitly trusted exact transport scheme before reconstruction', () => {
    const forwarded = http1Carrier({
      headers: { host: 'app.example', 'x-forwarded-proto': 'http, https' },
      rawHeaders: ['Host', 'app.example', 'X-Forwarded-Proto', 'http, https'],
    });
    expect(nodeRequestToWebRequest(forwarded).url).toBe('http://app.example/probe');
    expect(nodeRequestToWebRequest(forwarded, { trustedProxy: true }).url).toBe(
      'https://app.example/probe',
    );

    for (const invalid of ['', 'https, ', 'https, ftp', []] as const) {
      const carrier = http1Carrier({
        headers: { host: 'app.example', 'x-forwarded-proto': invalid },
      });
      expect(() => nodeRequestToWebRequest(carrier, { trustedProxy: true })).toThrow(
        'Trusted proxy scheme headers must end in http or https.',
      );
    }

    for (const pseudoScheme of ['', 'HTTPS', 'javascript', 'https, http']) {
      expect(() =>
        nodeRequestToWebRequest(http2Carrier({ pseudoScheme }), { trustedProxy: true }),
      ).toThrow(
        'HTTP/2 :scheme must be exact lowercase http or https and match its selected posture.',
      );
    }

    const forwardedOnH2 = http2Carrier({
      headers: {
        ':authority': 'h2.example:8443',
        ':scheme': 'http',
        'x-forwarded-proto': 'https',
      },
    });
    expect(() => nodeRequestToWebRequest(forwardedOnH2, { trustedProxy: true })).toThrow(
      'Kovo Node adapter request carrier does not match one supported transport posture.',
    );

    expect(nodeRequestToWebRequest(http1Carrier({ encrypted: true })).url).toBe(
      'https://app.example/probe',
    );
  });

  it('admits only canonical origin or matching absolute targets and closes aliases', () => {
    expect(nodeRequestToWebRequest(http1Carrier({ url: '/probe?x=1' })).url).toBe(
      'http://app.example/probe?x=1',
    );
    expect(nodeRequestToWebRequest(http1Carrier({ url: 'http://app.example/probe?x=1' })).url).toBe(
      'http://app.example/probe?x=1',
    );

    for (const target of [
      '*',
      'authority.example:443',
      'javascript:alert(1)',
      'mailto:security@example.test',
      '//evil.example/probe',
      '/probe#fragment',
      '/_m/a/%2e/b',
      '/_m/a/%2F/b',
      '/_m/a/%5c/b',
      '/_m/a/./b',
      'https://app.example/probe',
      'http://evil.example/probe',
      'http://user:pass@app.example/probe',
      'http://app.example:80/probe',
    ]) {
      const method = target === '*' ? 'OPTIONS' : 'GET';
      expect(() => nodeRequestToWebRequest(http1Carrier({ method, url: target })), target).toThrow(
        'Kovo Node adapter request target must be one canonical origin-form or matching HTTP(S) absolute-form target.',
      );
    }
  });
});

function http1Carrier(
  options: {
    encrypted?: boolean;
    headers?: Record<string, string | string[] | undefined>;
    httpVersion?: string;
    method?: string;
    rawHeaders?: string[];
    url?: string;
  } = {},
): IncomingMessage {
  const socket = Object.assign(new EventEmitter(), {
    encrypted: options.encrypted ?? false,
    remoteAddress: '203.0.113.9',
  }) as Socket & { encrypted: boolean };
  return Object.assign(Readable.from([]), {
    __kovoRequestIngressSource: 'node-http1',
    complete: true,
    headers: options.headers ?? { host: 'app.example' },
    httpVersion: options.httpVersion ?? '1.1',
    method: options.method ?? 'GET',
    rawHeaders: options.rawHeaders ?? ['Host', 'app.example'],
    socket,
    url: options.url ?? '/probe',
  }) as IncomingMessage;
}

function http2Carrier(
  options: {
    headers?: Record<string, string | string[] | undefined>;
    httpVersion?: string;
    pseudoScheme?: string;
    rawHeaders?: string[];
    url?: string;
  } = {},
): IncomingMessage {
  const socket = Object.assign(new EventEmitter(), {
    encrypted: false,
    remoteAddress: '203.0.113.9',
  }) as Socket & { encrypted: boolean };
  return Object.assign(new EventEmitter(), {
    __kovoRequestIngressSource: 'node-http2',
    complete: true,
    headers: options.headers ?? {
      ':authority': 'h2.example:8443',
      ':scheme': options.pseudoScheme ?? 'http',
    },
    httpVersion: options.httpVersion ?? '2.0',
    method: 'GET',
    rawHeaders: options.rawHeaders ?? [],
    socket,
    url: options.url ?? '/probe',
  }) as IncomingMessage;
}
