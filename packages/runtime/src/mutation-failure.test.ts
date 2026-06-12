import { describe, expect, it } from 'vitest';

import { parseMutationFailure } from './mutation-failure.js';

describe('mutation failure parser', () => {
  it('parses fw-error chunks with shared tag-close attribute scanning', () => {
    // SPEC.md §9.2: enhanced failure payloads are mutation wire HTML, not regex HTML.
    expect(
      parseMutationFailure(
        '<fw-error data-debug="quantity > stock">{"code":"OUT_OF_STOCK","data":{"availableQuantity":0}}</fw-error>',
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

  it('collects validation output paths and unescapes field messages', () => {
    expect(
      parseMutationFailure(
        '<fw-fragment target="product-form:p1"><output role="alert" data-debug="quantity > min" data-error-path="quantity">Expected number &gt;= 1</output></fw-fragment>',
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
