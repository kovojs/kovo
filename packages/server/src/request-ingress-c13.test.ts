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
      expect(() => nodeRequestToWebRequest(requestCarrier({ method })), method).toThrow(
        'Kovo Node adapter cannot preserve this HTTP method through the Web Request boundary.',
      );
    }

    for (const method of ['GET', 'HEAD', 'POST', 'DELETE', 'OPTIONS', 'PUT', 'PURGE', 'custom']) {
      expect(nodeRequestToWebRequest(requestCarrier({ method })).method, method).toBe(method);
    }
  });

  it('preserves the complete closed authority-identity verdict and reconstructs one Host', () => {
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
            requestCarrier({ headers: { host: authority }, rawHeaders: ['Host', authority] }),
          ),
        authority,
      ).toThrow('Kovo Node adapter request authority must be one valid host[:port].');
    }

    const duplicateHost = requestCarrier({
      headers: { host: 'victim.example' },
      rawHeaders: ['Host', 'victim.example', 'Host', 'evil.example'],
    });
    expect(() => nodeRequestToWebRequest(duplicateHost)).toThrow(
      'Kovo Node adapter request authority must be one valid host[:port].',
    );

    const missingHttp11Host = requestCarrier({ headers: {}, rawHeaders: [] });
    expect(() => nodeRequestToWebRequest(missingHttp11Host)).toThrow(
      'Kovo Node adapter request authority must be one valid host[:port].',
    );

    const ambiguousPseudoAuthority = requestCarrier({
      headers: { ':authority': ['app.example', 'evil.example'], host: 'app.example' },
    });
    expect(() => nodeRequestToWebRequest(ambiguousPseudoAuthority)).toThrow(
      'Kovo Node adapter request authority must be one valid host[:port].',
    );

    const canonical = nodeRequestToWebRequest(
      requestCarrier({
        headers: { ':authority': 'app.example:8443', host: 'attacker.example' },
      }),
    );
    expect(canonical.url).toBe('http://app.example:8443/probe');
    expect(canonical.headers.get('host')).toBe('app.example:8443');

    expect(
      nodeRequestToWebRequest(
        requestCarrier({
          headers: { host: '[2001:db8::1]:8080' },
          rawHeaders: ['Host', '[2001:db8::1]:8080'],
        }),
      ).url,
    ).toBe('http://[2001:db8::1]:8080/probe');
  });

  it('selects only the explicitly trusted transport scheme before applying strict grammar', () => {
    const forwarded = requestCarrier({
      headers: { host: 'app.example', 'x-forwarded-proto': 'http, https' },
      rawHeaders: ['Host', 'app.example', 'X-Forwarded-Proto', 'http, https'],
    });
    expect(nodeRequestToWebRequest(forwarded).url).toBe('http://app.example/probe');
    expect(nodeRequestToWebRequest(forwarded, { trustedProxy: true }).url).toBe(
      'https://app.example/probe',
    );

    const pseudoScheme = requestCarrier({
      headers: { ':authority': 'app.example', ':scheme': 'https' },
    });
    expect(nodeRequestToWebRequest(pseudoScheme).url).toBe('http://app.example/probe');
    expect(nodeRequestToWebRequest(pseudoScheme, { trustedProxy: true }).url).toBe(
      'https://app.example/probe',
    );

    const forwardedPrecedence = requestCarrier({
      headers: {
        ':authority': 'app.example',
        ':scheme': 'javascript',
        'x-forwarded-proto': 'https',
      },
    });
    expect(nodeRequestToWebRequest(forwardedPrecedence, { trustedProxy: true }).url).toBe(
      'https://app.example/probe',
    );

    for (const invalid of ['', 'https, ', 'https, ftp', []] as const) {
      const carrier = requestCarrier({
        headers: { host: 'app.example', 'x-forwarded-proto': invalid },
        rawHeaders: ['Host', 'app.example'],
      });
      expect(() => nodeRequestToWebRequest(carrier, { trustedProxy: true })).toThrow(
        /must end in http or https|must end in an own string/u,
      );
    }

    const encrypted = requestCarrier({ encrypted: true });
    expect(nodeRequestToWebRequest(encrypted).url).toBe('https://app.example/probe');
  });
});

function requestCarrier(
  options: {
    encrypted?: boolean;
    headers?: Record<string, string | string[] | undefined>;
    method?: string;
    rawHeaders?: string[];
  } = {},
): IncomingMessage {
  const socket = Object.assign(new EventEmitter(), {
    encrypted: options.encrypted ?? false,
    remoteAddress: '203.0.113.9',
  }) as Socket & { encrypted: boolean };
  const headers = options.headers ?? { host: 'app.example' };
  return Object.assign(Readable.from([]), {
    complete: true,
    headers,
    httpVersion: '1.1',
    method: options.method ?? 'GET',
    rawHeaders: options.rawHeaders ?? ['Host', 'app.example'],
    socket,
    url: '/probe',
  }) as IncomingMessage;
}
