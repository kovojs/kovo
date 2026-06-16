/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps {
  children?: string;
  role?: 'alert' | 'status';
  style?: style.StyleInput;
  title?: string;
  variant?: AlertVariant;
}

const base = style.create(
  {
    root: {
      borderRadius: 8,
      borderStyle: 'solid',
      borderWidth: 1,
      display: 'grid',
      fontSize: 14,
      gap: 4,
      padding: 16,
    },
    title: {
      fontWeight: 500,
    },
  },
  { namespace: 'alert', source: 'alert.tsx' },
);

const variants = style.create(
  {
    danger: {
      backgroundColor: '#fef2f2',
      borderColor: '#fecaca',
      color: '#450a0a',
    },
    info: {
      backgroundColor: '#f0f9ff',
      borderColor: '#bae6fd',
      color: '#082f49',
    },
    success: {
      backgroundColor: '#ecfdf5',
      borderColor: '#a7f3d0',
      color: '#022c22',
    },
    warning: {
      backgroundColor: '#fffbeb',
      borderColor: '#fde68a',
      color: '#451a03',
    },
  },
  { namespace: 'alertVariant', source: 'alert.tsx' },
);

export const alertStyles = {
  base,
  variants,
} as const;

export const alertClasses = [
  style.attrs(base.root, variants.info).class ?? '',
  style.attrs(variants.success).class ?? '',
  style.attrs(variants.warning).class ?? '',
  style.attrs(variants.danger).class ?? '',
  style.attrs(base.title).class ?? '',
] as const;

export const Alert = component({
  render(props: AlertProps) {
    const attrs = style.attrs(base.root, variants[props.variant ?? 'info'], props.style);
    const titleAttrs = style.attrs(base.title);

    return (
      <div {...attrs} role={props.role ?? 'status'}>
        {props.title === undefined ? '' : <strong {...titleAttrs}>{props.title}</strong>}
        <div>{props.children}</div>
      </div>
    );
  },
});
