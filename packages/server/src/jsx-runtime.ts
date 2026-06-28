import type {
  Component,
  ComponentDefinitionInput,
  ComponentRenderSlots,
  ErrorBoundaryProps,
  FieldErrorProps,
  FormErrorProps,
  JsonValue,
} from '@kovojs/core';
import type { TrustedHtml } from '@kovojs/browser';
import { ErrorBoundary, FieldError, FormError } from '@kovojs/core';
import { kovoStyleProperty, kovoTrustedHtmlContent } from '@kovojs/browser/internal/output';
import { attrs as kovoStyleAttrs, type StyleInput } from '@kovojs/style';

import { componentMutationFailureSlots } from './component-render.js';
import {
  renderMutationCsrfField,
  renderMutationIdemField,
  type CsrfValidationOptions,
} from './csrf.js';
import {
  escapeAttribute,
  renderedHtml,
  type RenderedHtml,
  safeRuntimeAttribute,
  safeRuntimeAttributeName,
  unwrapCoercedRenderedHtml,
} from './html.js';
import { currentJsxFrameworkContext, currentJsxRequestContext } from './jsx-context.js';
import { runQuery, type QueryDefinition } from './query.js';
import { renderServerRenderable } from './renderable.js';
import { stampKovoComponentRoot } from './component-root-stamps.js';

// Server-side JSX runtime. Components author JSX sugar (SPEC.md section 4.1)
// and render to light-DOM HTML strings (SPEC.md section 3 pipeline, section
// 4.2 rendered output) — there is no virtual DOM and no client framework; the
// rendered string IS the runtime form, self-describing through its stamps.
//
// Rendering rules:
// - Attribute values are escaped; `true` renders a bare attribute (`enhance`),
//   `false`/`null`/`undefined` omit the attribute (mirroring the loader's
//   attribute-binding empty semantics, SPEC.md section 4.8).
// - Child strings are escaped as text. Framework-rendered HTML is carried
//   through the internal RenderedHtml brand so nested JSX composes without
//   turning app/DB text into markup (SPEC.md §4.5, §5.2).

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

const kovoFormKeyFieldName = 'kovo-form-key';
const mutationFormHelperRegistryKey = Symbol.for('kovo.mutationFormHelperRegistry');
const getRouteFormHelperKindKey = Symbol.for('kovo.getRouteFormHelperKind');

/** @generated JSX automatic-runtime ABI node type (compiler-emitted). */
export type JsxNode =
  | JsxChild[]
  | boolean
  | null
  | number
  | RenderedHtml
  | string
  | TrustedHtml
  | undefined;

/** @generated JSX automatic-runtime ABI child value, including async component output. */
export type JsxChild = JsxNode | Promise<JsxNode>;

/** @generated JSX automatic-runtime ABI maybe-async node type. */
export type MaybeAsyncJsxNode = JsxChild;

/** @generated JSX automatic-runtime ABI props type (compiler-emitted). */
export interface JsxProps {
  children?: JsxChild;
  [attribute: string]: unknown;
}

type MaybePromise<Value> = Promise<Value> | Value;

/** @generated JSX automatic-runtime ABI component type (compiler-emitted). */
export type JsxComponent<Props extends object = Record<string, never>> = (props: Props) => any;

type KovoJsxComponent = Component<ComponentDefinitionInput>;

type MutationFormHelperKind = 'field' | 'form';

interface MutationFormHelperPlaceholder {
  kind: MutationFormHelperKind;
  props: JsxProps;
}

interface MutationFormHelperRegistry {
  nextId: number;
  placeholders: Map<number, MutationFormHelperPlaceholder>;
}

/** @generated JSX automatic-runtime ABI `Fragment` (compiler-emitted). */
export function Fragment(props: JsxProps): MaybePromise<RenderedHtml> {
  return toRenderedHtml(renderJsxChildren(props.children));
}

/** @generated JSX automatic-runtime ABI `jsx` factory (compiler-emitted). */
export function jsx(
  type: JsxComponent | KovoJsxComponent | string,
  props: JsxProps,
  key?: unknown,
): MaybePromise<RenderedHtml> {
  if (isErrorBoundaryComponent(type)) {
    return renderErrorBoundary(props as unknown as ErrorBoundaryProps);
  }
  if (isMutationFormHelperComponent(type, FieldError, 'FieldError')) {
    return renderMutationFormHelper('field', props);
  }
  if (isMutationFormHelperComponent(type, FormError, 'FormError')) {
    return renderMutationFormHelper('form', props);
  }
  if (isGetRouteFormHelperComponent(type, 'form')) {
    return jsx('form', {
      ...props,
      action: props.action ?? (type as { action?: unknown }).action,
      method: props.method ?? 'get',
    });
  }
  if (isGetRouteFormHelperComponent(type, 'input')) {
    return jsx('input', props);
  }
  if (isKovoComponent(type)) return renderKovoComponent(type, props, key);
  if (typeof type === 'function') {
    const component = type as JsxComponent<JsxProps>;
    return toRenderedHtml(renderJsxChildren(component(props)));
  }

  const attributes = renderJsxAttributes(type, props, key);
  if (voidElements.has(type)) return renderedHtml(`<${type}${attributes}>`);

  const children = renderJsxChildren(renderJsxContent(props));
  const afterChildren = type === 'form' ? renderFormAfterChildrenContent(props, key) : '';
  return isPromiseLike(children)
    ? children.then((html) =>
        renderedHtml(
          `<${type}${attributes}>${renderFormChildrenContent(type, props, key, html)}${afterChildren}</${type}>`,
        ),
      )
    : renderedHtml(
        `<${type}${attributes}>${renderFormChildrenContent(type, props, key, children)}${afterChildren}</${type}>`,
      );
}

function isErrorBoundaryComponent(type: JsxComponent | KovoJsxComponent | string): boolean {
  return (
    (type as unknown) === ErrorBoundary ||
    (typeof type === 'function' && type.name === 'ErrorBoundary')
  );
}

function renderErrorBoundary(props: ErrorBoundaryProps): MaybePromise<RenderedHtml> {
  try {
    const rendered = renderJsxChildren(props.children as JsxNode);
    return isPromiseLike(rendered)
      ? rendered
          .catch((error) => renderErrorBoundaryFallback(props, error))
          .then((html) => (typeof html === 'string' ? renderedHtml(html) : html))
      : renderedHtml(rendered);
  } catch (error) {
    return renderErrorBoundaryFallback(props, error);
  }
}

function renderErrorBoundaryFallback(
  props: ErrorBoundaryProps,
  error: unknown,
): MaybePromise<RenderedHtml> {
  const fallback = typeof props.fallback === 'function' ? props.fallback(error) : props.fallback;
  return toRenderedHtml(renderJsxChildren(fallback as JsxNode));
}

function isMutationFormHelperComponent(
  type: JsxComponent | KovoJsxComponent | string,
  helper: unknown,
  name: string,
): boolean {
  return type === helper || (typeof type === 'function' && type.name === name);
}

function isGetRouteFormHelperComponent(
  type: JsxComponent | KovoJsxComponent | string,
  kind: 'form' | 'input',
): boolean {
  return (
    typeof type === 'function' &&
    (type as unknown as Record<symbol, unknown>)[getRouteFormHelperKindKey] === kind
  );
}

/** @generated JSX automatic-runtime ABI `jsxs` factory (compiler-emitted). */
export const jsxs = jsx;

/** @generated JSX automatic-runtime ABI `jsxDEV` factory (compiler-emitted). */
export function jsxDEV(
  type: JsxComponent | KovoJsxComponent | string,
  props: JsxProps,
  key?: unknown,
): MaybePromise<RenderedHtml> {
  return jsx(type, props, key);
}

function renderJsxAttributes(type: string, props: JsxProps, jsxKey?: unknown): string {
  let rendered = '';
  const key = props['kovo-key'] === undefined ? (props.key ?? jsxKey) : undefined;
  const styleAttrs = kovoStyleInputAttributes(props.style);
  const viewTransitionStyle = kovoStyleProperty('view-transition-name', props.viewTransitionName);
  let renderedClass = false;
  let renderedStyle = false;
  let renderedStyleSource = false;

  if (key !== false && key !== null && key !== undefined) {
    rendered += ` kovo-key="${escapeAttribute(attributeText('kovo-key', key))}"`;
  }

  for (const [name, value] of Object.entries(props)) {
    if (
      name === 'children' ||
      name === 'key' ||
      name === 'viewTransitionName' ||
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

    if (styleAttrs && name === 'style') {
      continue;
    }
    if (styleAttrs && name === 'class') {
      const className = [attributeText(name, value), styleAttrs.class].filter(Boolean).join(' ');
      rendered += ` class="${escapeAttribute(className)}"`;
      renderedClass = true;
      continue;
    }
    if (styleAttrs && name === 'data-style-src') {
      const source = [attributeText(name, value), styleAttrs['data-style-src']]
        .filter(Boolean)
        .join('; ');
      rendered += ` data-style-src="${escapeAttribute(source)}"`;
      renderedStyleSource = true;
      continue;
    }

    if (name === 'style' && isStyleProperties(value)) {
      const style = mergedStyle(renderStyleProperties(value), viewTransitionStyle);
      if (style) rendered += ` style="${escapeAttribute(style)}"`;
      renderedStyle = true;
      continue;
    }

    // SPEC.md §4.8 + §5.2#10: the sink policy classifies attribute VALUES but
    // trusts the NAME verbatim. A dynamic spread (`<div {...record}>`) can carry
    // attacker-controlled keys (a jsonb column, CMS blob, `Object.fromEntries`),
    // so the name is fail-closed against a strict allowlist first. A hostile key
    // like `x><img onerror=…>` (or a boolean-true key injecting raw `<script>`) is
    // omitted before HTML is emitted. Guards BOTH the value and boolean-true
    // branches below.
    if (!safeRuntimeAttributeName(name)) continue;
    // URL values are scheme-checked, srcset candidate lists are filtered, and
    // executable sinks (`on*`, `srcdoc`, raw CSS/HTML text) are omitted.
    const attributeValue = safeRuntimeAttribute(name, attributeText(name, value));
    if (attributeValue === null) continue;
    rendered += value === true ? ` ${name}` : ` ${name}="${attributeValue}"`;
  }

  if (styleAttrs?.class && !renderedClass)
    rendered += ` class="${escapeAttribute(styleAttrs.class)}"`;
  if (styleAttrs?.['data-style-src'] && !renderedStyleSource) {
    rendered += ` data-style-src="${escapeAttribute(styleAttrs['data-style-src'])}"`;
  }
  const finalStyle = mergedStyle(styleAttrs?.style, viewTransitionStyle);
  if (finalStyle && !renderedStyle) rendered += ` style="${escapeAttribute(finalStyle)}"`;

  return rendered;
}

function mergedStyle(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join('; ');
}

function kovoStyleInputAttributes(value: unknown):
  | {
      readonly class?: string;
      readonly 'data-style-src'?: string;
      readonly style?: string;
    }
  | undefined {
  if (!isKovoStyleInput(value)) return undefined;
  return kovoStyleAttrs(value as StyleInput);
}

function isKovoStyleInput(value: unknown): boolean {
  if (!value) return false;
  if (Array.isArray(value)) return value.some(isKovoStyleInput);
  return typeof value === 'object' && value !== null && '$$css' in value;
}

function renderMutationFormAttributes(key: string, props: JsxProps): string {
  return [
    props.method === undefined ? ' method="post"' : '',
    props.action === undefined ? ` action="${escapeAttribute(`/_m/${key}`)}"` : '',
    props['data-mutation'] === undefined ? ` data-mutation="${escapeAttribute(key)}"` : '',
  ].join('');
}

function renderFormAfterChildrenContent(props: JsxProps, jsxKey?: unknown): string {
  return `${renderFormKeyContent(props, jsxKey)}${renderFormCsrfContent(props)}`;
}

function renderFormKeyContent(props: JsxProps, jsxKey?: unknown): string {
  if (!isMutationDefinitionLike(props.mutation)) return '';
  const key = formKeyValue(props, jsxKey);
  if (key === undefined) return '';

  return `<input type="hidden" name="${kovoFormKeyFieldName}" value="${escapeAttribute(key)}">`;
}

function renderFormCsrfContent(props: JsxProps): string {
  if (!isMutationDefinitionLike(props.mutation)) return '';
  // SPEC.md §10.3:1063/1065: no-JS forms must carry a per-submit idem field so
  // the server can dedup double-submits and Back-resubmit via the replay store.
  return renderMutationCsrfField(props.mutation) + renderMutationIdemField();
}

function isMutationDefinitionLike(
  value: unknown,
): value is { csrf?: CsrfValidationOptions<unknown> | false; key: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { key?: unknown }).key === 'string'
  );
}

function renderFormChildrenContent(
  type: string,
  props: JsxProps,
  jsxKey: unknown,
  html: string,
): string {
  if (type !== 'form') return html;
  return resolveMutationFormHelperPlaceholders(html, props, jsxKey);
}

function renderMutationFormHelper(kind: MutationFormHelperKind, props: JsxProps): RenderedHtml {
  if (props.failure !== undefined) {
    return renderedHtml(renderMutationFormHelperNow(kind, props, props.failure));
  }

  const registry = mutationFormHelperRegistry();
  registry.nextId += 1;
  registry.placeholders.set(registry.nextId, { kind, props });
  return renderedHtml(`<!--kovo-form-helper:${registry.nextId}-->`);
}

function resolveMutationFormHelperPlaceholders(
  html: string,
  formProps: JsxProps,
  jsxKey: unknown,
): string {
  if (!html.includes('<!--kovo-form-helper:')) return html;
  const failure = mutationFailureForForm(formProps, jsxKey);

  return html.replace(/<!--kovo-form-helper:(\d+)-->/g, (_match, idText: string) => {
    const id = Number(idText);
    const registry = mutationFormHelperRegistry();
    const placeholder = registry.placeholders.get(id);
    registry.placeholders.delete(id);
    if (!placeholder) return '';

    return renderMutationFormHelperNow(placeholder.kind, placeholder.props, failure);
  });
}

function mutationFormHelperRegistry(): MutationFormHelperRegistry {
  const global = globalThis as typeof globalThis & Record<symbol, unknown>;
  global[mutationFormHelperRegistryKey] ??= {
    nextId: 0,
    placeholders: new Map(),
  };
  return global[mutationFormHelperRegistryKey] as MutationFormHelperRegistry;
}

function renderMutationFormHelperNow(
  kind: MutationFormHelperKind,
  props: JsxProps,
  failure: unknown,
): string {
  const helperProps = { ...props, failure };
  return kind === 'field'
    ? FieldError(helperProps as FieldErrorProps)
    : FormError(helperProps as FormErrorProps);
}

function mutationFailureForForm(formProps: JsxProps, jsxKey: unknown): unknown {
  const mutation = formProps.mutation;
  if (!isMutationDefinitionLike(mutation)) return null;

  const failureContext = currentJsxFrameworkContext()?.mutationFailure;
  if (!failureContext || failureContext.mutationKey !== mutation.key) return null;

  const key = formKeyValue(formProps, jsxKey);
  if (key === undefined) return formFailureFromMutationFailure(failureContext.failure);

  const submittedKey = submittedFormKey(failureContext.input);
  if (submittedKey !== undefined) {
    return submittedKey === key ? formFailureFromMutationFailure(failureContext.failure) : null;
  }
  if (failureContext.target && failureContext.target.endsWith(`:${key}`)) {
    return formFailureFromMutationFailure(failureContext.failure);
  }

  return submittedInputContainsValue(failureContext.input, key)
    ? formFailureFromMutationFailure(failureContext.failure)
    : null;
}

function formFailureFromMutationFailure(failure: unknown): unknown {
  if (!isRecord(failure)) return failure;
  const error = failure.error;
  if (!isRecord(error) || typeof error.code !== 'string') return failure;
  if (error.code === 'VALIDATION') {
    return {
      code: 'VALIDATION',
      fieldErrors: validationFieldErrors(error.payload),
    };
  }
  return {
    code: error.code,
    payload: error.payload,
  };
}

function validationFieldErrors(payload: unknown): Record<string, string> {
  if (!isRecord(payload) || !Array.isArray(payload.issues)) return {};
  const fieldErrors: Record<string, string> = {};
  for (const issue of payload.issues) {
    if (!isRecord(issue) || typeof issue.message !== 'string' || !Array.isArray(issue.path)) {
      continue;
    }
    const path = issue.path.map((part) => String(part)).join('.');
    if (path) fieldErrors[path] = issue.message;
  }
  return fieldErrors;
}

function formKeyValue(props: JsxProps, jsxKey?: unknown): string | undefined {
  const key = props['kovo-key'] ?? props.key ?? jsxKey;
  if (key === false || key === null || key === undefined) return undefined;
  return attributeText('kovo-key', key);
}

function submittedFormKey(input: unknown): string | undefined {
  if (input instanceof FormData) {
    const value = input.get(kovoFormKeyFieldName);
    return typeof value === 'string' ? value : undefined;
  }
  if (isRecord(input)) {
    const value = input[kovoFormKeyFieldName];
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

function submittedInputContainsValue(input: unknown, value: string): boolean {
  if (input instanceof FormData) {
    for (const submitted of input.values()) {
      if (submitted === value) return true;
    }
    return false;
  }
  if (!isRecord(input)) return false;
  return Object.values(input).some((submitted) => submitted === value);
}

function renderJsxContent(props: JsxProps): JsxChild {
  const rawHtml = rawHtmlContent(props);
  return rawHtml === undefined ? props.children : renderedHtml(rawHtml);
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

function renderJsxChildren(children: JsxChild): MaybePromise<string> {
  return renderServerRenderable(children);
}

function toRenderedHtml(value: MaybePromise<string>): MaybePromise<RenderedHtml> {
  return isPromiseLike(value) ? value.then((html) => renderedHtml(html)) : renderedHtml(value);
}

async function renderKovoComponent(
  component: KovoJsxComponent,
  props: JsxProps,
  jsxKey?: unknown,
): Promise<RenderedHtml> {
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
  const html =
    typeof rendered === 'string'
      ? unwrapCoercedRenderedHtml(rendered)
      : await renderJsxChildren(rendered);
  const context = currentJsxFrameworkContext();
  return renderedHtml(
    stampKovoComponentRoot({
      component,
      ...(context?.csrf === undefined ? {} : { csrf: context.csrf }),
      html,
      jsxKey,
      props,
      request: context?.request,
    }),
  );
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

    const maxListItems = currentJsxFrameworkContext()?.maxListItems;
    const result = await runQuery(
      resolved.query,
      resolved.input,
      request,
      maxListItems === undefined ? {} : { maxListItems },
    );
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
    ? Object.fromEntries(
        Object.keys(component.definition.mutations).map((key) => [key, { failure: null }]),
      )
    : undefined;

  let slots: ComponentRenderSlots = {
    ...(props.children === undefined ? {} : { children: props.children }),
    ...(forms === undefined ? {} : { forms }),
    ...jsxPropsToSlots(props),
    ...(request === undefined ? {} : { request }),
  };

  const failureContext = currentJsxFrameworkContext()?.mutationFailure;
  if (!failureContext || !isRecord(component.definition.mutations)) return slots;

  for (const [name, mutation] of Object.entries(component.definition.mutations)) {
    if (isMutationDefinitionLike(mutation) && mutation.key === failureContext.mutationKey) {
      slots = componentMutationFailureSlots(name, failureContext.failure, slots);
    }
  }

  return slots;
}

function jsxPropsToSlots(props: JsxProps): ComponentRenderSlots {
  return Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'children'));
}

function isKovoComponent(value: unknown): value is KovoJsxComponent {
  return (
    isObjectLike(value) &&
    isRecord(value.definition) &&
    typeof value.definition.render === 'function'
  );
}

function isQueryDefinition(value: unknown): value is QueryDefinition {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    (value.reads === undefined || Array.isArray(value.reads))
  );
}

function isQueryArgsBinding(
  value: unknown,
): value is { args: (props: JsxProps) => unknown; query: QueryDefinition } {
  return isRecord(value) && typeof value.args === 'function' && isQueryDefinition(value.query);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null;
}

function isPromiseLike<Value>(value: MaybePromise<Value>): value is Promise<Value> {
  return isRecord(value) && typeof value.then === 'function';
}

/** @generated JSX automatic-runtime ABI `JSX` namespace (compiler-emitted). */
export declare namespace JSX {
  // Kovo's current component render-result model uses an opaque `object` and
  // existing route/site helpers often annotate JSX-returning helpers as `string`.
  // Keep the expression result broad while enforcing props, children, and
  // intrinsic attributes through the call-site prop types below.
  type Element = any;
  type ElementType = JsxComponent<any> | KovoJsxComponent | keyof IntrinsicElements;
  interface ElementChildrenAttribute {
    children: {};
  }
  interface IntrinsicAttributes {
    key?: number | string;
    'kovo-key'?: number | string;
  }
  type AttributeValue = boolean | number | RenderedHtml | string | TrustedHtml | null | undefined;
  type StyleProperties = Record<string, boolean | number | string | null | undefined>;
  type AriaBoolean = boolean | 'false' | 'true';
  interface AriaAttributes {
    'aria-activedescendant'?: AttributeValue;
    'aria-atomic'?: AttributeValue;
    'aria-busy'?: AttributeValue;
    'aria-controls'?: AttributeValue;
    'aria-current'?:
      | boolean
      | 'date'
      | 'false'
      | 'location'
      | 'page'
      | 'step'
      | 'time'
      | 'true'
      | undefined;
    'aria-describedby'?: AttributeValue;
    'aria-details'?: AttributeValue;
    'aria-disabled'?: AttributeValue;
    'aria-expanded'?: AttributeValue;
    'aria-haspopup'?: AttributeValue;
    'aria-hidden'?: AttributeValue;
    'aria-invalid'?: AttributeValue;
    'aria-label'?: AttributeValue;
    'aria-labelledby'?: AttributeValue;
    'aria-live'?: 'assertive' | 'off' | 'polite' | undefined;
    'aria-modal'?: AttributeValue;
    'aria-pressed'?: AttributeValue;
    'aria-selected'?: AttributeValue;
    'aria-valuemax'?: AttributeValue;
    'aria-valuemin'?: AttributeValue;
    'aria-valuenow'?: AttributeValue;
    'aria-valuetext'?: AttributeValue;
  }
  interface HtmlAttributes extends IntrinsicAttributes, AriaAttributes {
    [attribute: `data-${string}`]: AttributeValue;
    [attribute: `kovo-${string}`]: AttributeValue;
    [attribute: `on:${string}`]: string | undefined;
    action?: AttributeValue;
    alt?: AttributeValue;
    acceptCharset?: AttributeValue;
    autocomplete?: AttributeValue;
    autoComplete?: AttributeValue;
    autofocus?: AttributeValue;
    autoFocus?: AttributeValue;
    checked?: AttributeValue;
    children?: unknown;
    class?: string;
    className?: string;
    closedby?: AttributeValue;
    'clip-rule'?: string;
    command?: AttributeValue;
    commandfor?: AttributeValue;
    contenteditable?: boolean | 'false' | 'plaintext-only' | 'true';
    cx?: number | string;
    cy?: number | string;
    d?: string;
    decoding?: AttributeValue;
    disabled?: AttributeValue;
    download?: AttributeValue;
    draggable?: boolean | 'false' | 'true';
    dir?: AttributeValue;
    enctype?: AttributeValue;
    encType?: AttributeValue;
    enhance?: boolean;
    external?: boolean;
    fill?: string;
    'fill-rule'?: string;
    focusable?: boolean | 'false' | 'true';
    for?: AttributeValue;
    form?: AttributeValue;
    height?: number | string;
    hidden?: AttributeValue;
    high?: AttributeValue;
    href?: AttributeValue;
    htmlFor?: AttributeValue;
    html?: TrustedHtml;
    id?: AttributeValue;
    inert?: boolean;
    innerHTML?: TrustedHtml;
    inputmode?: string;
    inputMode?: AttributeValue;
    low?: AttributeValue;
    max?: AttributeValue;
    maxLength?: AttributeValue;
    label?: AttributeValue;
    list?: AttributeValue;
    loading?: AttributeValue;
    method?: string;
    min?: AttributeValue;
    minLength?: AttributeValue;
    mutation?: { key: string };
    name?: AttributeValue;
    onClick?: (event?: unknown) => void;
    onKeyDown?: (event?: unknown) => void;
    open?: AttributeValue;
    optimum?: AttributeValue;
    pattern?: AttributeValue;
    placeholder?: AttributeValue;
    popover?: AttributeValue;
    popovertarget?: AttributeValue;
    popovertargetaction?: AttributeValue;
    points?: string;
    r?: number | string;
    rawHtml?: TrustedHtml;
    readOnly?: AttributeValue;
    rel?: AttributeValue;
    referrerpolicy?: AttributeValue;
    referrerPolicy?: AttributeValue;
    required?: AttributeValue;
    role?: AttributeValue;
    rows?: AttributeValue;
    rx?: number | string;
    ry?: number | string;
    sandbox?: AttributeValue;
    scope?: AttributeValue;
    selected?: AttributeValue;
    sizes?: AttributeValue;
    src?: AttributeValue;
    srcset?: AttributeValue;
    srcSet?: AttributeValue;
    stroke?: string;
    'stroke-linecap'?: string;
    'stroke-linejoin'?: string;
    'stroke-width'?: number | string;
    step?: AttributeValue;
    style?: unknown;
    tabindex?: number;
    tabIndex?: AttributeValue;
    target?: AttributeValue;
    title?: AttributeValue;
    transform?: string;
    type?: AttributeValue;
    value?: AttributeValue;
    viewBox?: string;
    viewTransitionName?: AttributeValue;
    width?: number | string;
    x?: number | string;
    x1?: number | string;
    x2?: number | string;
    xmlns?: string;
    y?: number | string;
    y1?: number | string;
    y2?: number | string;
  }
  interface IntrinsicElements {
    [tag: string]: HtmlAttributes;
  }
}
