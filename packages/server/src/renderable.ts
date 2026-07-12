import type { TrustedHtml } from '@kovojs/browser';
import { kovoTrustedHtmlContent } from '@kovojs/browser/internal/output';

import {
  escapeTextWithRenderedHtml,
  isRenderedHtml,
  renderedHtmlContent,
  type RenderedHtml,
} from './html.js';
import { witnessIsArray } from './security-witness-intrinsics.js';

type MaybePromise<Value> = Promise<Value> | Value;

/** Framework-rendered HTML object accepted by fragment sinks without naming internal brands. */
export interface ServerRenderedHtml {
  readonly html: string;
  toJSON?(): string;
  toString(): string;
}

/** HTML-capable value accepted by app-facing fragment APIs. Plain strings belong in text sinks. */
export type ServerFragmentRenderable = ServerRenderedHtml | TrustedHtml;

/** Generated/audited fragment value accepted by framework-owned fragment renderers. */
export type GeneratedFragmentRenderable = ServerFragmentRenderable | string;

/** Awaitable generated/audited fragment value accepted by framework-owned fragment renderers. */
export type AwaitableGeneratedFragmentRenderable =
  | GeneratedFragmentRenderable
  | Promise<GeneratedFragmentRenderable>;

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
  if (isRenderedHtml(children)) return renderedHtmlContent(children);
  if (typeof children === 'object') {
    const trustedHtml = kovoTrustedHtmlContent(children);
    if (trustedHtml !== '') return trustedHtml;
  }
  if (witnessIsArray(children)) {
    const rendered: MaybePromise<string>[] = [];
    let async = false;
    for (let index = 0; index < children.length; index += 1) {
      const value = renderServerRenderable(children[index] as InternalServerRenderable);
      rendered[index] = value;
      if (isPromiseLike(value)) async = true;
    }
    if (async) return joinRenderedValues(rendered);
    let joined = '';
    for (let index = 0; index < rendered.length; index += 1) {
      joined += rendered[index] as string;
    }
    return joined;
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

async function joinRenderedValues(values: readonly MaybePromise<string>[]): Promise<string> {
  let joined = '';
  for (let index = 0; index < values.length; index += 1) {
    joined += await values[index];
  }
  return joined;
}

function isPromiseLike<Value>(value: unknown): value is PromiseLike<Value> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
