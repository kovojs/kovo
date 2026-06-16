/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';
import * as style from '@kovojs/style';

export interface CardProps {
  children?: string;
  style?: style.StyleInput;
}

export const cardStyles = style.create(
  {
    root: {
      backgroundColor: '#ffffff',
      borderColor: '#e5e5e5',
      borderRadius: 8,
      borderStyle: 'solid',
      borderWidth: 1,
      boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
      color: '#0a0a0a',
      padding: 16,
    },
  },
  { namespace: 'card', source: 'card.tsx' },
);

export const cardClasses = [style.attrs(cardStyles.root).class ?? ''] as const;

export const Card = component({
  render(props: CardProps) {
    const attrs = style.attrs(cardStyles.root, props.style);

    return <section {...attrs}>{props.children}</section>;
  },
});
