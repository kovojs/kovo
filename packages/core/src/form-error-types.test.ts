import { describe, expect, expectTypeOf, it } from 'vitest';

import { FormError } from './index.js';

type DeclaredFailure =
  | {
      code: 'DUPLICATE_EMAIL';
      payload: { email: string };
    }
  | {
      code: 'RATE_LIMITED';
      payload: { retryAfter: number };
    }
  | {
      code: 'VALIDATION';
      fieldErrors: Record<string, string>;
    };

describe('FormError callback narrowing', () => {
  it('narrows one declared code and keeps unrelated failure variants red', () => {
    const failure = null as DeclaredFailure | null;
    const rendered = FormError({
      code: 'DUPLICATE_EMAIL',
      failure,
      message(value) {
        expectTypeOf(value).toEqualTypeOf<Extract<DeclaredFailure, { code: 'DUPLICATE_EMAIL' }>>();
        return value.payload.email;
      },
    });

    FormError({
      code: 'DUPLICATE_EMAIL',
      failure,
      // @ts-expect-error A callback for another declared code cannot consume this FormError.
      message: (value: Extract<DeclaredFailure, { code: 'RATE_LIMITED' }>) =>
        String(value.payload.retryAfter),
    });

    expect(rendered).toBe('');
  });
});
