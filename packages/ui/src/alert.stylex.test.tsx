import { describe, expect, it } from 'vitest';

import * as style from '@kovojs/style';

import { Alert, alertStyles } from './alert.js';

describe('@kovojs/ui Alert StyleX styles', () => {
  it('renders default and variant StyleX classes', () => {
    expect({
      classes: [
        style.attrs(alertStyles.base.root, alertStyles.variants.info).class ?? '',
        style.attrs(alertStyles.variants.success).class ?? '',
        style.attrs(alertStyles.variants.warning).class ?? '',
        style.attrs(alertStyles.variants.danger).class ?? '',
        style.attrs(alertStyles.base.title).class ?? '',
      ] as const,
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
    const overrides = style.create(
      {
        root: {
          backgroundColor: '#312e81',
          borderColor: '#312e81',
          color: '#ffffff',
        },
      },
      { namespace: 'appAlert', source: 'app-alert.tsx' },
    );

    expect(
      Alert.definition.render({
        children: 'Custom',
        style: overrides.root,
        variant: 'warning',
      }),
    ).toMatchSnapshot();
  });

  it('exports StyleX style groups instead of variant helpers', () => {
    expect({
      base: Object.keys(alertStyles.base),
      baseMarkers: {
        root: alertStyles.base.root.$$css,
        title: alertStyles.base.title.$$css,
      },
      variantMarkers: {
        danger: alertStyles.variants.danger.$$css,
        info: alertStyles.variants.info.$$css,
        success: alertStyles.variants.success.$$css,
        warning: alertStyles.variants.warning.$$css,
      },
      variants: Object.keys(alertStyles.variants),
    }).toMatchSnapshot();
  });
});
