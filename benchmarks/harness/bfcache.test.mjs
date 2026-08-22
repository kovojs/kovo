import { describe, expect, it } from 'vitest';

import { bfcacheIterationFindings } from './bfcache.mjs';

describe('bfcache evidence integrity', () => {
  it('accepts a restored document with final listing and sentinel proof', () => {
    expect(bfcacheIterationFindings(restoredSample())).toEqual([]);
  });

  it('accepts an explicit same-document not-applicable traversal', () => {
    expect(
      bfcacheIterationFindings({
        ...restoredSample(),
        applicable: false,
        notApplicableReason: 'in-app navigation stayed in one document',
        restored: false,
      }),
    ).toEqual([]);
  });

  it('rejects missing listing, sentinel, and not-restored evidence', () => {
    expect(
      bfcacheIterationFindings({
        ...restoredSample(),
        finalListing: { contentValid: false, pathname: '/product/example' },
        notRestoredReasonsAvailable: false,
        originSentinelPresent: true,
        restored: false,
      }),
    ).toEqual([
      'history traversal did not return to the expected listing URL',
      'history traversal did not restore the expected listing content',
      'reported non-restore did not prove origin-document replacement',
      'reported non-restore omitted Chromium not-restored evidence',
    ]);
  });
});

function restoredSample() {
  return {
    applicable: true,
    finalListing: {
      cards: 24,
      contentValid: true,
      expectedHeading: 'Field goods for everyday carry',
      heading: 'Field goods for everyday carry',
      pathname: '/',
    },
    listingPath: '/',
    notApplicableReason: null,
    notRestoredReasons: [],
    notRestoredReasonsAvailable: false,
    originSentinelPresent: true,
    restored: true,
  };
}
