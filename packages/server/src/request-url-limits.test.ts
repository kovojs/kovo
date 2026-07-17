import { describe, expect, it } from 'vitest';

import {
  MAX_REQUEST_QUERY_ENTRIES,
  MAX_REQUEST_URL_CHARACTERS,
  requestUrlLimitFailure,
} from './request-url-limits.js';

function serializedQuery(entryCount: number): string {
  if (entryCount === 0) return '';
  return `${'a&'.repeat(entryCount - 1)}a`;
}

describe('request URL resource preflight', () => {
  it('enforces the serialized character boundary without constructing a URL', () => {
    expect(
      requestUrlLimitFailure(`/${'a'.repeat(MAX_REQUEST_URL_CHARACTERS - 1)}`),
    ).toBeUndefined();
    expect(requestUrlLimitFailure(`/${'a'.repeat(MAX_REQUEST_URL_CHARACTERS)}`)).toBe('url-length');
  });

  it('enforces the URLSearchParams entry boundary before native parsing', () => {
    expect(
      requestUrlLimitFailure(`/search?${serializedQuery(MAX_REQUEST_QUERY_ENTRIES)}`),
    ).toBeUndefined();
    expect(
      requestUrlLimitFailure(`/search?${serializedQuery(MAX_REQUEST_QUERY_ENTRIES + 1)}`),
    ).toBe('query-entries');
  });

  it.each([
    ['', 0],
    ['&', 0],
    ['&&', 0],
    ['a&', 1],
    ['&a', 1],
    ['a&&b', 2],
    ['=&&=', 2],
    ['a=%26b&c=%3F', 2],
  ] as const)('matches native URLSearchParams empty-segment behavior for %j', (query, entries) => {
    expect([...new URLSearchParams(query)]).toHaveLength(entries);
    expect(requestUrlLimitFailure(`/search?${query}`)).toBeUndefined();
  });

  it('does not count separators after a fragment as query entries', () => {
    const suffix = serializedQuery(MAX_REQUEST_QUERY_ENTRIES + 1);
    expect(requestUrlLimitFailure(`/search?a=1#${suffix}`)).toBeUndefined();
  });
});
