import { kovoStyleProperty, kovoTrustedHtmlContent } from '@kovojs/runtime';

import { escapeAttribute } from './html.js';

// Server-side JSX runtime. Components author JSX sugar (SPEC.md section 4.1)
// and render to light-DOM HTML strings (SPEC.md section 3 pipeline, section
// 4.2 rendered output) — there is no virtual DOM and no client framework; the
// rendered string IS the runtime form, self-describing through its stamps.
//
// Rendering rules:
// - Attribute values are escaped; `true` renders a bare attribute (`enhance`),
//   `false`/`null`/`undefined` omit the attribute (mirroring the loader's
//   attribute-binding empty semantics, SPEC.md section 4.8).
// - Child strings are inserted as written so pre-rendered HTML (component
//   renders, framework helpers such as csrfField) composes without a wrapper
//   type. SPEC.md section 4 does not yet define JSX text-escaping semantics;
//   the open question is tracked by the active v1 cleanup/docs ledgers.

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

export type JsxNode = JsxNode[] | boolean | null | number | string | undefined;

export interface JsxProps {
  children?: JsxNode;
  [attribute: string]: unknown;
}

export type JsxComponent = (props: JsxProps) => string;

export function Fragment(props: JsxProps): string {
  return renderJsxChildren(props.children);
}

export function jsx(type: JsxComponent | string, props: JsxProps): string {
  if (typeof type === 'function') return type(props);

  const attributes = renderJsxAttributes(type, props);
  if (voidElements.has(type)) return `<${type}${attributes}>`;

  return `<${type}${attributes}>${renderJsxChildren(renderJsxContent(props))}</${type}>`;
}

export const jsxs = jsx;

export function jsxDEV(type: JsxComponent | string, props: JsxProps): string {
  return jsx(type, props);
}

function renderJsxAttributes(type: string, props: JsxProps): string {
  let rendered = '';

  for (const [name, value] of Object.entries(props)) {
    if (
      name === 'children' ||
      isRawHtmlAttribute(name) ||
      value === false ||
      value === null ||
      value === undefined
    ) {
      continue;
    }
    if (type === 'form' && name === 'mutation' && isMutationDefinitionLike(value)) {
      rendered += renderMutationFormAttributes(value.key, props);
      continue;
    }
    rendered +=
      value === true ? ` ${name}` : ` ${name}="${escapeAttribute(attributeText(name, value))}"`;
  }

  return rendered;
}

function renderMutationFormAttributes(key: string, props: JsxProps): string {
  return [
    props.method === undefined ? ' method="post"' : '',
    props.action === undefined ? ` action="${escapeAttribute(`/_m/${key}`)}"` : '',
    props['data-mutation'] === undefined ? ` data-mutation="${escapeAttribute(key)}"` : '',
  ].join('');
}

function isMutationDefinitionLike(value: unknown): value is { key: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { key?: unknown }).key === 'string'
  );
}

function renderJsxContent(props: JsxProps): JsxNode {
  const rawHtml = rawHtmlContent(props);
  return rawHtml === undefined ? props.children : rawHtml;
}

function attributeText(name: string, value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return value.toString();
  if (name === 'style' && isStyleProperties(value)) return renderStyleProperties(value);

  return JSON.stringify(value) ?? '';
}

function isStyleProperties(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function renderStyleProperties(properties: Record<string, unknown>): string {
  return Object.entries(properties)
    .map(([propertyName, propertyValue]) => kovoStyleProperty(propertyName, propertyValue))
    .filter(Boolean)
    .join('; ');
}

function rawHtmlContent(props: JsxProps): string | undefined {
  for (const [name, value] of Object.entries(props)) {
    if (!isRawHtmlAttribute(name)) continue;

    // SPEC.md §1/§5.2: raw HTML is an explicit escape hatch, so dynamic values
    // that are not Kovo TrustedHtml or browser TrustedHTML-compatible no-op.
    return kovoTrustedHtmlContent(value);
  }

  return undefined;
}

function isRawHtmlAttribute(name: string): boolean {
  return (
    name === 'dangerouslySetInnerHTML' ||
    name === 'innerHTML' ||
    name === 'rawHtml' ||
    name === 'html'
  );
}

function renderJsxChildren(children: JsxNode): string {
  if (children === null || children === undefined || typeof children === 'boolean') return '';
  if (Array.isArray(children)) return children.map((child) => renderJsxChildren(child)).join('');

  return String(children);
}

export declare namespace JSX {
  type Element = string;
  type ElementType = JsxComponent | string;
  interface ElementChildrenAttribute {
    children: unknown;
  }
  interface IntrinsicElements {
    [tag: string]: Record<string, unknown>;
  }
}
