import { describe, expect, it } from 'vitest';

import {
  parseWireFixture,
  parseWireResponses,
  parseWireTranscript,
  wireFixtureContentTypesFacts,
  wireFixturePresenceFacts,
  wireFixturesWithContentType,
  wireFragmentModeFacts,
  wireResponseBodyPinFacts,
  wireResponseMetadataFacts,
} from './wire-fixtures.js';

const fixture = [
  '### Enhanced mutation',
  '>>> REQUEST',
  'POST /_m/cart/add HTTP/1.1',
  'Accept: text/vnd.jiso.fragment+html',
  'FW-Fragment: true',
  '',
  'productId=p1',
  '<<< RESPONSE',
  'HTTP/1.1 200 OK',
  'Content-Type: text/vnd.jiso.fragment+html; charset=utf-8',
  'FW-Idem: idem_01HX',
  '',
  '<fw-fragment target="cart"></fw-fragment>',
  '>>> REQUEST',
  'GET /cart HTTP/1.1',
  '',
  '<<< RESPONSE',
  'HTTP/1.1 303 See Other',
  'Location: /cart',
  '',
  '',
].join('\n');

const redirectFixture = [
  '### Cart redirect',
  '>>> REQUEST',
  'POST /cart HTTP/1.1',
  'Accept: text/html',
  '',
  'productId=p1',
  '<<< RESPONSE',
  'HTTP/1.1 303 See Other',
  'Location: /cart',
  '',
  '',
].join('\n');

const sources = [
  { name: 'enhanced-mutation.http', source: fixture },
  { name: 'cart-redirect.http', source: redirectFixture },
];

describe('@jiso/test wire fixture seam', () => {
  it('turns titled HTTP wire fixtures into structured exchange facts', () => {
    expect(parseWireFixture(fixture)).toMatchObject({
      exchanges: [
        {
          request: {
            body: 'productId=p1',
            headers: {
              Accept: 'text/vnd.jiso.fragment+html',
              'FW-Fragment': 'true',
            },
            headersByName: {
              accept: 'text/vnd.jiso.fragment+html',
              'fw-fragment': 'true',
            },
            method: 'POST',
            path: '/_m/cart/add',
            requestLine: 'POST /_m/cart/add HTTP/1.1',
            startLine: 'POST /_m/cart/add HTTP/1.1',
          },
          response: {
            body: '<fw-fragment target="cart"></fw-fragment>',
            headersByName: {
              'content-type': 'text/vnd.jiso.fragment+html; charset=utf-8',
              'fw-idem': 'idem_01HX',
            },
            status: 200,
            statusLine: 'HTTP/1.1 200 OK',
            statusText: 'OK',
          },
        },
        {
          request: {
            method: 'GET',
            path: '/cart',
          },
          response: {
            headersByName: {
              location: '/cart',
            },
            status: 303,
            statusText: 'See Other',
          },
        },
      ],
      request: {
        method: 'POST',
        path: '/_m/cart/add',
      },
      response: {
        status: 200,
      },
      title: 'Enhanced mutation',
    });
  });

  it('keeps response-only convenience parsing for byte-for-byte fixture pins', () => {
    expect(parseWireResponses(fixture).map((response) => response.body)).toEqual([
      '<fw-fragment target="cart"></fw-fragment>',
      '',
    ]);
  });

  it('projects fixture presence and fragment request contracts into facts', () => {
    expect(wireFixturePresenceFacts(sources)).toEqual([
      {
        name: 'enhanced-mutation.http',
        requestStartLine: 'POST /_m/cart/add HTTP/1.1',
        responseStartLine: 'HTTP/1.1 200 OK',
        title: 'Enhanced mutation',
      },
      {
        name: 'cart-redirect.http',
        requestStartLine: 'POST /cart HTTP/1.1',
        responseStartLine: 'HTTP/1.1 303 See Other',
        title: 'Cart redirect',
      },
    ]);
    expect(wireFragmentModeFacts(sources, ['enhanced-mutation.http'])).toEqual([
      {
        accept: 'text/vnd.jiso.fragment+html',
        fragment: 'true',
        name: 'enhanced-mutation.http',
      },
    ]);
  });

  it('projects explicit response body pins and protocol metadata', () => {
    expect(
      wireResponseBodyPinFacts(sources, {
        'cart-redirect.http': [''],
        'enhanced-mutation.http': ['<fw-fragment target="cart"></fw-fragment>', ''],
      }),
    ).toEqual([
      {
        actualBody: '',
        expectedBody: '',
        matches: true,
        name: 'cart-redirect.http',
        responseIndex: 1,
      },
      {
        actualBody: '<fw-fragment target="cart"></fw-fragment>',
        expectedBody: '<fw-fragment target="cart"></fw-fragment>',
        matches: true,
        name: 'enhanced-mutation.http',
        responseIndex: 1,
      },
      {
        actualBody: '',
        expectedBody: '',
        matches: true,
        name: 'enhanced-mutation.http',
        responseIndex: 2,
      },
    ]);
    expect(wireResponseMetadataFacts(sources)).toEqual([
      {
        headers: {
          'content-type': 'text/vnd.jiso.fragment+html; charset=utf-8',
          'fw-idem': 'idem_01HX',
        },
        name: 'enhanced-mutation.http',
        responseIndex: 1,
        statusLine: 'HTTP/1.1 200 OK',
      },
      {
        headers: { location: '/cart' },
        name: 'enhanced-mutation.http',
        responseIndex: 2,
        statusLine: 'HTTP/1.1 303 See Other',
      },
      {
        headers: { location: '/cart' },
        name: 'cart-redirect.http',
        responseIndex: 1,
        statusLine: 'HTTP/1.1 303 See Other',
      },
    ]);
  });

  it('summarizes content types without local transcript loops', () => {
    expect(wireFixtureContentTypesFacts(sources)).toEqual([
      {
        contentTypes: ['text/vnd.jiso.fragment+html; charset=utf-8', null],
        name: 'enhanced-mutation.http',
      },
      { contentTypes: [null], name: 'cart-redirect.http' },
    ]);
    expect(wireFixturesWithContentType(sources, 'text/event-stream')).toEqual([]);
  });

  it('rejects malformed wire transcripts at the fixture seam', () => {
    expect(() => parseWireFixture('>>> REQUEST\nGET / HTTP/1.1')).toThrow(
      'Wire fixture starts with a scenario title',
    );
    expect(() => parseWireFixture('### Missing response\n>>> REQUEST\nGET / HTTP/1.1')).toThrow(
      'Wire transcript contains an incomplete request/response pair',
    );
    expect(() =>
      parseWireTranscript(
        ['>>> REQUEST', 'GET / HTTP/1.1', '<<< RESPONSE', 'Status: 200'].join('\n'),
      ),
    ).toThrow('Malformed wire transcript status line: Status: 200');
  });
});
