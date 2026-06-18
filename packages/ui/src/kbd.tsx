/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

import { passThroughProps } from './pass-through.js';

import { uiTheme } from './theme.js';

export interface KbdProps {
  children?: string;
  style?: style.StyleInput;
}

export const kbdStyles = style.create(
  {
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
  },
  { namespace: 'kbd', source: 'kbd.tsx' },
);

export const kbdClasses = [style.attrs(kbdStyles.root).class ?? ''] as const;

export const Kbd = component({
  render(props: KbdProps) {
    const attrs = style.attrs(kbdStyles.root, props.style);

    return <kbd {...attrs}>{props.children}</kbd>;
  },
});
