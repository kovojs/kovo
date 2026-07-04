import { describe, expect, it } from 'vitest';

import { trustedHtml } from '@kovojs/browser';
import * as style from '@kovojs/style';

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
      control: FieldControl.definition.render({
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
      description: FieldDescription.definition.render({
        children: 'Used for notifications.',
        id: 'email-description',
      }),
      error: FieldErrorMessage.definition.render({
        children: 'Email required.',
        id: 'email-error',
      }),
      fieldset: Fieldset.definition.render({
        children: FieldsetLegend.definition.render({ children: 'Plan', id: 'plan-legend' }),
        descriptionId: 'plan-description',
        disabled: true,
        form: 'profile-form',
        id: 'plan-fieldset',
        invalid: true,
        name: 'plan-options',
      }),
      label: FieldLabel.definition.render({
        ...state,
        children: 'Email',
        controlId: 'email',
        id: 'email-label',
      }),
      root: Field.definition.render({
        ...state,
        children: 'email field',
        id: 'email-field',
      }),
      select: FieldSelect.definition.render({
        children: trustedHtml(
          '<option value="starter">Starter</option><option value="team" selected>Team</option>',
        ) as unknown as string,
        descriptionId: 'plan-description',
        form: 'profile-form',
        id: 'plan',
        name: 'plan',
        required: true,
        value: 'team',
      }),
      selectOption: FieldSelectOption.definition.render({
        children: 'Enterprise',
        disabled: true,
        selected: true,
        value: 'enterprise',
      }),
      textarea: FieldTextarea.definition.render({
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
    const overrides = style.create({
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
      control: FieldControl.definition.render({ styles: { control: overrides.control } }),
      description: FieldDescription.definition.render({
        children: 'Custom description',
        styles: { description: overrides.description },
      }),
      error: FieldErrorMessage.definition.render({
        children: 'Custom error',
        styles: { error: overrides.error },
      }),
      fieldset: Fieldset.definition.render({
        children: FieldsetLegend.definition.render({
          children: 'Legend',
          styles: { fieldsetLegend: overrides.fieldsetLegend },
        }),
        styles: { fieldset: overrides.fieldset },
      }),
      label: FieldLabel.definition.render({
        children: 'Custom label',
        styles: { label: overrides.label },
      }),
      root: Field.definition.render({
        children: 'Custom field',
        styles: { root: overrides.root },
      }),
      select: FieldSelect.definition.render({ styles: { select: overrides.select } }),
      selectOption: FieldSelectOption.definition.render({
        children: 'Custom option',
        styles: { selectOption: overrides.selectOption },
      }),
      textarea: FieldTextarea.definition.render({ styles: { textarea: overrides.textarea } }),
    }).toMatchSnapshot();
  });
});
