// @kovo-security-classifier-corpus finite-security-operation-ir
import { describe, expect, it } from 'vitest';

import { compileComponentModule } from './index.js';

function cacheEntries(source: string) {
  const result = compileComponentModule({
    fileName: 'src/cache-influence.tsx',
    source,
  });
  return result.componentGraphFacts.flatMap((component) => component.cacheInfluence ?? []);
}

describe('compiler cache-influence derivation', () => {
  it('derives URL and named-header axes while closing identity and dynamic-header reads', () => {
    // @kovo-security-certifies C13 cache-influence-static-closure
    const entries = cacheEntries(`
import { publicAccess } from '@kovojs/server';
import { query } from '@kovojs/server';

export const localized = query('localized', {
  access: publicAccess('public localized catalog'),
  args: { parse: (value) => value },
  read: { cacheControl: 'public, max-age=60' },
  load(input, { request }) {
    return { id: input.id, language: request.headers.get('Accept-Language') };
  },
});
export const mine = query('mine', {
  access: publicAccess('negative cache-influence fixture'),
  read: { cacheControl: 'public, max-age=60' },
  load(_input, { request }) { return { id: request.session.user.id }; },
});
export const token = query('token', {
  access: publicAccess('negative cache-influence fixture'),
  read: { cacheControl: 'public, max-age=60' },
  load(_input, { request }) { return { token: request.headers.get('Authorization') }; },
});
export const dynamic = query('dynamic', {
  access: publicAccess('negative cache-influence fixture'),
  read: { cacheControl: 'public, max-age=60' },
  load(input, { request }) { return { value: request.headers.get(input.header) }; },
});
`);

    const localized = entries.find((entry) => entry.root === 'query:localized');
    expect(localized).toMatchObject({
      authored: { cacheControl: 'public, max-age=60', posture: 'public' },
      root: 'query:localized',
      surface: 'query',
      vary: ['accept-language'],
      verdict: 'public-proved',
    });
    expect(localized?.axes).toEqual(
      expect.arrayContaining([
        { kind: 'url-path', role: 'cache-key' },
        { kind: 'url-search', role: 'cache-key' },
        { kind: 'request-header', name: 'accept-language', role: 'vary' },
      ]),
    );
    expect(entries.find((entry) => entry.root === 'query:mine')).toMatchObject({
      verdict: 'shared-cache-closed',
    });
    expect(entries.find((entry) => entry.root === 'query:mine')?.axes).toEqual(
      expect.arrayContaining([
        { kind: 'principal', role: 'shared-cache-closed' },
        { kind: 'session', role: 'shared-cache-closed' },
      ]),
    );
    expect(entries.find((entry) => entry.root === 'query:token')?.axes).toContainEqual({
      kind: 'authorization',
      role: 'shared-cache-closed',
    });
    expect(entries.find((entry) => entry.root === 'query:dynamic')?.closedReasons).toContain(
      'unclassified-influence',
    );
  });

  it('keeps opaque finite-IR roots closed and permits only keyed external versions', () => {
    const entries = cacheEntries(`
import { publicAccess, query } from '@kovojs/server';
import { importedLoad } from './opaque.js';

export const catalog = query('catalog', {
  access: publicAccess('public versioned catalog'),
  args: { parse: (value) => value },
  read: {
    cacheControl: 'public, s-maxage=300',
    cacheInfluence: {
      externalDataVersions: [
        { name: 'catalog', key: { axis: 'url-search', name: 'catalogVersion' } },
      ],
    },
  },
  async load(input, { db }) {
    return { rows: await db.select(), version: input.catalogVersion };
  },
});
export const opaque = query('opaque', {
  access: publicAccess('negative opaque fixture'),
  read: { cacheControl: 'public, max-age=60' },
  load: importedLoad,
});
`);

    expect(entries.find((entry) => entry.root === 'query:catalog')).toMatchObject({
      verdict: 'public-proved',
    });
    expect(entries.find((entry) => entry.root === 'query:catalog')?.axes).toContainEqual({
      key: { axis: 'url-search', name: 'catalogVersion' },
      kind: 'external-data-version',
      name: 'catalog',
      role: 'cache-key',
    });
    expect(entries.find((entry) => entry.root === 'query:opaque')).toMatchObject({
      verdict: 'shared-cache-closed',
    });
  });
});
