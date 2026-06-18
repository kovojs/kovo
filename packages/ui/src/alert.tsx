/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

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
      borderRadius: uiTheme.radius.lg,
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
      backgroundColor: uiTheme.color.danger.background,
      borderColor: uiTheme.color.danger.border,
      color: uiTheme.color.danger.foreground,
    },
    info: {
      backgroundColor: uiTheme.color.info.background,
      borderColor: uiTheme.color.info.border,
      color: uiTheme.color.info.foreground,
    },
    success: {
      backgroundColor: uiTheme.color.success.background,
      borderColor: uiTheme.color.success.border,
      color: uiTheme.color.success.foreground,
    },
    warning: {
      backgroundColor: uiTheme.color.warning.background,
      borderColor: uiTheme.color.warning.border,
      color: uiTheme.color.warning.foreground,
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
