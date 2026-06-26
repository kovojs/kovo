/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { uiTheme } from './theme.js';

/**
 * Props for the keyboard key component.
 *
 * @example
 * import type { KbdProps } from "@kovojs/ui/kbd";
 * const props: KbdProps = { children: 'Content' };
 */
export interface KbdProps {
  children?: string;
  style?: style.StyleInput;
}

/**
 * Style definitions used by the kbd components.
 *
 * @example
 * import { kbdStyles } from "@kovojs/ui/kbd";
 * const styles = kbdStyles;
 */
export const kbdStyles = style.create({
  root: {
    alignItems: 'center',
    backgroundColor: uiTheme.color.backgroundRaised,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.sm,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    color: uiTheme.color.foregroundMuted,
    display: 'inline-flex',
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: 11,
    fontWeight: 500,
    height: 20,
    justifyContent: 'center',
    lineHeight: 1,
    minWidth: 20,
    paddingInline: 4,
  },
});

/**
 * Renders the styled keyboard key primitive.
 *
 * @example
 * import { Kbd } from "@kovojs/ui/kbd";
 * const component = Kbd;
 */
export const Kbd = component({
  render(props: KbdProps) {
    const attrs = style.attrs(kbdStyles.root, props.style);

    return <kbd {...attrs}>{props.children}</kbd>;
  },
});
