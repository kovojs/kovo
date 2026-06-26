/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { uiTheme } from './theme.js';

/**
 * Supported alert variant values.
 *
 * @example
 * import type { AlertVariant } from "@kovojs/ui/alert";
 * const value: AlertVariant = 'info';
 */
export type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

/**
 * Props for the alert component.
 *
 * @example
 * import type { AlertProps } from "@kovojs/ui/alert";
 * const props: AlertProps = { children: 'Content' };
 */
export interface AlertProps {
  children?: string;
  role?: 'alert' | 'status';
  style?: style.StyleInput;
  title?: string;
  variant?: AlertVariant;
}

const base = style.create({
  description: {
    color: uiTheme.color.foregroundMuted,
  },
  root: {
    // Neutral bordered card with a colored left accent (variant sets borderLeftColor).
    alignItems: 'start',
    backgroundColor: uiTheme.color.background,
    borderBottomWidth: 1,
    borderColor: uiTheme.color.border,
    borderLeftWidth: 4,
    borderRadius: uiTheme.radius.lg,
    borderRightWidth: 1,
    borderStyle: 'solid',
    borderTopWidth: 1,
    color: uiTheme.color.foreground,
    display: 'grid',
    fontSize: 14,
    gap: 4,
    lineHeight: 1.45,
    paddingBlock: 12,
    paddingInline: 16,
  },
  title: {
    fontWeight: 600,
    letterSpacing: '-0.006em',
    lineHeight: 1.3,
  },
});

// Variants set ONLY the left-accent hue (Material status border color); the body
// stays a neutral card so colored text/fill no longer competes with content.
const variants = style.create({
  danger: {
    borderLeftColor: uiTheme.color.danger.border,
  },
  info: {
    borderLeftColor: uiTheme.color.info.border,
  },
  success: {
    borderLeftColor: uiTheme.color.success.border,
  },
  warning: {
    borderLeftColor: uiTheme.color.warning.border,
  },
});

/**
 * Style definitions used by the alert components.
 *
 * @example
 * import { alertStyles } from "@kovojs/ui/alert";
 * const styles = alertStyles;
 */
export const alertStyles = {
  base,
  variants,
} as const;

/**
 * Renders the styled alert primitive.
 *
 * @example
 * import { Alert } from "@kovojs/ui/alert";
 * const component = Alert;
 */
export const Alert = component({
  render(props: AlertProps) {
    const attrs = style.attrs(base.root, variants[props.variant ?? 'info'], props.style);
    const titleAttrs = style.attrs(base.title);
    const descriptionAttrs = style.attrs(base.description);

    return (
      <div {...attrs} role={props.role ?? 'status'}>
        {props.title === undefined ? '' : <strong {...titleAttrs}>{props.title}</strong>}
        <div {...descriptionAttrs}>{props.children}</div>
      </div>
    );
  },
});
