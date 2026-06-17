import { kovoStyleProperty } from '@kovojs/runtime';

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

  const attributes = renderJsxAttributes(props);
  if (voidElements.has(type)) return `<${type}${attributes}>`;

  return `<${type}${attributes}>${renderJsxChildren(props.children)}</${type}>`;
}

export const jsxs = jsx;

export function jsxDEV(type: JsxComponent | string, props: JsxProps): string {
  return jsx(type, props);
}

function renderJsxAttributes(props: JsxProps): string {
  let rendered = '';

  for (const [name, value] of Object.entries(props)) {
    if (name === 'children' || value === false || value === null || value === undefined) continue;
    rendered +=
      value === true
        ? ` ${name}`
        : ` ${name}="${escapeAttribute(attributeText(name, value))}"`;
  }

  return rendered;
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
