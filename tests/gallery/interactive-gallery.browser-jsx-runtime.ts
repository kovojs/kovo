import type { Component } from '@kovojs/core';
import { isKovoTrustedHtml, kovoTrustedHtmlContent } from '@kovojs/browser/generated';
import { isKovoComponentHostControlAttribute } from '../../packages/core/src/internal/semantic-attributes.js';

import {
  browserHarnessComponentDefinition,
  isBrowserHarnessComponent,
} from '../../examples/gallery/src/interactive-gallery.browser-core.js';

type JsxNode =
  | BrowserHarnessRenderedHtml
  | JsxNode[]
  | boolean
  | null
  | number
  | object
  | Promise<JsxNode>
  | string
  | undefined;

interface JsxProps {
  children?: JsxNode;
  [attribute: string]: unknown;
}

type JsxComponent = (props: any) => any;
type KovoJsxComponent = Component<any>;
type MaybePromise<Value> = Promise<Value> | Value;

interface BrowserHarnessRenderedHtml {
  readonly html: string;
  toString(): string;
}

const browserHarnessRenderedHtmlValues = new WeakMap<object, string>();
const browserHarnessGeneratedComponentControlSnapshots = new WeakMap<
  object,
  Readonly<{ name: string; value: unknown }>
>();

const voidElements = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

export function Fragment(props: JsxProps): MaybePromise<BrowserHarnessRenderedHtml> {
  return toBrowserHarnessRenderedHtml(renderJsxChildren(props.children));
}

export function jsx(
  type: JsxComponent | KovoJsxComponent | string,
  props: JsxProps,
  key?: unknown,
): MaybePromise<BrowserHarnessRenderedHtml> {
  if (isKovoComponent(type)) return renderKovoComponent(type, props);
  if (typeof type === 'function') return renderFunctionComponentResult(type(props));

  const attributes = renderJsxAttributes(props, key);
  if (voidElements.has(type)) return browserHarnessRenderedHtml(`<${type}${attributes}>`);

  const children = renderJsxChildren(props.children);
  return isPromiseLike(children)
    ? children.then((html) => browserHarnessRenderedHtml(`<${type}${attributes}>${html}</${type}>`))
    : browserHarnessRenderedHtml(`<${type}${attributes}>${children}</${type}>`);
}

export const jsxs = jsx;
export const jsxDEV = jsx;

/** Browser-harness equivalent of the compiler-owned server text-escape ABI. */
export function escapeText(value: unknown): BrowserHarnessRenderedHtml {
  return browserHarnessRenderedHtml(escapeTextContent(value));
}

/** Browser-harness equivalent of the compiler-owned component-control receipt ABI. */
export function kovoGeneratedComponentControl(name: string, value: unknown): object {
  if (typeof name !== 'string' || !isKovoComponentHostControlAttribute(name)) {
    throw new TypeError('Compiler component-control receipts require an exact supported name.');
  }

  const isElementParam = name.startsWith('data-p-');
  const isTrustedUrlMarker = name.startsWith('data-kovo-trusted-url:');
  const scalar =
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    (isElementParam && (typeof value === 'number' || typeof value === 'boolean')) ||
    (isTrustedUrlMarker && value === true);
  if (!scalar) {
    throw new TypeError(
      'Compiler component-control receipts require a string control value, a string/number/boolean data-p-* scalar, or an exact true trusted-URL marker.',
    );
  }

  const receipt = Object.freeze(Object.create(null)) as object;
  browserHarnessGeneratedComponentControlSnapshots.set(receipt, Object.freeze({ name, value }));
  return receipt;
}

function escapeTextContent(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'boolean') return '';
  if (Array.isArray(value)) return value.map((item) => escapeTextContent(item)).join('');
  if (typeof value === 'string') return escapeHtmlText(value);
  if (typeof value === 'bigint' || typeof value === 'number') {
    return escapeHtmlText(`${value}`);
  }
  return escapeHtmlText(JSON.stringify(value) ?? '');
}

async function renderKovoComponent(
  component: KovoJsxComponent,
  props: JsxProps,
): Promise<BrowserHarnessRenderedHtml> {
  const definition = browserHarnessComponentDefinition(component);
  const state = definition.state?.();
  const render = definition.render as (
    queries: Record<string, unknown>,
    state: unknown,
    slots: Record<string, unknown>,
  ) => unknown;
  const rendered = render({ ...props }, state, jsxPropsToSlots(props)) as JsxNode;
  return browserHarnessRenderedHtml(await renderJsxChildren(rendered));
}

function jsxPropsToSlots(props: JsxProps): Record<string, unknown> {
  return Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'children'));
}

function renderJsxAttributes(props: JsxProps, jsxKey?: unknown): string {
  let rendered = '';
  const key = props['kovo-key'] === undefined ? (props.key ?? jsxKey) : undefined;

  if (key !== false && key !== null && key !== undefined) {
    rendered += ` kovo-key="${escapeAttribute(serializeAttributeValue(key))}"`;
  }

  for (const [name, rawValue] of Object.entries(props)) {
    if (name === 'children' || name === 'key') continue;
    const value = browserHarnessGeneratedComponentControlValue(name, rawValue);
    if (value === false || value == null) continue;
    rendered +=
      value === true ? ` ${name}` : ` ${name}="${escapeAttribute(serializeAttributeValue(value))}"`;
  }

  return rendered;
}

function renderJsxChildren(children: JsxNode): MaybePromise<string> {
  if (children === null || children === undefined || typeof children === 'boolean') return '';
  if (isPromiseLike<JsxNode>(children)) {
    return children.then((child) => renderJsxChildren(child));
  }
  if (Array.isArray(children)) {
    const rendered = children.map((child) => renderJsxChildren(child));
    return rendered.some(isPromiseLike)
      ? Promise.all(rendered.map((value) => Promise.resolve(value))).then((values) =>
          values.join(''),
        )
      : (rendered as string[]).join('');
  }

  const renderedHtml = browserHarnessRenderedHtmlContent(children);
  if (renderedHtml !== undefined) return renderedHtml;
  if (isKovoTrustedHtml(children)) return kovoTrustedHtmlContent(children);
  return escapeTextContent(children);
}

function renderFunctionComponentResult(value: unknown): MaybePromise<BrowserHarnessRenderedHtml> {
  return isPromiseLike(value)
    ? value.then((resolved) => renderFunctionComponentResult(resolved))
    : toBrowserHarnessRenderedHtml(renderJsxChildren(value as JsxNode));
}

function toBrowserHarnessRenderedHtml(
  value: MaybePromise<string>,
): MaybePromise<BrowserHarnessRenderedHtml> {
  return isPromiseLike(value)
    ? value.then((html) => browserHarnessRenderedHtml(html))
    : browserHarnessRenderedHtml(value);
}

function browserHarnessRenderedHtml(html: string): BrowserHarnessRenderedHtml {
  const value = {
    html,
    toString() {
      return html;
    },
  };
  browserHarnessRenderedHtmlValues.set(value, html);
  return Object.freeze(value);
}

export function browserHarnessRenderedHtmlContent(value: unknown): string | undefined {
  return typeof value === 'object' && value !== null
    ? browserHarnessRenderedHtmlValues.get(value)
    : undefined;
}

function isKovoComponent(value: unknown): value is KovoJsxComponent {
  return isBrowserHarnessComponent(value);
}

function browserHarnessGeneratedComponentControlValue(name: string, value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value;
  const snapshot = browserHarnessGeneratedComponentControlSnapshots.get(value);
  if (snapshot === undefined) return value;
  if (snapshot.name !== name) return undefined;
  if (
    snapshot.name.startsWith('data-p-') &&
    (typeof snapshot.value === 'number' || typeof snapshot.value === 'boolean')
  ) {
    return String(snapshot.value);
  }
  return snapshot.value;
}

function isPromiseLike<Value = unknown>(value: unknown): value is Promise<Value> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function serializeAttributeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean')
    return String(value);
  return JSON.stringify(value);
}

export function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeHtmlText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
