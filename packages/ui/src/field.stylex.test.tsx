import { describe, expect, it } from 'vitest';

import { trustedHtml } from '@kovojs/browser';
import * as style from '@kovojs/style';

import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldSelect,
  FieldSelectOption,
  FieldTextarea,
  Fieldset,
  FieldsetLegend,
  fieldStyles,
} from './field.js';

describe('@kovojs/ui Field StyleX styles', () => {
  it('matches semantic field markup with StyleX output', () => {
    const state = {
      invalid: true,
      required: true,
    };

    expect({
      classes: [style.attrs(fieldStyles.root).class ?? ''] as const,
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
      controlClasses: [style.attrs(fieldStyles.control).class ?? ''] as const,
      description: FieldDescription.definition.render({
        children: 'Used for notifications.',
        id: 'email-description',
      }),
      descriptionClasses: [style.attrs(fieldStyles.description).class ?? ''] as const,
      error: FieldError.definition.render({ children: 'Email required.', id: 'email-error' }),
      errorClasses: [style.attrs(fieldStyles.error).class ?? ''] as const,
      fieldset: Fieldset.definition.render({
        children: FieldsetLegend.definition.render({ children: 'Plan', id: 'plan-legend' }),
        descriptionId: 'plan-description',
        disabled: true,
        form: 'profile-form',
        id: 'plan-fieldset',
        invalid: true,
        name: 'plan-options',
      }),
      fieldsetClasses: [style.attrs(fieldStyles.fieldset).class ?? ''] as const,
      fieldsetLegendClasses: [style.attrs(fieldStyles.fieldsetLegend).class ?? ''] as const,
      label: FieldLabel.definition.render({
        ...state,
        children: 'Email',
        controlId: 'email',
        id: 'email-label',
      }),
      labelClasses: [style.attrs(fieldStyles.label).class ?? ''] as const,
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
      selectClasses: [style.attrs(fieldStyles.select).class ?? ''] as const,
      selectOption: FieldSelectOption.definition.render({
        children: 'Enterprise',
        disabled: true,
        selected: true,
        value: 'enterprise',
      }),
      selectOptionClasses: [style.attrs(fieldStyles.selectOption).class ?? ''] as const,
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
      textareaClasses: [style.attrs(fieldStyles.textarea).class ?? ''] as const,
    }).toMatchSnapshot();
  });

  it('matches author-last slot override output', () => {
    const overrides = style.create(
      {
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
      },
      { namespace: 'appField', source: 'app-field.tsx' },
    );

    expect({
      control: FieldControl.definition.render({ styles: { control: overrides.control } }),
      description: FieldDescription.definition.render({
        children: 'Custom description',
        styles: { description: overrides.description },
      }),
      error: FieldError.definition.render({
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

  it('exports StyleX style groups', () => {
    expect({
      keys: Object.keys(fieldStyles),
      markers: {
        control: fieldStyles.control.$$css,
        description: fieldStyles.description.$$css,
        error: fieldStyles.error.$$css,
        fieldset: fieldStyles.fieldset.$$css,
        fieldsetLegend: fieldStyles.fieldsetLegend.$$css,
        label: fieldStyles.label.$$css,
        root: fieldStyles.root.$$css,
        select: fieldStyles.select.$$css,
        selectOption: fieldStyles.selectOption.$$css,
        textarea: fieldStyles.textarea.$$css,
      },
    }).toMatchSnapshot();
  });
});
