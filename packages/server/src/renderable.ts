import type { TrustedHtml } from '@kovojs/browser';
import { kovoTrustedHtmlContent } from '@kovojs/browser/internal/output';

import { escapeText, isRenderedHtml, type RenderedHtml } from './html.js';

type MaybePromise<Value> = Promise<Value> | Value;

/** @internal server JSX child/renderable surface shared by the runtime and framework primitives. */
export type InternalServerRenderable =
  | InternalServerRenderable[]
  | boolean
  | null
  | number
  | readonly InternalServerRenderable[]
  | RenderedHtml
  | string
  | TrustedHtml
  | undefined
  | Promise<InternalServerRenderable>;

/** @internal render a JSX child/renderable value using the server runtime escaping rules. */
export function renderServerRenderable(children: InternalServerRenderable): MaybePromise<string> {
  if (children === null || children === undefined || typeof children === 'boolean') return '';
  if (isPromiseLike(children)) return children.then((child) => renderServerRenderable(child));
  if (isRenderedHtml(children)) return children.html;
  if (typeof children === 'object') {
    const trustedHtml = kovoTrustedHtmlContent(children);
    if (trustedHtml !== '') return trustedHtml;
  }
  if (Array.isArray(children)) {
    const rendered = children.map((child) => renderServerRenderable(child));
    return rendered.some(isPromiseLike)
      ? Promise.all(rendered.map((value) => Promise.resolve(value))).then((values) =>
          values.join(''),
        )
      : (rendered as string[]).join('');
  }

  return escapeText(children);
}

function isPromiseLike<Value>(value: unknown): value is PromiseLike<Value> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
