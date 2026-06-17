import type { Component, ComponentDefinitionInput, ComponentRenderSlots, JsonValue } from '@kovojs/core';
import { kovoStyleProperty, kovoTrustedHtmlContent } from '@kovojs/runtime';

import { escapeAttribute } from './html.js';
import { currentJsxRequestContext } from './jsx-context.js';
import { runQuery, type QueryDefinition } from './query.js';

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

export type JsxNode =
  | JsxNode[]
  | boolean
  | null
  | number
  | Promise<JsxNode>
  | string
  | undefined;

export interface JsxProps {
  children?: JsxNode;
  [attribute: string]: unknown;
}

type MaybePromise<Value> = Promise<Value> | Value;

export type JsxComponent = (props: JsxProps) => MaybePromise<string>;

type KovoJsxComponent = Component<ComponentDefinitionInput>;

export function Fragment(props: JsxProps): MaybePromise<string> {
  return renderJsxChildren(props.children);
}

export function jsx(type: JsxComponent | KovoJsxComponent | string, props: JsxProps): MaybePromise<string> {
  if (typeof type === 'function') return type(props);
  if (isKovoComponent(type)) return renderKovoComponent(type, props);

  const attributes = renderJsxAttributes(type, props);
  if (voidElements.has(type)) return `<${type}${attributes}>`;

  const children = renderJsxChildren(renderJsxContent(props));
  return isPromiseLike(children)
    ? children.then((html) => `<${type}${attributes}>${html}</${type}>`)
    : `<${type}${attributes}>${children}</${type}>`;
}

export const jsxs = jsx;

export function jsxDEV(
  type: JsxComponent | KovoJsxComponent | string,
  props: JsxProps,
): MaybePromise<string> {
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

function renderJsxChildren(children: JsxNode): MaybePromise<string> {
  if (children === null || children === undefined || typeof children === 'boolean') return '';
  if (isPromiseLike(children)) return children.then((child) => renderJsxChildren(child));
  if (Array.isArray(children)) {
    const rendered = children.map((child) => renderJsxChildren(child));
    return rendered.some(isPromiseLike)
      ? Promise.all(rendered).then((values) => values.join(''))
      : rendered.join('');
  }

  return String(children);
}

async function renderKovoComponent(
  component: KovoJsxComponent,
  props: JsxProps,
): Promise<string> {
  const request = currentJsxRequestContext();
  const queries = await loadComponentQueries(component, props, request);
  const state = component.definition.state?.() as JsonValue | undefined;
  const slots = componentRenderSlots(component, props, request);
  const render = component.definition.render as (
    queries: Record<string, unknown>,
    state: JsonValue | undefined,
    slots: ComponentRenderSlots,
  ) => unknown;
  const rendered = render({ ...props, ...queries }, state, slots) as JsxNode;
  return renderJsxChildren(rendered);
}

async function loadComponentQueries(
  component: KovoJsxComponent,
  props: JsxProps,
  request: unknown,
): Promise<Record<string, unknown>> {
  const queryBindings = component.definition.queries;
  if (!isRecord(queryBindings)) return {};

  const values: Record<string, unknown> = {};
  for (const [name, binding] of Object.entries(queryBindings)) {
    const resolved = componentQueryBinding(binding, props);
    if (!resolved) continue;
    if (request === undefined) {
      throw new Error(`Route JSX component ${component.name ?? name} requires request context.`);
    }

    const result = await runQuery(resolved.query, resolved.input, request);
    if (!result.ok) {
      throw new Error(`Route JSX component query failed: ${resolved.query.key}`);
    }
    values[name] = result.value;
  }
  return values;
}

function componentQueryBinding(
  binding: unknown,
  props: JsxProps,
): { input: unknown; query: QueryDefinition } | undefined {
  if (isQueryDefinition(binding)) return { input: undefined, query: binding };
  if (isQueryArgsBinding(binding)) return { input: binding.args(props), query: binding.query };
  return undefined;
}

function componentRenderSlots(
  component: KovoJsxComponent,
  props: JsxProps,
  request: unknown,
): ComponentRenderSlots {
  const forms = isRecord(component.definition.mutations)
    ? Object.fromEntries(Object.keys(component.definition.mutations).map((key) => [key, { failure: null }]))
    : undefined;

  return {
    ...(props.children === undefined ? {} : { children: props.children }),
    ...(forms === undefined ? {} : { forms }),
    ...(request === undefined ? {} : { request }),
  };
}

function isKovoComponent(value: unknown): value is KovoJsxComponent {
  return (
    isRecord(value) &&
    isRecord(value.definition) &&
    typeof value.definition.render === 'function'
  );
}

function isQueryDefinition(value: unknown): value is QueryDefinition {
  return isRecord(value) && typeof value.key === 'string' && Array.isArray(value.reads);
}

function isQueryArgsBinding(
  value: unknown,
): value is { args: (props: JsxProps) => unknown; query: QueryDefinition } {
  return (
    isRecord(value) &&
    typeof value.args === 'function' &&
    isQueryDefinition(value.query)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPromiseLike<Value>(value: MaybePromise<Value>): value is Promise<Value> {
  return isRecord(value) && typeof value.then === 'function';
}

export declare namespace JSX {
  type Element = MaybePromise<string>;
  type ElementType = JsxComponent | KovoJsxComponent | string;
  interface ElementChildrenAttribute {
    children: unknown;
  }
  interface IntrinsicElements {
    [tag: string]: Record<string, unknown>;
  }
}
