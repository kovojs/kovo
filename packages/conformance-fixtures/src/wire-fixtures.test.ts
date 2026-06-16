import { describe, expect, it } from 'vitest';

import {
  generatedWireResponseBodies,
  loadWireFixtureSources,
  parseWireFixture,
  parseWireResponses,
  parseWireTranscript,
  wireFixtureContentTypesFacts,
  wireFixturePresenceFacts,
  wireFixtureResponseBody,
  wireFixturesWithContentType,
  wireFragmentModeFacts,
  wireResponseBodyPinFacts,
  wireResponseMetadataFacts,
} from './wire-fixtures.js';

const fixture = [
  '### Enhanced mutation',
  '>>> REQUEST',
  'POST /_m/cart/add HTTP/1.1',
  'Accept: text/vnd.kovo.fragment+html',
  'Kovo-Fragment: true',
  '',
  'productId=p1',
  '<<< RESPONSE',
  'HTTP/1.1 200 OK',
  'Content-Type: text/vnd.kovo.fragment+html; charset=utf-8',
  'Kovo-Idem: idem_01HX',
  '',
  '<kovo-fragment target="cart"></kovo-fragment>',
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

describe('@kovojs/test wire fixture seam', () => {
  it('turns titled HTTP wire fixtures into structured exchange facts', () => {
    expect(parseWireFixture(fixture)).toMatchObject({
      exchanges: [
        {
          request: {
            body: 'productId=p1',
            headers: {
              Accept: 'text/vnd.kovo.fragment+html',
              'Kovo-Fragment': 'true',
            },
            headersByName: {
              accept: 'text/vnd.kovo.fragment+html',
              'kovo-fragment': 'true',
            },
            method: 'POST',
            path: '/_m/cart/add',
            requestLine: 'POST /_m/cart/add HTTP/1.1',
            startLine: 'POST /_m/cart/add HTTP/1.1',
          },
          response: {
            body: '<kovo-fragment target="cart"></kovo-fragment>',
            headersByName: {
              'content-type': 'text/vnd.kovo.fragment+html; charset=utf-8',
              'kovo-idem': 'idem_01HX',
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
      '<kovo-fragment target="cart"></kovo-fragment>',
      '',
    ]);
    expect(wireFixtureResponseBody(sources, 'enhanced-mutation.http', 1)).toBe(
      '<kovo-fragment target="cart"></kovo-fragment>',
    );
    expect(() => wireFixtureResponseBody(sources, 'missing.http', 1)).toThrow(
      'Wire fixture is present: missing.http',
    );
    expect(() => wireFixtureResponseBody(sources, 'enhanced-mutation.http', 3)).toThrow(
      'Wire fixture enhanced-mutation.http has response 3',
    );
  });

  it('loads sorted .http fixture sources from a fixture directory URL', async () => {
    const fixtures = await loadWireFixtureSources(
      new URL('../../../fixtures/wire/', import.meta.url),
    );

    expect(fixtures.map(({ name }) => name)).toEqual([
      'defer-stream.http',
      'enhanced-mutation.http',
      'no-js-post-redirect-get.http',
      'typed-read.http',
      'validation-422-fragment.http',
    ]);
    expect(
      wireResponseBodyPinFacts(fixtures, generatedWireResponseBodies).map(
        ({ matches, name, responseIndex }) => ({ matches, name, responseIndex }),
      ),
    ).toEqual([
      { matches: true, name: 'defer-stream.http', responseIndex: 1 },
      { matches: true, name: 'enhanced-mutation.http', responseIndex: 1 },
      { matches: true, name: 'no-js-post-redirect-get.http', responseIndex: 1 },
      { matches: true, name: 'no-js-post-redirect-get.http', responseIndex: 2 },
      { matches: true, name: 'typed-read.http', responseIndex: 1 },
      { matches: true, name: 'validation-422-fragment.http', responseIndex: 1 },
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
        accept: 'text/vnd.kovo.fragment+html',
        fragment: 'true',
        name: 'enhanced-mutation.http',
      },
    ]);
  });

  it('projects explicit response body pins and protocol metadata', () => {
    expect(
      wireResponseBodyPinFacts(sources, {
        'cart-redirect.http': [''],
        'enhanced-mutation.http': ['<kovo-fragment target="cart"></kovo-fragment>', ''],
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
        actualBody: '<kovo-fragment target="cart"></kovo-fragment>',
        expectedBody: '<kovo-fragment target="cart"></kovo-fragment>',
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
          'content-type': 'text/vnd.kovo.fragment+html; charset=utf-8',
          'kovo-idem': 'idem_01HX',
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
        contentTypes: ['text/vnd.kovo.fragment+html; charset=utf-8', null],
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
