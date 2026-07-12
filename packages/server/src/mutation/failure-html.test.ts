import { afterEach, describe, expect, it } from 'vitest';

import type { MutationFail } from './definition.js';
import { renderDefaultFailureFragmentContent, renderDefaultFailurePage } from './failure-html.js';

const nativeArrayJoin = Array.prototype.join;

afterEach(() => {
  Array.prototype.join = nativeArrayJoin;
});

describe('default mutation failure HTML', () => {
  it.each([
    ['fragment', renderDefaultFailureFragmentContent],
    ['page', renderDefaultFailurePage],
  ] as const)('keeps the %s output exact after one-shot Array.join poisoning', (_, render) => {
    let triggers = 0;
    Array.prototype.join = function (separator?: string): string {
      if (
        separator === '' &&
        this.length === 1 &&
        typeof this[0] === 'string' &&
        this[0].startsWith('<output role="alert"')
      ) {
        triggers += 1;
        Array.prototype.join = nativeArrayJoin;
        return '<img src=x onerror="globalThis.__kovoFailureXss=1">';
      }
      return Reflect.apply(nativeArrayJoin, this, [separator]);
    };

    const html = render(validationFailure());

    expect(triggers).toBe(0);
    expect(html).toContain('data-error-path="profile.title"');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror');
  });

  it('rejects accessor-backed validation carriers without invoking their getters', () => {
    let getterExecutions = 0;
    const payload = Object.defineProperty({}, 'issues', {
      get() {
        getterExecutions += 1;
        return [{ message: 'attacker', path: ['field'] }];
      },
    });
    const failure = {
      error: { code: 'VALIDATION', payload },
      ok: false,
      status: 422,
    } as MutationFail;

    expect(() => renderDefaultFailurePage(failure)).toThrow(/issues.*own data property/u);
    expect(getterExecutions).toBe(0);
  });
});

function validationFailure(): MutationFail {
  return {
    error: {
      code: 'VALIDATION',
      payload: {
        issues: [
          {
            message: '<script>alert(1)</script>',
            path: ['profile', 'title'],
          },
        ],
      },
    },
    ok: false,
    status: 422,
  };
}
