/**
 * Request-target ceilings enforced before URL/URLSearchParams construction (SPEC §9.5).
 *
 * Keep this module allocation-free: adapters call it on the raw Node target before any parser or
 * authored callback can amplify attacker-controlled separators into URLSearchParams entries.
 *
 * @internal
 */

export const MAX_REQUEST_URL_CHARACTERS = 65_536;
export const MAX_REQUEST_QUERY_ENTRIES = 10_000;

export type RequestUrlLimitFailure = 'query-entries' | 'url-length';

/**
 * Return the first request-target resource ceiling exceeded by `value`.
 *
 * This deliberately scans the serialized string without splitting, decoding, or constructing a
 * URL/URLSearchParams graph. Empty `&` segments do not produce URLSearchParams entries and are not
 * counted; the total character ceiling still bounds the scan and empty-segment work.
 */
export function requestUrlLimitFailure(value: string): RequestUrlLimitFailure | undefined {
  if (value.length > MAX_REQUEST_URL_CHARACTERS) return 'url-length';

  let queryStart = -1;
  let entryStart = -1;
  let entries = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (queryStart < 0) {
      if (character === '#') return undefined;
      if (character === '?') {
        queryStart = index;
        entryStart = index + 1;
      }
      continue;
    }

    if (character !== '&' && character !== '#') continue;
    if (index > entryStart) {
      entries += 1;
      if (entries > MAX_REQUEST_QUERY_ENTRIES) return 'query-entries';
    }
    if (character === '#') return undefined;
    entryStart = index + 1;
  }

  if (queryStart >= 0 && value.length > entryStart) {
    entries += 1;
    if (entries > MAX_REQUEST_QUERY_ENTRIES) return 'query-entries';
  }
  return undefined;
}
