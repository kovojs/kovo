/** @jsxImportSource @jiso/server */
import { component } from '@jiso/core';
import {
  cn,
  defineVariants,
  fieldControlAttributes,
  fieldDescriptionAttributes,
  fieldErrorAttributes,
  fieldLabelAttributes,
  fieldRootAttributes,
  fieldsetLegendAttributes,
  fieldsetRootAttributes,
  type ClassValue,
} from '@jiso/headless-ui';

export interface FieldStateProps {
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
}

export interface FieldProps extends FieldStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export interface FieldLabelProps extends FieldStateProps {
  children?: string;
  class?: ClassValue;
  controlId?: string;
  id?: string;
}

export interface FieldControlProps extends FieldStateProps {
  class?: ClassValue;
  descriptionId?: string;
  errorId?: string;
  id?: string;
  name?: string;
  placeholder?: string;
  type?: string;
  value?: string;
}

export interface FieldTextareaProps extends FieldStateProps {
  children?: string;
  class?: ClassValue;
  descriptionId?: string;
  errorId?: string;
  id?: string;
  name?: string;
  placeholder?: string;
  rows?: number;
}

export interface FieldSelectProps extends FieldStateProps {
  children?: string;
  class?: ClassValue;
  descriptionId?: string;
  errorId?: string;
  id?: string;
  name?: string;
  value?: string;
}

export interface FieldMessageProps extends FieldStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
  visible?: boolean;
}

export interface FieldsetProps extends FieldStateProps {
  children?: string;
  class?: ClassValue;
  descriptionId?: string;
  errorId?: string;
  id?: string;
}

export interface FieldsetLegendProps extends FieldStateProps {
  children?: string;
  class?: ClassValue;
  id?: string;
}

export const fieldClassNames = defineVariants({
  base: 'grid gap-2 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:text-red-950 data-[required]:font-medium',
  variants: {},
});

export const fieldLabelClassNames = defineVariants({
  base: 'text-sm font-medium leading-none text-neutral-900 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-70',
  variants: {},
});

export const fieldControlClassNames = defineVariants({
  base: 'h-9 w-full rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-950 shadow-sm transition-colors placeholder:text-neutral-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:opacity-70 aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus-visible:outline-red-500',
  variants: {},
});

export const fieldTextareaClassNames = defineVariants({
  base: 'min-h-24 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950 shadow-sm transition-colors placeholder:text-neutral-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:opacity-70 aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus-visible:outline-red-500',
  variants: {},
});

export const fieldSelectClassNames = defineVariants({
  base: 'h-9 w-full rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-950 shadow-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-950 disabled:cursor-not-allowed disabled:bg-neutral-100 disabled:opacity-70 aria-[invalid=true]:border-red-500 aria-[invalid=true]:focus-visible:outline-red-500',
  variants: {},
});

export const fieldDescriptionClassNames = defineVariants({
  base: 'text-sm text-neutral-500',
  variants: {},
});

export const fieldErrorClassNames = defineVariants({
  base: 'text-sm font-medium text-red-600',
  variants: {},
});

export const fieldsetClassNames = defineVariants({
  base: 'grid gap-3 rounded-md border border-neutral-200 p-4 text-sm text-neutral-950 data-[disabled]:opacity-50 data-[invalid]:border-red-300',
  variants: {},
});

export const fieldsetLegendClassNames = defineVariants({
  base: 'px-1 text-sm font-medium text-neutral-900',
  variants: {},
});

export const fieldClasses = fieldClassNames.classes;
export const fieldLabelClasses = fieldLabelClassNames.classes;
export const fieldControlClasses = fieldControlClassNames.classes;
export const fieldTextareaClasses = fieldTextareaClassNames.classes;
export const fieldSelectClasses = fieldSelectClassNames.classes;
export const fieldDescriptionClasses = fieldDescriptionClassNames.classes;
export const fieldErrorClasses = fieldErrorClassNames.classes;
export const fieldsetClasses = fieldsetClassNames.classes;
export const fieldsetLegendClasses = fieldsetLegendClassNames.classes;

export const Field = component('field', {
  render(props: FieldProps) {
    const attrs = fieldRootAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.required === undefined ? {} : { required: props.required }),
    });

    return (
      <div
        class={cn(fieldClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        id={attrs.id}
      >
        {props.children}
      </div>
    );
  },
});

export const FieldLabel = component('field-label', {
  render(props: FieldLabelProps) {
    const attrs = fieldLabelAttributes({
      ...(props.controlId === undefined ? {} : { controlId: props.controlId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.required === undefined ? {} : { required: props.required }),
    });

    return (
      <label
        class={cn(fieldLabelClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        for={attrs.for}
        id={attrs.id}
      >
        {props.children}
      </label>
    );
  },
});

export const FieldControl = component('field-control', {
  render(props: FieldControlProps) {
    const attrs = fieldControlAttributes({
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.errorId === undefined ? {} : { errorId: props.errorId }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
    });

    return (
      <input
        aria-describedby={attrs['aria-describedby']}
        aria-invalid={attrs['aria-invalid']}
        class={cn(fieldControlClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        disabled={attrs.disabled}
        id={attrs.id}
        name={attrs.name}
        placeholder={props.placeholder}
        required={attrs.required}
        type={props.type ?? 'text'}
        value={props.value}
      />
    );
  },
});

export const FieldTextarea = component('field-textarea', {
  render(props: FieldTextareaProps) {
    const attrs = fieldControlAttributes({
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.errorId === undefined ? {} : { errorId: props.errorId }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
    });

    return (
      <textarea
        aria-describedby={attrs['aria-describedby']}
        aria-invalid={attrs['aria-invalid']}
        class={cn(fieldTextareaClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        disabled={attrs.disabled}
        id={attrs.id}
        name={attrs.name}
        placeholder={props.placeholder}
        required={attrs.required}
        rows={props.rows}
      >
        {props.children}
      </textarea>
    );
  },
});

export const FieldSelect = component('field-select', {
  render(props: FieldSelectProps) {
    const attrs = fieldControlAttributes({
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.errorId === undefined ? {} : { errorId: props.errorId }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.name === undefined ? {} : { name: props.name }),
      ...(props.required === undefined ? {} : { required: props.required }),
    });

    return (
      <select
        aria-describedby={attrs['aria-describedby']}
        aria-invalid={attrs['aria-invalid']}
        class={cn(fieldSelectClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        disabled={attrs.disabled}
        id={attrs.id}
        name={attrs.name}
        required={attrs.required}
        value={props.value}
      >
        {props.children}
      </select>
    );
  },
});

export const FieldDescription = component('field-description', {
  render(props: FieldMessageProps) {
    const attrs = fieldDescriptionAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.visible === undefined ? {} : { visible: props.visible }),
    });

    return (
      <p
        class={cn(fieldDescriptionClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        hidden={attrs.hidden}
        id={attrs.id}
      >
        {props.children}
      </p>
    );
  },
});

export const FieldError = component('field-error', {
  render(props: FieldMessageProps) {
    const attrs = fieldErrorAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.required === undefined ? {} : { required: props.required }),
      ...(props.visible === undefined ? {} : { visible: props.visible }),
    });

    return (
      <p
        class={cn(fieldErrorClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        hidden={attrs.hidden}
        id={attrs.id}
        role={attrs.role}
      >
        {props.children}
      </p>
    );
  },
});

export const Fieldset = component('fieldset', {
  render(props: FieldsetProps) {
    const attrs = fieldsetRootAttributes({
      ...(props.descriptionId === undefined ? {} : { descriptionId: props.descriptionId }),
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.errorId === undefined ? {} : { errorId: props.errorId }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.required === undefined ? {} : { required: props.required }),
    });

    return (
      <fieldset
        aria-describedby={attrs['aria-describedby']}
        aria-invalid={attrs['aria-invalid']}
        class={cn(fieldsetClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        disabled={attrs.disabled}
        id={attrs.id}
      >
        {props.children}
      </fieldset>
    );
  },
});

export const FieldsetLegend = component('fieldset-legend', {
  render(props: FieldsetLegendProps) {
    const attrs = fieldsetLegendAttributes({
      ...(props.disabled === undefined ? {} : { disabled: props.disabled }),
      ...(props.id === undefined ? {} : { id: props.id }),
      ...(props.invalid === undefined ? {} : { invalid: props.invalid }),
      ...(props.required === undefined ? {} : { required: props.required }),
    });

    return (
      <legend
        class={cn(fieldsetLegendClassNames(), props.class)}
        data-disabled={attrs['data-disabled']}
        data-invalid={attrs['data-invalid']}
        data-required={attrs['data-required']}
        id={attrs.id}
      >
        {props.children}
      </legend>
    );
  },
});
