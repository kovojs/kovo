import type { Component, ComponentDefinitionInput } from '@kovojs/core';

type JsxNode = JsxNode[] | boolean | null | number | Promise<JsxNode> | string | undefined;

interface JsxProps {
  children?: JsxNode;
  [attribute: string]: unknown;
}

type JsxComponent = (props: any) => any;
type KovoJsxComponent = Component<ComponentDefinitionInput>;
type MaybePromise<Value> = Promise<Value> | Value;

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

export function Fragment(props: JsxProps): MaybePromise<string> {
  return renderJsxChildren(props.children);
}

export function jsx(
  type: JsxComponent | KovoJsxComponent | string,
  props: JsxProps,
  key?: unknown,
): MaybePromise<string> {
  if (isKovoComponent(type)) return renderKovoComponent(type, props);
  if (typeof type === 'function') return type(props);

  const attributes = renderJsxAttributes(props, key);
  if (voidElements.has(type)) return `<${type}${attributes}>`;

  const children = renderJsxChildren(props.children);
  return isPromiseLike(children)
    ? children.then((html) => `<${type}${attributes}>${html}</${type}>`)
    : `<${type}${attributes}>${children}</${type}>`;
}

export const jsxs = jsx;
export const jsxDEV = jsx;

async function renderKovoComponent(component: KovoJsxComponent, props: JsxProps): Promise<string> {
  const state = component.definition.state?.();
  const render = component.definition.render as (
    queries: Record<string, unknown>,
    state: unknown,
    slots: Record<string, unknown>,
  ) => unknown;
  const rendered = render({ ...props }, state, jsxPropsToSlots(props)) as JsxNode;
  return renderJsxChildren(rendered);
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

  for (const [name, value] of Object.entries(props)) {
    if (name === 'children' || name === 'key' || value === false || value == null) continue;
    rendered +=
      value === true ? ` ${name}` : ` ${name}="${escapeAttribute(serializeAttributeValue(value))}"`;
  }

  return rendered;
}

function renderJsxChildren(children: JsxNode): MaybePromise<string> {
  if (children === null || children === undefined || typeof children === 'boolean') return '';
  if (isPromiseLike(children)) return children.then((child) => renderJsxChildren(child));
  if (Array.isArray(children)) {
    const rendered = children.map((child) => renderJsxChildren(child));
    return rendered.some(isPromiseLike)
      ? Promise.all(rendered.map((value) => Promise.resolve(value))).then((values) =>
          values.join(''),
        )
      : (rendered as string[]).join('');
  }

  return String(children);
}

function isKovoComponent(value: unknown): value is KovoJsxComponent {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { definition?: { render?: unknown } }).definition?.render === 'function'
  );
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
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

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
