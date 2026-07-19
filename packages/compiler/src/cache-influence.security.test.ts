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
import { guard, guards, publicAccess } from '@kovojs/server';
import { endpoint, query } from '@kovojs/server';

const authed = guards.authed();

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
export const accessGuarded = query('access-guarded', {
  access: [guard('authed', authed)],
  read: { cacheControl: 'public, max-age=60' },
  load() { return { value: 'private' }; },
});
export const publicEndpoint = endpoint('/public-endpoint', {
  access: publicAccess('public endpoint cache fixture'),
  handler(request) { return request.url; },
  method: 'GET',
  reason: 'cache influence compiler fixture',
  response: { appOwnedSafety: true, body: 'text', cache: 'public' },
});
export const cookieEndpoint = endpoint('/cookie-endpoint', {
  access: publicAccess('negative endpoint cache fixture'),
  handler(request) { return request.headers.get('cookie'); },
  method: 'GET',
  reason: 'cache influence compiler fixture',
  response: { appOwnedSafety: true, body: 'text', cache: 'public' },
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
    expect(entries.find((entry) => entry.root === 'query:access-guarded')).toMatchObject({
      verdict: 'shared-cache-closed',
    });
    expect(entries.find((entry) => entry.root === 'endpoint:/public-endpoint')).toMatchObject({
      surface: 'endpoint',
      verdict: 'public-proved',
    });
    expect(entries.find((entry) => entry.root === 'endpoint:/cookie-endpoint')?.axes).toContainEqual({
      kind: 'cookie',
      role: 'shared-cache-closed',
    });
  });

  it('keeps opaque finite-IR roots closed and permits only keyed external versions', () => {
    const entries = cacheEntries(`
import { publicAccess, query } from '@kovojs/server';
import { importedLoad } from './opaque.js';
import { importedSecret } from './config.js';

const moduleSecret = process.env.CATALOG_SECRET;

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
export const imported = query('imported', {
  access: publicAccess('negative imported influence fixture'),
  read: { cacheControl: 'public, max-age=60' },
  load() { return { value: importedSecret }; },
});
export const computedSession = query('computed-session', {
  access: publicAccess('negative computed authority fixture'),
  read: { cacheControl: 'public, max-age=60' },
  load(_input, { request }) { return { id: request['session'].user.id }; },
});
export const ambientEnv = query('ambient-env', {
  access: publicAccess('negative ambient secret fixture'),
  read: { cacheControl: 'public, max-age=60' },
  load() { const runtime = process; return { value: runtime.env.CATALOG_SECRET }; },
});
export const runtimeClock = query('runtime-clock', {
  access: publicAccess('negative runtime-state fixture'),
  read: { cacheControl: 'public, max-age=60' },
  load() { return { now: Date.now() }; },
});
export const moduleCapture = query('module-capture', {
  access: publicAccess('negative captured secret fixture'),
  read: { cacheControl: 'public, max-age=60' },
  load() { return { value: moduleSecret }; },
});
export const assignedAlias = query('assigned-alias', {
  access: publicAccess('negative assigned authority fixture'),
  read: { cacheControl: 'public, max-age=60' },
  load(_input, { request }) {
    let alias;
    alias = request;
    return { id: alias.session.user.id };
  },
});
export const contextEscape = query('context-escape', {
  access: publicAccess('negative context escape fixture'),
  read: { cacheControl: 'public, max-age=60' },
  load(_input, context) { return { context }; },
});
export const headersEscape = query('headers-escape', {
  access: publicAccess('negative headers escape fixture'),
  read: { cacheControl: 'public, max-age=60' },
  load(_input, { request }) { return { headers: request.headers }; },
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
    for (const root of [
      'query:imported',
      'query:computed-session',
      'query:ambient-env',
      'query:runtime-clock',
      'query:module-capture',
      'query:assigned-alias',
      'query:context-escape',
      'query:headers-escape',
    ]) {
      expect(entries.find((entry) => entry.root === root), root).toMatchObject({
        verdict: 'shared-cache-closed',
      });
    }
  });
});
