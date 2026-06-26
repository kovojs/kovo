import type { TrustedHtml } from '@kovojs/browser';
import { kovoTrustedHtmlContent } from '@kovojs/browser/internal/output';

import { escapeTextWithRenderedHtml, isRenderedHtml, type RenderedHtml } from './html.js';

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

  // SPEC.md §4.5/§5.2: escape a RAW scalar child (an app-authored `{expr}` with no
  // compiler escaper) to a plain string. The compiler-injected `{escapeText(expr)}` child
  // never reaches this branch: `escapeText` brands its already-escaped result as
  // RenderedHtml, so it is handled by the `isRenderedHtml` fast-path above and passed
  // through verbatim (single-escape, bugz.md M2). This final scalar branch must NOT brand
  // its result, or a value that is itself later re-escaped would double-escape; it uses the
  // string-returning escaper (which also resolves any embedded coerced-rendered-html marker).
  return escapeTextWithRenderedHtml(children);
}

function isPromiseLike<Value>(value: unknown): value is PromiseLike<Value> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
