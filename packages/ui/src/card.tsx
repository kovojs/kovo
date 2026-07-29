/** @jsxImportSource @kovojs/server */
import { component, type ComponentChild } from '@kovojs/core';
import * as style from '@kovojs/style';

import { uiTheme } from './theme.js';

/**
 * Props for the card component.
 *
 * @example
 * import type { CardProps } from "@kovojs/ui/card";
 * const props: CardProps = { children: 'Content' };
 */
export interface CardProps {
  children?: ComponentChild;
  style?: style.StyleInput;
}

/** Props for the structural header region of a {@link Card}. */
export interface CardHeaderProps extends CardProps {}

/** Props for the heading rendered inside a {@link CardHeader}. */
export interface CardTitleProps extends CardProps {}

/** Props for supporting copy rendered inside a {@link CardHeader}. */
export interface CardDescriptionProps extends CardProps {}

/** Props for the primary content region of a {@link Card}. */
export interface CardContentProps extends CardProps {}

/** Props for the trailing actions or metadata region of a {@link Card}. */
export interface CardFooterProps extends CardProps {}

const cardStyles = style.create({
  content: {
    paddingBlockEnd: 16,
    paddingInline: 16,
  },
  description: {
    color: uiTheme.color.foregroundMuted,
    fontSize: 14,
    lineHeight: 1.5,
    margin: 0,
  },
  footer: {
    alignItems: 'center',
    borderColor: uiTheme.color.border,
    borderStyle: 'solid',
    borderWidth: 0,
    borderTopWidth: 1,
    display: 'flex',
    gap: 8,
    padding: 16,
  },
  header: {
    display: 'grid',
    gap: 6,
    padding: 16,
  },
  root: {
    backgroundColor: uiTheme.color.background,
    borderColor: uiTheme.color.border,
    borderRadius: uiTheme.radius.lg,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    color: uiTheme.color.foreground,
    overflow: 'hidden',
  },
  title: {
    fontSize: 18,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    lineHeight: 1.25,
    margin: 0,
  },
});

/**
 * Renders the styled card primitive.
 *
 * @example
 * import { Card } from "@kovojs/ui/card";
 * const component = Card;
 */
export const Card = component({
  render(props: CardProps) {
    const attrs = style.attrs(cardStyles.root, props.style);

    return <section {...attrs}>{props.children}</section>;
  },
});

/**
 * Groups a card title and description.
 *
 * @example
 * import { CardHeader } from "@kovojs/ui/card";
 * const component = CardHeader;
 */
export const CardHeader = component({
  render(props: CardHeaderProps) {
    return <div {...style.attrs(cardStyles.header, props.style)}>{props.children}</div>;
  },
});

/**
 * Renders the card's heading.
 *
 * @example
 * import { CardTitle } from "@kovojs/ui/card";
 * const component = CardTitle;
 */
export const CardTitle = component({
  render(props: CardTitleProps) {
    return <h3 {...style.attrs(cardStyles.title, props.style)}>{props.children}</h3>;
  },
});

/**
 * Renders supporting text for the card title.
 *
 * @example
 * import { CardDescription } from "@kovojs/ui/card";
 * const component = CardDescription;
 */
export const CardDescription = component({
  render(props: CardDescriptionProps) {
    return <p {...style.attrs(cardStyles.description, props.style)}>{props.children}</p>;
  },
});

/**
 * Renders the card's primary content region.
 *
 * @example
 * import { CardContent } from "@kovojs/ui/card";
 * const component = CardContent;
 */
export const CardContent = component({
  render(props: CardContentProps) {
    return <div {...style.attrs(cardStyles.content, props.style)}>{props.children}</div>;
  },
});

/**
 * Renders trailing card actions or metadata.
 *
 * @example
 * import { CardFooter } from "@kovojs/ui/card";
 * const component = CardFooter;
 */
export const CardFooter = component({
  render(props: CardFooterProps) {
    return <footer {...style.attrs(cardStyles.footer, props.style)}>{props.children}</footer>;
  },
});
