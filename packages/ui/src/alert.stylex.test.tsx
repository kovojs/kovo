import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Alert } from './alert.js';

describe('@kovojs/ui Alert StyleX styles', () => {
  it('renders default and variant StyleX classes', () => {
    expect({
      danger: Alert.definition.render({
        children: 'Payment method required.',
        role: 'alert',
        title: 'Billing issue',
        variant: 'danger',
      }),
      info: Alert.definition.render({ children: 'Queued.' }),
      success: Alert.definition.render({
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
      Alert.definition.render({
        children: 'Custom',
        style: overrides.root,
        variant: 'warning',
      }),
    ).toMatchSnapshot();
  });
});
