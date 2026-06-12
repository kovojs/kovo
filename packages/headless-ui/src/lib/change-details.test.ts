import { describe, expect, it } from 'vitest';

import { createChangeDetail, dispatchCancelableChange } from './change-details.js';

describe('headless-ui change details', () => {
  it('carries a typed reason/value pair and starts uncanceled', () => {
    const detail = createChangeDetail({
      reason: 'trigger-click',
      value: true,
    });

    expect(detail.reason).toBe('trigger-click');
    expect(detail.value).toBe(true);
    expect(detail.defaultPrevented).toBe(false);
  });

  it('tracks preventDefault through the defaultPrevented contract', () => {
    const detail = createChangeDetail({
      reason: 'escape-key',
      value: false,
    });

    detail.preventDefault();

    expect(detail.defaultPrevented).toBe(true);
  });

  it('returns the detail after user change callbacks can cancel it', () => {
    const detail = dispatchCancelableChange({ reason: 'typeahead', value: 'Apple' }, (change) => {
      if (change.reason === 'typeahead') change.preventDefault();
    });

    expect(detail.defaultPrevented).toBe(true);
    expect(detail.value).toBe('Apple');
  });
});
