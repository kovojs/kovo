import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import * as style from '@kovojs/style';

import { Alert } from './alert.js';

describe('@kovojs/ui Alert StyleX styles', () => {
  it('renders default and variant StyleX classes', () => {
    expect({
      danger: renderUiComponent(Alert, {
        children: 'Payment method required.',
        role: 'alert',
        title: 'Billing issue',
        variant: 'danger',
      }),
      info: renderUiComponent(Alert, { children: 'Queued.' }),
      success: renderUiComponent(Alert, {
        children: 'Imported.',
        title: 'Import complete',
        variant: 'success',
      }),
    }).toMatchSnapshot();
  });

  it('accepts author-last StyleX overrides', () => {
    const overrides = style.create({
      root: {
        backgroundColor: '#312e81',
        borderColor: '#312e81',
        color: '#ffffff',
      },
    });

    expect(
      renderUiComponent(Alert, {
        children: 'Custom',
        style: overrides.root,
        variant: 'warning',
      }),
    ).toMatchSnapshot();
  });
});
