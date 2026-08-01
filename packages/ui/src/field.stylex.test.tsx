import { describe, expect, it } from 'vitest';
import { renderUiComponent } from './test-component-render.js';

import { trustedHtml } from '@kovojs/browser';
import { createWithSource } from '@kovojs/style/internal';

import {
  Field,
  FieldControl,
  FieldDescription,
  FieldErrorMessage,
  FieldLabel,
  FieldSelect,
  FieldSelectOption,
  FieldTextarea,
  Fieldset,
  FieldsetLegend,
} from './field.js';

describe('@kovojs/ui Field StyleX styles', () => {
  it('matches semantic field markup with StyleX output', () => {
    const state = {
      invalid: true,
      required: true,
    };

    expect({
      control: renderUiComponent(FieldControl, {
        ...state,
        autoComplete: 'email',
        descriptionId: 'email-description',
        errorId: 'email-error',
        form: 'profile-form',
        id: 'email',
        inputMode: 'email',
        maxLength: 80,
        minLength: 3,
        name: 'email',
        pattern: '.+@example\\.com',
        placeholder: 'ada@example.com',
        type: 'email',
        value: 'ada@example.com',
      }),
      description: renderUiComponent(FieldDescription, {
        children: 'Used for notifications.',
        id: 'email-description',
      }),
      error: renderUiComponent(FieldErrorMessage, {
        children: 'Email required.',
        id: 'email-error',
      }),
      fieldset: renderUiComponent(Fieldset, {
        children: renderUiComponent(FieldsetLegend, { children: 'Plan', id: 'plan-legend' }),
        descriptionId: 'plan-description',
        disabled: true,
        form: 'profile-form',
        id: 'plan-fieldset',
        invalid: true,
        name: 'plan-options',
      }),
      label: renderUiComponent(FieldLabel, {
        ...state,
        children: 'Email',
        controlId: 'email',
        id: 'email-label',
      }),
      root: renderUiComponent(Field, {
        ...state,
        children: 'email field',
        id: 'email-field',
      }),
      select: renderUiComponent(FieldSelect, {
        children: trustedHtml(
          '<option value="starter">Starter</option><option value="team" selected>Team</option>',
          { reason: 'UI rendering test fixture' },
        ) as unknown as string,
        descriptionId: 'plan-description',
        form: 'profile-form',
        id: 'plan',
        name: 'plan',
        required: true,
        value: 'team',
      }),
      selectOption: renderUiComponent(FieldSelectOption, {
        children: 'Enterprise',
        disabled: true,
        selected: true,
        value: 'enterprise',
      }),
      textarea: renderUiComponent(FieldTextarea, {
        autoComplete: 'off',
        descriptionId: 'bio-description',
        form: 'profile-form',
        id: 'bio',
        maxLength: 240,
        name: 'bio',
        placeholder: 'Short bio',
        rows: 4,
      }),
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = createWithSource('field.stylex.test.tsx')({
      control: { backgroundColor: '#eff6ff' },
      description: { color: '#1d4ed8' },
      error: { color: '#991b1b' },
      fieldset: { borderColor: '#2563eb' },
      fieldsetLegend: { color: '#1e40af' },
      label: { color: '#1d4ed8' },
      root: { rowGap: 12 },
      select: { backgroundColor: '#eff6ff' },
      selectOption: { color: '#1d4ed8' },
      textarea: { backgroundColor: '#eff6ff' },
    });

    expect({
      control: renderUiComponent(FieldControl, { styles: { control: overrides.control } }),
      description: renderUiComponent(FieldDescription, {
        children: 'Custom description',
        styles: { description: overrides.description },
      }),
      error: renderUiComponent(FieldErrorMessage, {
        children: 'Custom error',
        styles: { error: overrides.error },
      }),
      fieldset: renderUiComponent(Fieldset, {
        children: renderUiComponent(FieldsetLegend, {
          children: 'Legend',
          styles: { fieldsetLegend: overrides.fieldsetLegend },
        }),
        styles: { fieldset: overrides.fieldset },
      }),
      label: renderUiComponent(FieldLabel, {
        children: 'Custom label',
        styles: { label: overrides.label },
      }),
      root: renderUiComponent(Field, {
        children: 'Custom field',
        styles: { root: overrides.root },
      }),
      select: renderUiComponent(FieldSelect, { styles: { select: overrides.select } }),
      selectOption: renderUiComponent(FieldSelectOption, {
        children: 'Custom option',
        styles: { selectOption: overrides.selectOption },
      }),
      textarea: renderUiComponent(FieldTextarea, { styles: { textarea: overrides.textarea } }),
    }).toMatchSnapshot();
  });
});
