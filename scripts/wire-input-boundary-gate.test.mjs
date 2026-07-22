import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { discoverWireInputReads, evaluateWireInputBoundary } from './wire-input-boundary-gate.mjs';

const sources = new Map([
  [
    'readers.ts',
    `export function requestHeader(_source: unknown, _name: string) { return undefined; }
     export function readCookie(_source: unknown, _name: string) { return undefined; }
     export function readSearch(_source: unknown) { return []; }
     export function createControls() {
       function readHeader(_source: unknown, _name: string) { return undefined; }
       return { readHeader };
     }`,
  ],
  [
    'consumer.ts',
    `import {
       createControls,
       readCookie as cookieDoor,
       readSearch as searchDoor,
       requestHeader as headerDoor,
     } from './readers.js';
     const requestTarget = headerDoor({}, 'Kovo-Targets');
     const cookieName = 'csrf-token';
     const cookie = cookieDoor({}, cookieName);
     const search = searchDoor({});
     const controls = createControls();
     const responseBuild = controls.readHeader({}, 'Kovo-Build');
     const lookalike = { requestHeader() {}, readHeader() {} };
     lookalike.requestHeader({}, 'Kovo-Targets');
     lookalike.readHeader({}, 'Kovo-Build');`,
  ],
]);

const canonicalReaders = [
  {
    allowedCarriers: ['request-header'],
    api: 'requestHeader',
    declaration: 'function',
    file: 'readers.ts',
    name: 'requestHeader',
    nameArgument: 1,
    normalizeName: 'lowercase',
  },
  {
    allowedCarriers: ['request-cookie'],
    api: 'readCookie',
    declaration: 'function',
    file: 'readers.ts',
    name: 'readCookie',
    nameArgument: 1,
  },
  {
    allowedCarriers: ['search-params'],
    api: 'readSearch',
    declaration: 'function',
    file: 'readers.ts',
    fixedName: '*',
    name: 'readSearch',
  },
  {
    allowedCarriers: ['response-header'],
    api: 'browserReadHeader',
    declaration: 'shorthand-property',
    file: 'readers.ts',
    identity: 'createControls.readHeader',
    name: 'readHeader',
    nameArgument: 1,
    normalizeName: 'lowercase',
  },
];

const registry = {
  inputs: [
    { carrier: 'request-cookie', id: 'request-cookie.dynamic', name: '*' },
    { carrier: 'request-header', id: 'request-header.kovo-targets', name: 'kovo-targets' },
    { carrier: 'response-header', id: 'response-header.kovo-build', name: 'kovo-build' },
    { carrier: 'search-params', id: 'search-params.query-input', name: '*' },
  ],
  schema: 'kovo.wire-input-registry/v1',
};

// @kovo-security-certifies C13 wire-input-symbol-identity-census
it('discovers framework wire reads by TypeScript symbol identity and ignores lookalikes', () => {
  const discovered = discoverWireInputReads({ canonicalReaders, sources });

  expect(discovered).toEqual([
    {
      allowedCarriers: ['request-header'],
      api: 'requestHeader',
      file: 'consumer.ts',
      id: 'consumer.ts#requestTarget',
      inputName: 'kovo-targets',
      symbol: 'readers.ts#requestHeader',
    },
    {
      allowedCarriers: ['request-cookie'],
      api: 'readCookie',
      file: 'consumer.ts',
      id: 'consumer.ts#cookie',
      inputName: 'csrf-token',
      symbol: 'readers.ts#readCookie',
    },
    {
      allowedCarriers: ['search-params'],
      api: 'readSearch',
      file: 'consumer.ts',
      id: 'consumer.ts#search',
      inputName: '*',
      symbol: 'readers.ts#readSearch',
    },
    {
      allowedCarriers: ['response-header'],
      api: 'browserReadHeader',
      file: 'consumer.ts',
      id: 'consumer.ts#responseBuild',
      inputName: 'kovo-build',
      symbol: 'readers.ts#createControls.readHeader',
    },
  ]);
});

describe('closed wire-input classifications', () => {
  // @kovo-security-certifies C13 finite-mcp-stdio-wire-input-census
  it('binds the finite MCP NDJSON parser to the exact stdio carrier and rejects carrier drift', () => {
    const [site] = discoverWireInputReads().filter(
      (candidate) => candidate.file === 'packages/core/src/internal/mcp-stdio.ts',
    );
    expect(site).toEqual({
      allowedCarriers: ['stdio-line'],
      api: 'finiteMcpStdioJsonLine',
      file: 'packages/core/src/internal/mcp-stdio.ts',
      id: 'packages/core/src/internal/mcp-stdio.ts#parsed',
      inputName: 'json-rpc',
      symbol: 'packages/core/src/internal/mcp-stdio.ts#parseFiniteMcpJsonLine',
    });

    const result = evaluateWireInputBoundary({
      discovered: [site],
      manifest: {
        rows: [
          {
            ...site,
            reason: 'This intentionally wrong row proves the carrier cannot drift to HTTP.',
            registryId: 'request-header.json-rpc',
          },
        ],
        schema: 'kovo-wire-input-boundary/v1',
        summary: { classified: 1, dynamicNames: 0, sites: 1 },
      },
      registry: {
        inputs: [
          {
            carrier: 'request-header',
            grammar: 'json',
            id: 'request-header.json-rpc',
            name: 'json-rpc',
          },
        ],
        schema: 'kovo.wire-input-registry/v1',
      },
    });

    expect(result.findings).toContain(
      'packages/core/src/internal/mcp-stdio.ts#parsed: request-header is not allowed for finiteMcpStdioJsonLine',
    );
  });

  // @kovo-security-certifies C13 cache-credential-reader-exact-names
  it('keeps cache-credential helper reads bound to exact field names', () => {
    const reads = discoverWireInputReads()
      .filter(
        (site) =>
          site.file === 'packages/server/src/query.ts' &&
          site.id.includes('#queryRequestHeader.return'),
      )
      .map((site) => site.inputName)
      .sort((left, right) => String(left).localeCompare(String(right)));

    expect(reads).toEqual(['authorization', 'authorization', 'cookie', 'cookie']);
  });

  it('binds every browser content-disposition read to its dedicated finite grammar', () => {
    const manifest = JSON.parse(readFileSync('security/wire-input-boundary.json', 'utf8'));
    const reads = discoverWireInputReads().filter(
      (site) => site.api === 'browserReadHeader' && site.inputName === 'content-disposition',
    );

    expect(reads).toHaveLength(3);
    expect(
      reads.map((site) => manifest.rows.find((row) => row.id === site.id)?.registryId),
    ).toEqual([
      'response-header.content-disposition',
      'response-header.content-disposition',
      'response-header.content-disposition',
    ]);
  });

  it('rejects missing, stale, and name-incompatible registry bindings', () => {
    const discovered = discoverWireInputReads({ canonicalReaders, sources });
    const result = evaluateWireInputBoundary({
      discovered,
      manifest: {
        rows: [
          {
            ...discovered[0],
            reason: 'The mutation target header is parsed by the shared finite grammar.',
            registryId: 'request-cookie.dynamic',
          },
          {
            ...discovered[1],
            id: 'consumer.ts#stale',
            reason: 'This row no longer has a resolved reader call.',
            registryId: 'request-cookie.dynamic',
          },
        ],
        schema: 'kovo-wire-input-boundary/v1',
      },
      registry,
    });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        'consumer.ts#requestTarget: request-cookie is not allowed for requestHeader',
        'consumer.ts#requestTarget: kovo-targets does not match registry input *',
        'stale wire-input boundary row consumer.ts#stale',
        'missing wire-input boundary row consumer.ts#cookie',
        'missing wire-input boundary row consumer.ts#search',
        'missing wire-input boundary row consumer.ts#responseBuild',
      ]),
    );
  });
});
