import { describe, expect, it } from 'vitest';

import { parseMutationFailure } from './mutation-failure.js';

describe('mutation failure parser', () => {
  it('parses kovo-error chunks with shared tag-close attribute scanning', () => {
    // SPEC.md §9.2: enhanced failure payloads are mutation wire HTML, not regex HTML.
    expect(
      parseMutationFailure(
        '<kovo-error data-debug="quantity > stock">{"code":"OUT_OF_STOCK","data":{"availableQuantity":0}}</kovo-error>',
      ),
    ).toEqual({ code: 'OUT_OF_STOCK', data: { availableQuantity: 0 } });
  });

  it('parses declared failure output payloads before validation outputs', () => {
    expect(
      parseMutationFailure(
        '<output data-debug="x > y" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output><output data-error-path="quantity">Expected number &gt;= 1</output>',
      ),
    ).toEqual({ code: 'OUT_OF_STOCK', data: { availableQuantity: 0 } });
  });

  it('keeps declared output failures ahead of earlier validation output chunks', () => {
    // SPEC.md §9.2: response-body failure outputs share one scanner projection,
    // but typed form errors still prefer declared failures over field maps.
    expect(
      parseMutationFailure(
        '<output data-error-path="quantity">Expected number &gt;= 1</output><kovo-fragment target="error"><output data-debug="quantity > stock" data-error-code="OUT_OF_STOCK">{"availableQuantity":0}</output></kovo-fragment>',
      ),
    ).toEqual({ code: 'OUT_OF_STOCK', data: { availableQuantity: 0 } });
  });

  it('collects validation output paths and unescapes field messages', () => {
    expect(
      parseMutationFailure(
        '<kovo-fragment target="product-form:p1"><output role="alert" data-debug="quantity > min" data-error-path="quantity">Expected number &gt;= 1</output></kovo-fragment>',
      ),
    ).toEqual({
      code: 'VALIDATION',
      fields: { quantity: 'Expected number >= 1' },
    });
  });

  it('falls back to parsed JSON or an unknown failure body', () => {
    expect(parseMutationFailure('{"code":"FAILED","data":{"field":"quantity"}}')).toEqual({
      code: 'FAILED',
      data: { field: 'quantity' },
    });
    expect(parseMutationFailure('plain failure')).toEqual({
      body: 'plain failure',
      code: 'unknown',
    });
  });
});
