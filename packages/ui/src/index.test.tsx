import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  Alert,
  Autocomplete,
  AutocompleteInput,
  AutocompleteList,
  AutocompleteOption,
  AutocompleteValue,
  Badge,
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbSeparator,
  Button,
  Card,
  Checkbox,
  CheckboxGroup,
  CheckboxGroupControl,
  CheckboxGroupItem,
  CheckboxGroupLabel,
  Combobox,
  ComboboxInput,
  ComboboxListbox,
  ComboboxOption,
  ComboboxValue,
  Drawer,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
  Fieldset,
  FieldsetLegend,
  Kbd,
  NumberField,
  NumberFieldControl,
  NumberFieldDecrement,
  NumberFieldIncrement,
  NumberFieldInput,
  OtpField,
  OtpFieldGroup,
  OtpFieldHiddenInput,
  OtpFieldInput,
  RadioGroup,
  RadioGroupItem,
  RadioGroupLabel,
  RadioGroupRadio,
  ScrollArea,
  ScrollAreaCorner,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Sheet,
  Skeleton,
  Slider,
  SliderInput,
  SliderRange,
  SliderThumb,
  SliderTrack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTrigger,
  Toggle,
  ToggleGroup,
  ToggleGroupButton,
  ToggleGroupItem,
  Toast,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastTitle,
  ToastViewport,
  Toolbar,
  ToolbarButton,
  ToolbarItem,
  breadcrumbClasses,
  buttonClasses,
  autocompleteClasses,
  autocompleteInputClasses,
  autocompleteListClasses,
  autocompleteOptionClasses,
  autocompleteValueClasses,
  checkboxGroupClasses,
  checkboxGroupControlClasses,
  checkboxGroupItemClasses,
  checkboxGroupLabelClasses,
  checkboxClasses,
  comboboxClasses,
  comboboxInputClasses,
  comboboxListboxClasses,
  comboboxOptionClasses,
  comboboxValueClasses,
  fieldClasses,
  fieldControlClasses,
  fieldDescriptionClasses,
  fieldErrorClasses,
  fieldLabelClasses,
  fieldsetClasses,
  fieldsetLegendClasses,
  numberFieldButtonClasses,
  numberFieldClasses,
  numberFieldControlClasses,
  numberFieldInputClasses,
  otpFieldClasses,
  otpFieldGroupClasses,
  otpFieldHiddenInputClasses,
  otpFieldInputClasses,
  radioGroupClasses,
  radioGroupItemClasses,
  radioGroupLabelClasses,
  radioGroupRadioClasses,
  scrollAreaClasses,
  scrollAreaCornerClasses,
  scrollAreaScrollbarClasses,
  scrollAreaThumbClasses,
  scrollAreaViewportClasses,
  selectClasses,
  selectContentClasses,
  selectItemClasses,
  selectTriggerClasses,
  selectValueClasses,
  tabsClasses,
  tabsListClasses,
  tabsPanelClasses,
  tabsTriggerClasses,
  sheetContentClasses,
  switchClasses,
  tableClasses,
  sliderClasses,
  sliderInputClasses,
  sliderRangeClasses,
  sliderThumbClasses,
  sliderTrackClasses,
  toggleClasses,
  toggleGroupButtonClasses,
  toggleGroupClasses,
  toggleGroupItemClasses,
  toastActionClasses,
  toastClasses,
  toastCloseClasses,
  toastDescriptionClasses,
  toastTitleClasses,
  toastViewportClasses,
  toolbarButtonClasses,
  toolbarClasses,
  toolbarItemClasses,
} from './index.js';

const sourceDir = dirname(fileURLToPath(import.meta.url));

function readSource(name: string): string {
  return readFileSync(join(sourceDir, name), 'utf8');
}

describe('@jiso/ui styled package foundation', () => {
  it('exports pure-markup button, badge, and card TSX components', () => {
    expect(Button.name).toBe('button');
    expect(Badge.name).toBe('badge');
    expect(Card.name).toBe('card');
    expect(Checkbox.name).toBe('checkbox');
    expect(CheckboxGroup.name).toBe('checkbox-group');
    expect(Kbd.name).toBe('kbd');
    expect(Alert.name).toBe('alert');
    expect(Skeleton.name).toBe('skeleton');
    expect(Switch.name).toBe('switch');
    expect(RadioGroup.name).toBe('radio-group');
    expect(Tabs.name).toBe('tabs');
    expect(Toggle.name).toBe('toggle');
    expect(ToggleGroup.name).toBe('toggle-group');
    expect(Toolbar.name).toBe('toolbar');
    expect(NumberField.name).toBe('number-field');
    expect(OtpField.name).toBe('otp-field');
    expect(ScrollArea.name).toBe('scroll-area');
    expect(Field.name).toBe('field');
    expect(Select.name).toBe('select');
    expect(Combobox.name).toBe('combobox');
    expect(Autocomplete.name).toBe('autocomplete');
    expect(Slider.name).toBe('slider');
    expect(Toast.name).toBe('toast');

    expect(
      Button.definition.render({
        children: 'Save',
        class: ['tracking-wide', { uppercase: true }],
        disabled: true,
        size: 'sm',
        type: 'submit',
        variant: 'secondary',
      }),
    ).toContain(
      '<button class="inline-flex items-center justify-center rounded-md border text-sm font-medium transition-colors',
    );
    expect(Button.definition.render({ children: 'Save', disabled: true })).toContain(
      ' disabled type="button"',
    );
    expect(Button.definition.render({ children: 'Save', size: 'sm' })).toContain('h-8 gap-1.5');
    expect(Badge.definition.render({ children: 'Live', variant: 'success' })).toContain(
      'bg-emerald-50',
    );
    expect(Card.definition.render({ children: '<p>Total</p>' })).toBe(
      '<section class="rounded-lg border border-neutral-200 bg-white p-4 text-neutral-950 shadow-sm"><p>Total</p></section>',
    );
    expect(Kbd.definition.render({ children: 'Ctrl K', class: 'uppercase' })).toContain(
      '<kbd class="inline-flex h-5 min-w-5',
    );
    expect(Kbd.definition.render({ children: 'Ctrl K', class: 'uppercase' })).toContain(
      'uppercase',
    );
    expect(
      Alert.definition.render({
        children: 'Payment method required.',
        role: 'alert',
        title: 'Billing issue',
        variant: 'danger',
      }),
    ).toContain('role="alert"><strong class="font-medium">Billing issue</strong>');
    expect(Alert.definition.render({ children: 'Saved.', variant: 'success' })).toContain(
      'border-emerald-200 bg-emerald-50',
    );
    expect(Skeleton.definition.render({ class: 'h-4 w-32' })).toBe(
      '<div aria-hidden="true" class="animate-pulse rounded-md bg-neutral-200 h-4 w-32"></div>',
    );
    expect(buttonClasses).toContain('h-9 gap-2 px-3');
    expect(checkboxClasses.join(' ')).toContain('inline-flex items-center gap-2');
    expect(checkboxGroupClasses.join(' ')).toContain('data-[orientation=horizontal]:flex');
    expect(radioGroupClasses.join(' ')).toContain('data-[orientation=horizontal]:flex');
    expect(switchClasses.join(' ')).toContain('inline-flex items-center gap-2');
    expect(tabsClasses.join(' ')).toContain('w-full text-neutral-950');
    expect(toggleClasses.join(' ')).toContain('data-[state=pressed]:bg-neutral-950');
    expect(toggleGroupClasses.join(' ')).toContain('data-[orientation=vertical]:flex-col');
    expect(toolbarClasses.join(' ')).toContain('data-[orientation=vertical]:flex-col');
    expect(numberFieldClasses.join(' ')).toContain('data-[invalid]:text-red-950');
    expect(otpFieldClasses.join(' ')).toContain('data-[invalid]:text-red-950');
    expect(scrollAreaClasses.join(' ')).toContain('relative overflow-hidden');
    expect(fieldClasses.join(' ')).toContain('data-[required]');
    expect(selectClasses.join(' ')).toContain('data-[invalid]:text-red-950');
    expect(selectTriggerClasses.join(' ')).toContain('data-[placeholder]:text-neutral-500');
    expect(comboboxClasses.join(' ')).toContain('data-[invalid]:text-red-950');
    expect(comboboxListboxClasses.join(' ')).toContain('data-[state=closed]');
    expect(comboboxInputClasses.join(' ')).toContain('aria-[invalid=true]:border-red-400');
    expect(autocompleteClasses.join(' ')).toContain('data-[invalid]:text-red-950');
    expect(autocompleteInputClasses.join(' ')).toContain('focus-visible:ring-2');
    expect(sliderClasses.join(' ')).toContain('data-[orientation=vertical]:inline-grid');
    expect(sliderInputClasses.join(' ')).toContain('accent-neutral-950');
    expect(toastClasses.join(' ')).toContain('data-[variant=success]:bg-emerald-50');
    expect(toastViewportClasses.join(' ')).toContain('data-[placement=bottom-end]');
  });

  it('wraps the headless checkbox-group primitive as styled native checkboxes', () => {
    const items = [
      { value: 'updates' },
      { value: 'billing' },
      { disabled: true, value: 'security' },
    ];
    const state = {
      descriptionId: 'notifications-help',
      items,
      name: 'notifications',
      required: true,
      value: ['updates'] as const,
    };

    const root = CheckboxGroup.definition.render({
      ...state,
      children: 'checkbox options',
      errorId: 'notifications-error',
      id: 'notifications',
      invalid: true,
      labelledBy: 'notifications-label',
    });
    const item = CheckboxGroupItem.definition.render({
      ...state,
      children: 'updates input',
      itemValue: 'updates',
    });
    const control = CheckboxGroupControl.definition.render({
      ...state,
      controlId: 'notifications-updates',
      itemValue: 'updates',
    });
    const disabledControl = CheckboxGroupControl.definition.render({
      ...state,
      controlId: 'notifications-security',
      itemValue: 'security',
    });
    const label = CheckboxGroupLabel.definition.render({
      ...state,
      children: 'Product updates',
      controlId: 'notifications-updates',
      itemValue: 'updates',
    });

    expect(CheckboxGroupItem.name).toBe('checkbox-group-item');
    expect(CheckboxGroupControl.name).toBe('checkbox-group-control');
    expect(CheckboxGroupLabel.name).toBe('checkbox-group-label');
    expect(root).toContain('aria-describedby="notifications-help notifications-error"');
    expect(root).toContain('aria-invalid="true"');
    expect(root).toContain('aria-required="true"');
    expect(root).toContain('role="group"');
    expect(item).toContain('data-state="checked"');
    expect(control).toContain('aria-checked="true" checked');
    expect(control).toContain('id="notifications-updates" name="notifications" required');
    expect(control).toContain('tabIndex="0" type="checkbox" value="updates"');
    expect(disabledControl).toContain('data-disabled="" data-state="unchecked" disabled');
    expect(disabledControl).toContain('id="notifications-security"');
    expect(disabledControl).toContain('tabIndex="-1" type="checkbox" value="security"');
    expect(label).toContain('for="notifications-updates"');
    expect(checkboxGroupItemClasses.join(' ')).toContain('data-[disabled]:opacity-50');
    expect(checkboxGroupControlClasses.join(' ')).toContain('accent-neutral-950');
    expect(checkboxGroupLabelClasses.join(' ')).toContain('select-none');
  });

  it('wraps the headless radio-group primitive as styled native radios', () => {
    const items = [
      { value: 'standard' },
      { value: 'express' },
      { disabled: true, value: 'freight' },
    ];
    const state = {
      descriptionId: 'shipping-help',
      items,
      name: 'shipping-speed',
      required: true,
      value: 'express',
    };

    const root = RadioGroup.definition.render({
      ...state,
      children: 'radio options',
      id: 'shipping-speed',
      invalid: true,
    });
    const item = RadioGroupItem.definition.render({
      ...state,
      children: 'express input',
      itemValue: 'express',
    });
    const radio = RadioGroupRadio.definition.render({
      ...state,
      controlId: 'shipping-express',
      itemValue: 'express',
    });
    const disabledRadio = RadioGroupRadio.definition.render({
      ...state,
      controlId: 'shipping-freight',
      itemValue: 'freight',
    });
    const label = RadioGroupLabel.definition.render({
      ...state,
      children: 'Express',
      controlId: 'shipping-express',
      itemValue: 'express',
    });

    expect(RadioGroupItem.name).toBe('radio-group-item');
    expect(RadioGroupRadio.name).toBe('radio-group-radio');
    expect(RadioGroupLabel.name).toBe('radio-group-label');
    expect(root).toContain('aria-describedby="shipping-help"');
    expect(root).toContain('aria-invalid="true"');
    expect(root).toContain('aria-required="true"');
    expect(root).toContain('role="radiogroup"');
    expect(item).toContain('data-state="checked"');
    expect(radio).toContain('aria-checked="true" checked');
    expect(radio).toContain('id="shipping-express" name="shipping-speed" required');
    expect(radio).toContain('tabIndex="0" type="radio" value="express"');
    expect(disabledRadio).toContain('data-disabled=""');
    expect(disabledRadio).toContain('disabled id="shipping-freight"');
    expect(disabledRadio).toContain('tabIndex="-1" type="radio" value="freight"');
    expect(label).toContain('for="shipping-express"');
    expect(radioGroupItemClasses.join(' ')).toContain('data-[disabled]:opacity-50');
    expect(radioGroupRadioClasses.join(' ')).toContain('accent-neutral-950');
    expect(radioGroupLabelClasses.join(' ')).toContain('select-none');
  });

  it('wraps headless form-control primitives as styled native controls', () => {
    const checkbox = Checkbox.definition.render({
      checked: 'indeterminate',
      children: 'Some permissions',
      name: 'permissions',
      required: true,
      value: 'partial',
    });
    const switchControl = Switch.definition.render({
      checked: true,
      children: 'Notifications',
      name: 'notifications',
      value: 'enabled',
    });
    const toggle = Toggle.definition.render({
      children: 'Bold',
      pressed: true,
      variant: 'subtle',
    });

    expect(checkbox).toContain('data-state="indeterminate"');
    expect(checkbox).toContain('aria-checked="mixed"');
    expect(checkbox).toContain('required type="checkbox" value="partial"');
    expect(checkbox).toContain('Some permissions</label>');
    expect(switchControl).toContain('data-state="checked"');
    expect(switchControl).toContain('aria-checked="true" checked');
    expect(switchControl).toContain('role="switch" type="checkbox" value="enabled"');
    expect(toggle).toContain('data-state="pressed"');
    expect(toggle).toContain('aria-pressed="true"');
    expect(toggle).toContain('border-transparent bg-neutral-100');
  });

  it('wraps the headless toggle-group primitive as styled roving buttons', () => {
    const items = [{ value: 'bold' }, { value: 'italic' }, { disabled: true, value: 'strike' }];
    const state = {
      activeValue: 'bold',
      items,
      type: 'multiple' as const,
      value: ['bold'] as const,
    };

    const root = ToggleGroup.definition.render({
      ...state,
      children: 'format controls',
      descriptionId: 'format-help',
      id: 'formatting',
      labelledBy: 'format-label',
      orientation: 'vertical',
    });
    const item = ToggleGroupItem.definition.render({
      ...state,
      children: 'bold button',
      id: 'bold-item',
      itemValue: 'bold',
    });
    const button = ToggleGroupButton.definition.render({
      ...state,
      children: 'Bold',
      id: 'bold-button',
      itemValue: 'bold',
    });
    const disabledButton = ToggleGroupButton.definition.render({
      ...state,
      children: 'Strike',
      itemValue: 'strike',
    });

    expect(ToggleGroupItem.name).toBe('toggle-group-item');
    expect(ToggleGroupButton.name).toBe('toggle-group-button');
    expect(root).toContain('aria-describedby="format-help"');
    expect(root).toContain('aria-labelledby="format-label"');
    expect(root).toContain('data-orientation="vertical" id="formatting" role="group"');
    expect(item).toContain('data-state="pressed" id="bold-item"');
    expect(button).toContain('aria-pressed="true"');
    expect(button).toContain('data-state="pressed"');
    expect(button).toContain('id="bold-button" tabIndex="0" type="button" value="bold"');
    expect(disabledButton).toContain('aria-pressed="false"');
    expect(disabledButton).toContain('data-disabled="" data-state="off" disabled');
    expect(disabledButton).toContain('tabIndex="-1" type="button" value="strike"');
    expect(toggleGroupItemClasses.join(' ')).toContain('data-[disabled]:opacity-50');
    expect(toggleGroupButtonClasses.join(' ')).toContain('data-[state=pressed]:bg-white');
  });

  it('wraps the headless toolbar primitive as styled roving controls', () => {
    const items = [{ value: 'bold' }, { value: 'italic' }, { disabled: true, value: 'link' }];
    const state = {
      activeValue: 'bold',
      items,
      orientation: 'vertical' as const,
    };

    const root = Toolbar.definition.render({
      ...state,
      children: 'format controls',
      descriptionId: 'format-help',
      id: 'formatting-toolbar',
      labelledBy: 'format-label',
    });
    const item = ToolbarItem.definition.render({
      ...state,
      children: 'bold button',
      id: 'bold-item',
      itemValue: 'bold',
    });
    const button = ToolbarButton.definition.render({
      ...state,
      children: 'Bold',
      id: 'bold-button',
      itemValue: 'bold',
      pressed: true,
    });
    const disabledButton = ToolbarButton.definition.render({
      ...state,
      children: 'Link',
      itemValue: 'link',
      pressed: false,
    });

    expect(ToolbarItem.name).toBe('toolbar-item');
    expect(ToolbarButton.name).toBe('toolbar-button');
    expect(root).toContain('aria-describedby="format-help"');
    expect(root).toContain('aria-labelledby="format-label"');
    expect(root).toContain('aria-orientation="vertical"');
    expect(root).toContain('data-orientation="vertical" id="formatting-toolbar" role="toolbar"');
    expect(item).toContain('id="bold-item"');
    expect(button).toContain('aria-pressed="true"');
    expect(button).toContain('data-pressed="true"');
    expect(button).toContain('id="bold-button" tabIndex="0" type="button" value="bold"');
    expect(disabledButton).toContain('aria-pressed="false"');
    expect(disabledButton).toContain('data-disabled="" data-pressed="false" disabled');
    expect(disabledButton).toContain('tabIndex="-1" type="button" value="link"');
    expect(toolbarItemClasses.join(' ')).toContain('data-[disabled]:opacity-50');
    expect(toolbarButtonClasses.join(' ')).toContain('data-[pressed=true]:bg-neutral-950');
  });

  it('wraps the headless number-field primitive as a styled native number input', () => {
    const state = {
      invalid: true,
      max: 10,
      min: 0,
      name: 'quantity',
      required: true,
      step: 2,
      value: 2,
    };

    const root = NumberField.definition.render({
      ...state,
      children: 'quantity controls',
      id: 'quantity-field',
    });
    const control = NumberFieldControl.definition.render({
      ...state,
      children: 'stepper',
      id: 'quantity-control',
    });
    const decrement = NumberFieldDecrement.definition.render({
      ...state,
      id: 'quantity-decrement',
      inputId: 'quantity-input',
      label: 'Decrease quantity',
    });
    const input = NumberFieldInput.definition.render({
      ...state,
      descriptionId: 'quantity-description',
      errorId: 'quantity-error',
      id: 'quantity-input',
      labelledBy: 'quantity-label',
    });
    const increment = NumberFieldIncrement.definition.render({
      ...state,
      id: 'quantity-increment',
      inputId: 'quantity-input',
      label: 'Increase quantity',
    });
    const disabledAtMax = NumberFieldIncrement.definition.render({
      max: 10,
      value: 10,
    });

    expect(NumberFieldControl.name).toBe('number-field-control');
    expect(NumberFieldDecrement.name).toBe('number-field-decrement');
    expect(NumberFieldInput.name).toBe('number-field-input');
    expect(NumberFieldIncrement.name).toBe('number-field-increment');
    expect(root).toContain('data-invalid="" data-required="" id="quantity-field"');
    expect(control).toContain('data-invalid="" data-required="" id="quantity-control"');
    expect(decrement).toContain('aria-controls="quantity-input"');
    expect(decrement).toContain('aria-label="Decrease quantity"');
    expect(decrement).toContain('data-action="decrement"');
    expect(input).toContain('aria-describedby="quantity-description quantity-error"');
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain('id="quantity-input" max="10" min="0" name="quantity" required');
    expect(input).toContain('step="2" type="number" value="2"');
    expect(increment).toContain('data-action="increment"');
    expect(disabledAtMax).toContain('data-disabled=""');
    expect(disabledAtMax).toContain('disabled type="button"');
    expect(numberFieldControlClasses.join(' ')).toContain('inline-flex h-9');
    expect(numberFieldInputClasses.join(' ')).toContain('text-center');
    expect(numberFieldButtonClasses.join(' ')).toContain('data-[action=increment]:border-l');
  });

  it('wraps the headless otp-field primitive as styled aggregate and slot inputs', () => {
    const state = {
      descriptionId: 'otp-description',
      errorId: 'otp-error',
      invalid: true,
      labelledBy: 'otp-label',
      length: 6,
      name: 'otp-code',
      pattern: '[0-9]*',
      required: true,
      value: '1234',
    };

    const root = OtpField.definition.render({
      ...state,
      children: 'otp controls',
      id: 'otp-field',
    });
    const group = OtpFieldGroup.definition.render({ children: 'slots' });
    const hidden = OtpFieldHiddenInput.definition.render({ ...state, id: 'otp-code' });
    const firstSlot = OtpFieldInput.definition.render({
      ...state,
      id: 'otp-slot-1',
      label: 'One-time code digit 1',
      slotIndex: 0,
    });
    const emptySlot = OtpFieldInput.definition.render({
      ...state,
      id: 'otp-slot-6',
      slotIndex: 5,
    });
    const completeDisabled = OtpField.definition.render({
      disabled: true,
      length: 4,
      value: '9876',
    });

    expect(OtpFieldGroup.name).toBe('otp-field-group');
    expect(OtpFieldHiddenInput.name).toBe('otp-field-hidden-input');
    expect(OtpFieldInput.name).toBe('otp-field-input');
    expect(root).toContain('aria-describedby="otp-description otp-error"');
    expect(root).toContain('aria-invalid="true"');
    expect(root).toContain('aria-required="true"');
    expect(root).toContain('role="group"');
    expect(group).toContain('flex items-center gap-2');
    expect(hidden).toContain('aria-hidden="true"');
    expect(hidden).toContain('data-slot="hidden-input"');
    expect(hidden).toContain('autoComplete="one-time-code"');
    expect(hidden).toContain('name="otp-code"');
    expect(hidden).toContain('readOnly required tabIndex="-1" type="text" value="1234"');
    expect(firstSlot).toContain('aria-label="One-time code digit 1"');
    expect(firstSlot).toContain('data-filled=""');
    expect(firstSlot).toContain('data-slot="0"');
    expect(firstSlot).toContain('maxLength="1"');
    expect(emptySlot).toContain('data-slot="5"');
    expect(completeDisabled).toContain('data-complete="" data-disabled=""');
    expect(otpFieldGroupClasses.join(' ')).toContain('flex items-center gap-2');
    expect(otpFieldHiddenInputClasses.join(' ')).toContain('sr-only');
    expect(otpFieldInputClasses.join(' ')).toContain('data-[filled]:border-neutral-500');
  });

  it('wraps the headless scroll-area primitive as styled native scrolling parts', () => {
    const state = {
      dir: 'ltr' as const,
      scrollbars: 'both' as const,
    };

    const root = ScrollArea.definition.render({
      ...state,
      children: 'viewport and scrollbars',
      id: 'activity',
    });
    const viewport = ScrollAreaViewport.definition.render({
      ...state,
      children: 'feed',
      descriptionId: 'activity-description',
      id: 'activity-viewport',
      labelledBy: 'activity-title',
    });
    const verticalScrollbar = ScrollAreaScrollbar.definition.render({
      ...state,
      children: 'thumb',
      id: 'activity-scrollbar-y',
      orientation: 'vertical',
      visible: true,
    });
    const hiddenThumb = ScrollAreaThumb.definition.render({
      ...state,
      forceMount: true,
      id: 'activity-thumb-x',
      orientation: 'horizontal',
      visible: false,
    });
    const corner = ScrollAreaCorner.definition.render({ ...state, id: 'activity-corner' });
    const disabledViewport = ScrollAreaViewport.definition.render({
      disabled: true,
      label: 'Archived feed',
      scrollbars: 'vertical',
    });

    expect(ScrollAreaViewport.name).toBe('scroll-area-viewport');
    expect(ScrollAreaScrollbar.name).toBe('scroll-area-scrollbar');
    expect(ScrollAreaThumb.name).toBe('scroll-area-thumb');
    expect(ScrollAreaCorner.name).toBe('scroll-area-corner');
    expect(root).toContain('data-scrollbars="both" dir="ltr" id="activity"');
    expect(viewport).toContain('aria-describedby="activity-description"');
    expect(viewport).toContain('aria-labelledby="activity-title"');
    expect(viewport).toContain('role="region" tabIndex="0"');
    expect(verticalScrollbar).toContain('aria-hidden="true"');
    expect(verticalScrollbar).toContain('data-orientation="vertical"');
    expect(verticalScrollbar).toContain('data-state="visible"');
    expect(hiddenThumb).toContain('data-orientation="horizontal"');
    expect(hiddenThumb).toContain('data-state="hidden"');
    expect(corner).toContain('id="activity-corner"');
    expect(disabledViewport).toContain('aria-disabled="true"');
    expect(disabledViewport).toContain('tabIndex="-1"');
    expect(scrollAreaViewportClasses.join(' ')).toContain('overflow-auto');
    expect(scrollAreaScrollbarClasses.join(' ')).toContain('data-[orientation=vertical]:w-2.5');
    expect(scrollAreaThumbClasses.join(' ')).toContain('rounded-full bg-neutral-400');
    expect(scrollAreaCornerClasses.join(' ')).toContain('absolute bottom-0 right-0');
  });

  it('wraps field and fieldset primitives as styled native form wiring', () => {
    const state = {
      invalid: true,
      required: true,
    };

    const root = Field.definition.render({
      ...state,
      children: 'email field',
      id: 'email-field',
    });
    const label = FieldLabel.definition.render({
      ...state,
      children: 'Email',
      controlId: 'email',
      id: 'email-label',
    });
    const control = FieldControl.definition.render({
      ...state,
      descriptionId: 'email-description',
      errorId: 'email-error',
      id: 'email',
      name: 'email',
      type: 'email',
    });
    const description = FieldDescription.definition.render({
      children: 'Used for notifications.',
      id: 'email-description',
    });
    const error = FieldError.definition.render({ children: 'Email required.', id: 'email-error' });
    const fieldset = Fieldset.definition.render({
      children: FieldsetLegend.definition.render({ children: 'Plan', id: 'plan-legend' }),
      descriptionId: 'plan-description',
      id: 'plan-fieldset',
      invalid: true,
    });

    expect(FieldLabel.name).toBe('field-label');
    expect(FieldControl.name).toBe('field-control');
    expect(FieldDescription.name).toBe('field-description');
    expect(FieldError.name).toBe('field-error');
    expect(Fieldset.name).toBe('fieldset');
    expect(FieldsetLegend.name).toBe('fieldset-legend');
    expect(root).toContain('data-invalid="" data-required="" id="email-field"');
    expect(label).toContain('for="email" id="email-label"');
    expect(control).toContain('aria-describedby="email-description email-error"');
    expect(control).toContain('aria-invalid="true"');
    expect(control).toContain('id="email" name="email" required type="email"');
    expect(description).toContain('id="email-description"');
    expect(error).toContain('role="alert"');
    expect(fieldset).toContain('aria-describedby="plan-description"');
    expect(fieldset).toContain('aria-invalid="true"');
    expect(fieldset).toContain('id="plan-fieldset"');
    expect(fieldset).toContain('id="plan-legend"');
    expect(fieldLabelClasses.join(' ')).toContain('text-sm font-medium');
    expect(fieldControlClasses.join(' ')).toContain('aria-[invalid=true]:border-red-500');
    expect(fieldDescriptionClasses.join(' ')).toContain('text-neutral-500');
    expect(fieldErrorClasses.join(' ')).toContain('text-red-600');
    expect(fieldsetClasses.join(' ')).toContain('rounded-md border border-neutral-200');
    expect(fieldsetLegendClasses.join(' ')).toContain('px-1 text-sm font-medium');
  });

  it('exports table primitives as styled semantic markup', () => {
    expect(Table.name).toBe('table');
    expect(TableHead.name).toBe('table-head');
    expect(TableBody.name).toBe('table-body');
    expect(TableRow.name).toBe('table-row');
    expect(TableHeaderCell.name).toBe('table-header-cell');
    expect(TableCell.name).toBe('table-cell');

    expect(Table.definition.render({ caption: 'Invoices', children: '<tbody></tbody>' })).toContain(
      '<caption class="mt-3 text-sm text-neutral-500">Invoices</caption><tbody></tbody>',
    );
    expect(TableHeaderCell.definition.render({ children: 'Status', scope: 'row' })).toContain(
      '<th class="h-10 px-3 text-left align-middle font-medium text-neutral-700" scope="row">',
    );
    expect(TableCell.definition.render({ children: '$250.00', colSpan: 2 })).toContain(
      'colspan="2"',
    );
    expect(tableClasses).toContain('w-full overflow-x-auto');
  });

  it('wraps the headless select primitive as styled native select markup', () => {
    const items = [
      { label: 'Starter', value: 'starter' },
      { label: 'Growth', value: 'growth' },
      { disabled: true, label: 'Enterprise', value: 'enterprise' },
    ];
    const state = {
      descriptionId: 'plan-help',
      errorId: 'plan-error',
      invalid: true,
      items,
      name: 'plan',
      required: true,
      value: 'growth',
    };

    const root = Select.definition.render({ ...state, children: 'select body', id: 'plan-root' });
    const trigger = SelectTrigger.definition.render({
      ...state,
      children: SelectContent.definition.render({
        ...state,
        children: items
          .map((item) =>
            SelectItem.definition.render({
              ...state,
              itemLabel: item.label,
              itemValue: item.value,
            }),
          )
          .join(''),
        label: 'Plans',
      }),
      id: 'plan',
      labelledBy: 'plan-label',
    });
    const value = SelectValue.definition.render({ ...state, id: 'plan-value' });

    expect(SelectTrigger.name).toBe('select-trigger');
    expect(SelectContent.name).toBe('select-content');
    expect(SelectItem.name).toBe('select-item');
    expect(SelectValue.name).toBe('select-value');
    expect(root).toContain('data-invalid="" data-required="" data-state="closed" id="plan-root"');
    expect(trigger).toContain('aria-describedby="plan-help plan-error"');
    expect(trigger).toContain('aria-expanded="false"');
    expect(trigger).toContain('aria-invalid="true"');
    expect(trigger).toContain('id="plan" name="plan" required');
    expect(trigger).toContain('<optgroup');
    expect(trigger).toContain('label="Plans"');
    expect(trigger).toContain('data-state="checked" label="Growth" selected value="growth"');
    expect(trigger).toContain('data-disabled="" data-state="unchecked" disabled');
    expect(trigger).toContain('value="enterprise"');
    expect(value).toContain('id="plan-value">Growth</span>');
    expect(selectContentClasses.join(' ')).toContain('data-[state=closed]:hidden');
    expect(selectItemClasses.join(' ')).toContain('data-[state=checked]:font-medium');
    expect(selectValueClasses.join(' ')).toContain('data-[placeholder]:text-neutral-500');
  });

  it('wraps the headless combobox primitive as styled input and listbox markup', () => {
    const items = [
      { label: 'Ada Lovelace', value: 'ada' },
      { label: 'Grace Hopper', value: 'grace' },
      { disabled: true, label: 'Katherine Johnson', value: 'katherine' },
    ];
    const state = {
      descriptionId: 'assignee-help',
      highlightedValue: 'grace',
      items,
      listboxId: 'assignee-listbox',
      name: 'assignee',
      open: true,
      placeholder: 'Search people',
      required: true,
      value: 'ada',
    };

    const input = ComboboxInput.definition.render({
      ...state,
      id: 'assignee',
      labelledBy: 'assignee-label',
    });
    const listbox = ComboboxListbox.definition.render({
      ...state,
      children: items
        .map((item, index) =>
          ComboboxOption.definition.render({
            ...state,
            id: `assignee-listbox-option-${index}`,
            itemLabel: item.label,
            itemValue: item.value,
          }),
        )
        .join(''),
      id: 'assignee-listbox',
      labelledBy: 'assignee-label',
    });
    const value = ComboboxValue.definition.render({ ...state, id: 'assignee-value' });

    expect(ComboboxInput.name).toBe('combobox-input');
    expect(ComboboxListbox.name).toBe('combobox-listbox');
    expect(ComboboxOption.name).toBe('combobox-option');
    expect(ComboboxValue.name).toBe('combobox-value');
    expect(input).toContain('aria-activedescendant="assignee-listbox-option-1"');
    expect(input).toContain('aria-autocomplete="list"');
    expect(input).toContain('aria-controls="assignee-listbox"');
    expect(input).toContain('aria-expanded="true"');
    expect(input).toContain('list="assignee-listbox"');
    expect(input).toContain('role="combobox" type="text" value="ada"');
    expect(listbox).toContain('role="listbox"');
    expect(listbox).toContain('data-state="open" id="assignee-listbox"');
    expect(listbox).toContain('aria-selected="true"');
    expect(listbox).toContain('data-highlighted="" data-state="unchecked"');
    expect(listbox).toContain('aria-disabled="true"');
    expect(value).toContain('id="assignee-value">Ada Lovelace</span>');
    expect(comboboxListboxClasses.join(' ')).toContain('data-[state=closed]:hidden');
    expect(comboboxOptionClasses.join(' ')).toContain('data-[highlighted]:bg-neutral-100');
    expect(comboboxValueClasses.join(' ')).toContain('data-[placeholder]:text-neutral-500');
  });

  it('wraps the headless autocomplete primitive as styled input and datalist markup', () => {
    const items = [
      { label: 'Starter plan', value: 'starter' },
      { label: 'Growth plan', value: 'growth' },
      { disabled: true, label: 'Enterprise plan', value: 'enterprise' },
    ];
    const state = {
      descriptionId: 'plan-search-help',
      highlightedValue: 'growth',
      inputValue: 'gr',
      items,
      listId: 'plan-suggestions',
      name: 'plan-search',
      open: true,
      required: true,
      value: 'growth',
    };

    const input = AutocompleteInput.definition.render({
      ...state,
      id: 'plan-search',
      labelledBy: 'plan-search-label',
    });
    const list = AutocompleteList.definition.render({
      ...state,
      children: items
        .map((item) =>
          AutocompleteOption.definition.render({
            ...state,
            itemLabel: item.label,
            itemValue: item.value,
          }),
        )
        .join(''),
      id: 'plan-suggestions',
      labelledBy: 'plan-search-label',
    });
    const value = AutocompleteValue.definition.render({ ...state, id: 'plan-search-value' });

    expect(AutocompleteInput.name).toBe('autocomplete-input');
    expect(AutocompleteList.name).toBe('autocomplete-list');
    expect(AutocompleteOption.name).toBe('autocomplete-option');
    expect(AutocompleteValue.name).toBe('autocomplete-value');
    expect(input).toContain('aria-activedescendant="plan-suggestions-option-1"');
    expect(input).toContain('autocomplete="off"');
    expect(input).toContain('list="plan-suggestions"');
    expect(input).toContain('role="combobox" type="text" value="gr"');
    expect(list).toContain('<datalist');
    expect(list).toContain('aria-labelledby="plan-search-label"');
    expect(list).toContain('data-state="open" id="plan-suggestions"');
    expect(list).toContain('data-highlighted="" data-state="checked"');
    expect(list).toContain('disabled');
    expect(value).toContain('id="plan-search-value">Growth plan</span>');
    expect(autocompleteListClasses.join(' ')).toContain('rounded-md border border-neutral-200');
    expect(autocompleteOptionClasses.join(' ')).toContain('data-[highlighted]:font-medium');
    expect(autocompleteValueClasses.join(' ')).toContain('data-[placeholder]:text-neutral-500');
  });

  it('wraps the headless slider primitive as styled range input and decorative parts', () => {
    const state = {
      max: 100,
      min: 0,
      name: 'coverage',
      required: true,
      step: 5,
      value: 65,
    };

    const root = Slider.definition.render({
      ...state,
      children: `${SliderInput.definition.render({
        ...state,
        descriptionId: 'coverage-help',
        id: 'coverage',
        label: 'Coverage',
        valueText: '65 percent',
      })}${SliderTrack.definition.render({
        ...state,
        children: SliderRange.definition.render(state),
      })}${SliderThumb.definition.render(state)}`,
      id: 'coverage-root',
    });

    expect(SliderInput.name).toBe('slider-input');
    expect(SliderTrack.name).toBe('slider-track');
    expect(SliderRange.name).toBe('slider-range');
    expect(SliderThumb.name).toBe('slider-thumb');
    expect(root).toContain('data-max="100" data-min="0" data-orientation="horizontal"');
    expect(root).toContain('data-required="" data-value="65" id="coverage-root"');
    expect(root).toContain('aria-describedby="coverage-help"');
    expect(root).toContain('aria-label="Coverage"');
    expect(root).toContain('aria-valuetext="65 percent"');
    expect(root).toContain('id="coverage" max="100" min="0" name="coverage" required');
    expect(root).toContain('step="5" type="range" value="65"');
    expect(root).toContain('data-part="track"');
    expect(root).toContain('data-part="range"');
    expect(root).toContain('data-part="thumb"');
    expect(root).toContain('data-value-ratio="0.65"');
    expect(sliderTrackClasses.join(' ')).toContain('rounded-full bg-neutral-200');
    expect(sliderRangeClasses.join(' ')).toContain('rounded-full bg-neutral-950');
    expect(sliderThumbClasses.join(' ')).toContain('rounded-full border border-neutral-300');
  });

  it('wraps the headless toast primitive as styled live-region markup', () => {
    const toast = Toast.definition.render({
      children: `${ToastTitle.definition.render({
        children: 'Deployment complete',
        id: 'deploy-toast-title',
      })}${ToastDescription.definition.render({
        children: 'Production is serving the new build.',
        id: 'deploy-toast-description',
      })}${ToastAction.definition.render({
        actionValue: 'open-deploy',
        children: 'View',
        id: 'deploy-toast',
      })}${ToastClose.definition.render({ children: 'Dismiss', id: 'deploy-toast' })}`,
      descriptionId: 'deploy-toast-description',
      id: 'deploy-toast',
      titleId: 'deploy-toast-title',
      variant: 'success',
    });
    const viewport = ToastViewport.definition.render({
      children: toast,
      id: 'toast-viewport',
      label: 'Build notifications',
      placement: 'top-center',
    });
    const hiddenToast = Toast.definition.render({ id: 'hidden-toast', open: false });

    expect(ToastViewport.name).toBe('toast-viewport');
    expect(ToastTitle.name).toBe('toast-title');
    expect(ToastDescription.name).toBe('toast-description');
    expect(ToastAction.name).toBe('toast-action');
    expect(ToastClose.name).toBe('toast-close');
    expect(viewport).toContain('aria-label="Build notifications"');
    expect(viewport).toContain('data-placement="top-center" id="toast-viewport"');
    expect(viewport).toContain('role="region" tabIndex="-1"');
    expect(viewport).toContain('aria-atomic="true"');
    expect(viewport).toContain('aria-live="polite"');
    expect(viewport).toContain('aria-describedby="deploy-toast-description"');
    expect(viewport).toContain('aria-labelledby="deploy-toast-title"');
    expect(viewport).toContain('data-state="open" data-variant="success"');
    expect(viewport).toContain('role="status"');
    expect(viewport).toContain('data-part="title" id="deploy-toast-title"');
    expect(viewport).toContain('data-part="description" id="deploy-toast-description"');
    expect(viewport).toContain('data-action=""');
    expect(viewport).toContain('type="button" value="open-deploy"');
    expect(viewport).toContain('data-dismiss=""');
    expect(hiddenToast).toContain('data-state="closed"');
    expect(hiddenToast).toContain('hidden id="hidden-toast"');
    expect(toastTitleClasses.join(' ')).toContain('font-medium');
    expect(toastDescriptionClasses.join(' ')).toContain('text-neutral-700');
    expect(toastActionClasses.join(' ')).toContain('border border-neutral-300');
    expect(toastCloseClasses.join(' ')).toContain('h-8 w-8');
  });

  it('wraps the headless tabs primitive as styled tablist parts', () => {
    const items = [
      { value: 'overview' },
      { value: 'activity' },
      { disabled: true, value: 'audit' },
    ];
    const state = {
      activeValue: 'overview',
      items,
      orientation: 'horizontal' as const,
      value: 'overview',
    };

    expect(TabsList.name).toBe('tabs-list');
    expect(TabsTrigger.name).toBe('tabs-trigger');
    expect(TabsPanel.name).toBe('tabs-panel');

    expect(
      Tabs.definition.render({
        ...state,
        children: 'tabs body',
        id: 'account-tabs',
      }),
    ).toContain('data-orientation="horizontal" id="account-tabs">tabs body</div>');
    expect(
      TabsList.definition.render({
        ...state,
        children: 'triggers',
        label: 'Account sections',
      }),
    ).toContain('aria-label="Account sections"');
    expect(
      TabsTrigger.definition.render({
        ...state,
        children: 'Overview',
        id: 'overview-tab',
        itemValue: 'overview',
        panelId: 'overview-panel',
      }),
    ).toContain('aria-controls="overview-panel" aria-selected="true"');
    expect(
      TabsTrigger.definition.render({
        ...state,
        children: 'Audit',
        itemValue: 'audit',
      }),
    ).toContain('data-disabled="" data-state="inactive" disabled role="tab" tabIndex="-1"');
    expect(
      TabsPanel.definition.render({
        ...state,
        children: 'Overview content',
        id: 'overview-panel',
        itemValue: 'overview',
        triggerId: 'overview-tab',
      }),
    ).toContain('aria-labelledby="overview-tab"');
    expect(
      TabsPanel.definition.render({
        ...state,
        children: 'Activity content',
        itemValue: 'activity',
      }),
    ).toContain('data-state="inactive" hidden role="tabpanel"');
    expect(tabsListClasses.join(' ')).toContain('data-[orientation=vertical]:flex-col');
    expect(tabsTriggerClasses.join(' ')).toContain('data-[state=active]:bg-white');
    expect(tabsPanelClasses.join(' ')).toContain('rounded-md border border-neutral-200');
  });

  it('exports breadcrumb primitives with headless separator attributes', () => {
    expect(Breadcrumb.name).toBe('breadcrumb');
    expect(BreadcrumbItem.name).toBe('breadcrumb-item');
    expect(BreadcrumbLink.name).toBe('breadcrumb-link');
    expect(BreadcrumbSeparator.name).toBe('breadcrumb-separator');

    expect(Breadcrumb.definition.render({ children: '<li>Settings</li>' })).toContain(
      '<nav aria-label="Breadcrumb" class="flex flex-wrap items-center gap-1.5',
    );
    expect(BreadcrumbItem.definition.render({ children: 'Settings' })).toBe(
      '<li class="inline-flex items-center gap-1.5">Settings</li>',
    );
    expect(BreadcrumbLink.definition.render({ children: 'Account', current: true })).toContain(
      'aria-current="page" class="font-medium text-neutral-950"',
    );
    expect(BreadcrumbSeparator.definition.render({ children: '>' })).toBe(
      '<li aria-hidden="true" class="text-neutral-400" data-orientation="horizontal" role="none">></li>',
    );
    expect(breadcrumbClasses).toContain('text-neutral-400');
  });

  it('wraps the headless dialog primitive for a bounded sheet component', () => {
    expect(Sheet.name).toBe('sheet');
    expect(Drawer.name).toBe('drawer');

    const rendered = Sheet.definition.render({
      children: 'Sheet body',
      contentId: 'account-sheet',
      description: 'Manage account settings',
      open: true,
      side: 'left',
      title: 'Account',
      trigger: 'Settings',
    });

    expect(rendered).toContain('aria-controls="account-sheet"');
    expect(rendered).toContain('command="show-modal" commandfor="account-sheet"');
    expect(rendered).toContain('<dialog aria-describedby="account-sheet-description"');
    expect(rendered).toContain('id="account-sheet" open>');
    expect(rendered).toContain('inset-y-0 left-0 w-full max-w-sm border-r');
    expect(rendered).toContain('command="request-close" commandfor="account-sheet"');

    const topSheet = Sheet.definition.render({
      contentId: 'top-sheet',
      side: 'top',
      title: 'Top sheet',
    });
    const drawer = Drawer.definition.render({
      children: 'Drawer body',
      contentId: 'account-drawer',
      description: 'Mobile actions',
      open: true,
      title: 'Actions',
      trigger: 'Open drawer',
    });

    expect(sheetContentClasses).toContain('inset-y-0 right-0 w-full max-w-sm border-l');
    expect(sheetContentClasses).toContain('inset-x-0 bottom-0 max-h-[85vh] border-t');
    expect(topSheet).toContain('top-0 max-h-[85vh] border-b');
    expect(drawer).toContain('command="show-modal" commandfor="account-drawer"');
    expect(drawer).toContain('<dialog aria-describedby="account-drawer-description"');
    expect(drawer).toContain('id="account-drawer" open>');
    expect(drawer).toContain('bottom-0 max-h-[85vh] border-t');
    expect(drawer).toContain('command="request-close" commandfor="account-drawer"');
  });

  it('keeps vendorable component sources TSX-authored with no lowered IR stamps', () => {
    const sources = [
      'alert.tsx',
      'autocomplete.tsx',
      'badge.tsx',
      'breadcrumb.tsx',
      'button.tsx',
      'card.tsx',
      'checkbox.tsx',
      'checkbox-group.tsx',
      'combobox.tsx',
      'field.tsx',
      'kbd.tsx',
      'number-field.tsx',
      'otp-field.tsx',
      'sheet.tsx',
      'skeleton.tsx',
      'scroll-area.tsx',
      'select.tsx',
      'switch.tsx',
      'slider.tsx',
      'table.tsx',
      'tabs.tsx',
      'toggle.tsx',
      'toggle-group.tsx',
      'toast.tsx',
      'toolbar.tsx',
    ]
      .map(readSource)
      .join('\n');

    expect(sources).toContain('/** @jsxImportSource @jiso/server */');
    expect(sources).toContain("import { component } from '@jiso/core';");
    expect(sources).toContain("from '@jiso/headless-ui'");
    expect(sources).not.toContain('fw-c=');
    expect(sources).not.toContain('data-bind');
    expect(sources).not.toContain('@jiso-ir');
  });
});
