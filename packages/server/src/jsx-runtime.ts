import './security-bootstrap.js';

import type {
  Component,
  ComponentDefinitionInput,
  ComponentProps,
  ComponentRenderSlots,
  ErrorBoundaryProps,
  JsonValue,
} from '@kovojs/core';
import type { TrustedHtml, TrustedUrl } from '@kovojs/browser';
import { ErrorBoundary, FieldError, FormError } from '@kovojs/core';
import { isUrlAttributeName } from '@kovojs/core/internal/security-url';
import {
  drainRuntimeSinkSecurityEvent,
  type RuntimeSinkSecurityEvent,
} from '@kovojs/core/internal/sink-policy';
import {
  isKovoTrustedUrl,
  kovoStyleProperty,
  kovoTrustedHtmlContent,
} from '@kovojs/browser/internal/output';
import { attrs as kovoStyleAttrs, type StyleInput } from '@kovojs/style';

import { componentMutationFailureSlots } from './component-render.js';
import { isKovoComponentDescriptor } from './component-authority.js';
import { renderMutationCsrfField, renderMutationIdemField, type CsrfOptions } from './csrf.js';
import {
  escapeAttribute,
  renderedHtml,
  type RenderedHtml,
  safeRuntimeAttribute,
  safeRuntimeAttributeName,
} from './html.js';
import {
  currentJsxFrameworkContext,
  currentJsxMutationFormHelperRegistry,
  currentJsxRequestContext,
  type JsxMutationFormHelperKind,
} from './jsx-context.js';
import {
  deferMutationFormHelper,
  renderMutationFormHelperOutput,
  resolveMutationFormHelpers,
  structuredMutationFormHelperOperation,
} from './jsx-form-helper.js';
import {
  formHelperCreateRecord,
  formHelperDefineArrayValue,
  formHelperDefineDataProperty,
  formHelperIsArray,
  formHelperIsSafeElementName,
  formHelperIsPromise,
  formHelperObjectKeys,
  formHelperOwnDataValue,
  formHelperPromiseAll,
  formHelperPromiseThen,
  formHelperSnapshotRecord,
  formHelperString,
  formHelperStringEndsWith,
  formHelperStringStartsWith,
  formHelperStringToLowerCase,
} from './jsx-form-helper-intrinsics.js';
import { recordQueryRuntimeWarnings, runQuery, type QueryDefinition } from './query.js';
import {
  requestFormDataGet,
  requestFormDataValues,
  requestIsFormData,
} from './request-body-intrinsics.js';
import { renderServerRenderable } from './renderable.js';
import { stampKovoComponentRoot } from './component-root-stamps.js';
import { isDocumentConfig, isStructuredDocumentNode } from './document-structured.js';
import { revealUntrustedRequestValue } from './untrusted-request-body.js';

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

const kovoFormKeyFieldName = 'kovo-form-key';
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
type KovoJsxComponentProps<Type> =
  Type extends Component<infer Definition> ? ComponentProps<Definition> : never;

/** @generated JSX automatic-runtime ABI `Fragment` (compiler-emitted). */
export function Fragment(props: JsxProps): MaybePromise<RenderedHtml> {
  return toRenderedHtml(renderJsxChildren(props.children));
}

/** @generated JSX automatic-runtime ABI `jsx` factory (compiler-emitted). */
export function jsx(
  type: JsxComponent | KovoJsxComponent | string,
  props: JsxProps,
  key?: unknown,
): MaybePromise<RenderedHtml | object> {
  if (isErrorBoundaryComponent(type)) {
    return renderErrorBoundary(props as unknown as ErrorBoundaryProps);
  }
  if (isMutationFormHelperComponent(type, FieldError)) {
    return renderMutationFormHelper('field', props);
  }
  if (isMutationFormHelperComponent(type, FormError)) {
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
    const functionComponent = type as JsxComponent<JsxProps>;
    return renderFunctionComponentResult(functionComponent(props));
  }

  const intrinsicProps = formHelperSnapshotRecord(props, 'JSX intrinsic element props') as JsxProps;
  if (!formHelperIsSafeElementName(type)) {
    drainRuntimeSinkSecurityEvent(
      runtimeElementSinkEvent(
        'element-name',
        'attribute',
        type,
        'element name is not a safe HTML name token',
      ),
    );
    return renderedHtml('');
  }
  const attributes = renderJsxAttributes(type, intrinsicProps, key);
  if (isVoidElement(type)) return renderedHtml(`<${type}${attributes}>`);

  const children = renderJsxElementChildren(type, intrinsicProps);
  const afterChildren = type === 'form' ? renderFormAfterChildrenContent(intrinsicProps, key) : '';
  return isPromiseLike(children)
    ? formHelperPromiseThen(children, (html) =>
        renderedHtml(
          `<${type}${attributes}>${renderFormChildrenContent(type, intrinsicProps, key, html)}${afterChildren}</${type}>`,
        ),
      )
    : renderedHtml(
        `<${type}${attributes}>${renderFormChildrenContent(type, intrinsicProps, key, children)}${afterChildren}</${type}>`,
      );
}

function isVoidElement(type: string): boolean {
  return (
    type === 'area' ||
    type === 'base' ||
    type === 'br' ||
    type === 'col' ||
    type === 'embed' ||
    type === 'hr' ||
    type === 'img' ||
    type === 'input' ||
    type === 'link' ||
    type === 'meta' ||
    type === 'source' ||
    type === 'track' ||
    type === 'wbr'
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
    if (!isPromiseLike(rendered)) return renderedHtml(rendered);
    const recovered = formHelperPromiseThen(
      rendered,
      (html) => html,
      (error) => renderErrorBoundaryFallback(props, error),
    );
    return formHelperPromiseThen(recovered, (html) =>
      typeof html === 'string' ? renderedHtml(html) : html,
    );
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
): boolean {
  return type === helper;
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
): MaybePromise<RenderedHtml | object> {
  return jsx(type, props, key);
}

/**
 * Classic JSX factory compatibility for build-tool transforms that lower Kovo-authored TSX to
 * `createElement(...)` instead of the automatic JSX runtime. Prefer `@kovojs/server/jsx-runtime`
 * for authored TSX configuration; this function delegates to the same server renderer.
 */
export function createElement(
  type: unknown,
  props: Record<string, unknown> | null,
  ...children: unknown[]
): unknown {
  const normalizedProps: JsxProps = { ...props };
  if (children.length === 1) {
    normalizedProps.children = children[0] as JsxChild;
  } else if (children.length > 1) {
    normalizedProps.children = children as JsxChild[];
  }
  return jsx(
    type as JsxComponent | KovoJsxComponent | string,
    normalizedProps,
    normalizedProps.key,
  );
}

function renderFunctionComponentResult(value: unknown): MaybePromise<RenderedHtml | object> {
  if (isPromiseLike(value)) return formHelperPromiseThen(value, renderFunctionComponentResult);
  if (isStructuredDocumentValue(value)) return value;
  return toRenderedHtml(renderJsxChildren(value as JsxChild));
}

function isStructuredDocumentValue(value: unknown): value is object {
  return isDocumentConfig(value) || isStructuredDocumentNode(value);
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

  const names = formHelperObjectKeys(props);
  for (let index = 0; index < names.length; index += 1) {
    const name = formHelperOwnDataValue(names, index);
    if (typeof name !== 'string') continue;
    const value = formHelperOwnDataValue(props, name);
    if (
      name === 'children' ||
      name === 'key' ||
      name === 'viewTransitionName' ||
      isRawHtmlAttribute(name) ||
      (value === false && !isAriaAttribute(name)) ||
      value === null ||
      value === undefined
    ) {
      continue;
    }
    if (type === 'form' && name === 'mutation' && isMutationDefinitionLike(value)) {
      rendered += renderMutationFormAttributes(value.key, props);
      continue;
    }
    if (name === 'stream') {
      continue;
    }
    if (name === 'streamText') {
      if (props['data-stream-text'] === undefined) {
        rendered += ` data-stream-text="${escapeAttribute(attributeText(name, value))}"`;
      }
      continue;
    }

    if (isKovoTrustedUrl(value) && !isUrlAttributeName(name)) {
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
    const attributeValue = renderContextualAttributeValue(type, props, name, value);
    if (attributeValue === null) continue;
    rendered +=
      value === true && !isAriaAttribute(name) ? ` ${name}` : ` ${name}="${attributeValue}"`;
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
  let attributes = '';
  if (formHelperOwnDataValue(props, 'method') === undefined) attributes += ' method="post"';
  if (formHelperOwnDataValue(props, 'action') === undefined) {
    attributes += ` action="${escapeAttribute(`/_m/${key}`)}"`;
  }
  if (formHelperOwnDataValue(props, 'data-mutation') === undefined) {
    attributes += ` data-mutation="${escapeAttribute(key)}"`;
  }
  if (
    formHelperOwnDataValue(props, 'stream') === true &&
    formHelperOwnDataValue(props, 'data-mutation-stream') === undefined
  ) {
    attributes += ' data-mutation-stream="true"';
  }
  return attributes;
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
): value is { csrf?: CsrfOptions<unknown> | false; key: string } {
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
  return resolveMutationFormHelpers(
    html,
    currentJsxMutationFormHelperRegistry(),
    mutationFailureForForm(props, jsxKey),
  );
}

function renderMutationFormHelper(kind: JsxMutationFormHelperKind, props: JsxProps): RenderedHtml {
  const failure = formHelperOwnDataValue(props, 'failure');
  if (failure !== undefined) {
    return renderedHtml(renderMutationFormHelperOutput(kind, props, failure));
  }

  return renderedHtml(deferMutationFormHelper(currentJsxMutationFormHelperRegistry(), kind, props));
}

function mutationFailureForForm(formProps: JsxProps, jsxKey: unknown): unknown {
  const mutation = formHelperOwnDataValue(formProps, 'mutation');
  if (!isRecord(mutation)) return null;
  const mutationKey = formHelperOwnDataValue(mutation, 'key');
  if (typeof mutationKey !== 'string') return null;

  const context = currentJsxFrameworkContext();
  const failureContext = context?.mutationFailure;
  if (!failureContext) return null;
  const failedMutationKey = formHelperOwnDataValue(failureContext, 'mutationKey');
  if (failedMutationKey !== mutationKey) return null;
  const failure = formHelperOwnDataValue(failureContext, 'failure');
  const input = formHelperOwnDataValue(failureContext, 'input');

  const key = formKeyValue(formProps, jsxKey);
  if (key === undefined) return formFailureFromMutationFailure(failure);

  const submittedKey = submittedFormKey(input);
  if (submittedKey !== undefined) {
    return submittedKey === key ? formFailureFromMutationFailure(failure) : null;
  }
  const target = formHelperOwnDataValue(failureContext, 'target');
  if (typeof target === 'string' && formHelperStringEndsWith(target, `:${key}`)) {
    return formFailureFromMutationFailure(failure);
  }

  return submittedInputContainsValue(input, key) ? formFailureFromMutationFailure(failure) : null;
}

function formFailureFromMutationFailure(failure: unknown): unknown {
  if (!isRecord(failure)) return failure;
  const error = formHelperOwnDataValue(failure, 'error');
  if (!isRecord(error)) return failure;
  const code = formHelperOwnDataValue(error, 'code');
  if (typeof code !== 'string') return failure;
  if (code === 'VALIDATION') {
    return {
      code: 'VALIDATION',
      fieldErrors: validationFieldErrors(formHelperOwnDataValue(error, 'payload')),
    };
  }
  return {
    code,
    payload: formHelperOwnDataValue(error, 'payload'),
  };
}

function validationFieldErrors(payload: unknown): Record<string, string> {
  const fieldErrors = formHelperCreateRecord() as Record<string, string>;
  if (!isRecord(payload)) return fieldErrors;
  const issues = formHelperOwnDataValue(payload, 'issues');
  if (!formHelperIsArray(issues)) return fieldErrors;
  for (let issueIndex = 0; issueIndex < issues.length; issueIndex += 1) {
    const issue = formHelperOwnDataValue(issues, issueIndex);
    if (!isRecord(issue)) continue;
    const message = formHelperOwnDataValue(issue, 'message');
    const issuePath = formHelperOwnDataValue(issue, 'path');
    if (typeof message !== 'string' || !formHelperIsArray(issuePath)) continue;
    let path = '';
    for (let pathIndex = 0; pathIndex < issuePath.length; pathIndex += 1) {
      const part = formHelperOwnDataValue(issuePath, pathIndex);
      if (part === undefined) {
        path = '';
        break;
      }
      if (path !== '') path += '.';
      path += formHelperString(part);
    }
    if (path !== '') formHelperDefineDataProperty(fieldErrors, path, message);
  }
  return fieldErrors;
}

function formKeyValue(props: JsxProps, jsxKey?: unknown): string | undefined {
  const explicitKey = formHelperOwnDataValue(props, 'kovo-key');
  const propKey = formHelperOwnDataValue(props, 'key');
  const key = explicitKey ?? propKey ?? jsxKey;
  if (key === false || key === null || key === undefined) return undefined;
  return formHelperString(key);
}

function submittedFormKey(input: unknown): string | undefined {
  if (requestIsFormData(input)) {
    const value = revealSubmittedFormValue(requestFormDataGet(input, kovoFormKeyFieldName));
    return typeof value === 'string' ? value : undefined;
  }
  if (isRecord(input)) {
    const value = revealSubmittedFormValue(formHelperOwnDataValue(input, kovoFormKeyFieldName));
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

function submittedInputContainsValue(input: unknown, value: string): boolean {
  if (requestIsFormData(input)) {
    const values = requestFormDataValues(input);
    for (let index = 0; index < values.length; index += 1) {
      if (revealSubmittedFormValue(formHelperOwnDataValue(values, index)) === value) return true;
    }
    return false;
  }
  if (!isRecord(input)) return false;
  const keys = formHelperObjectKeys(input);
  for (let index = 0; index < keys.length; index += 1) {
    const key = formHelperOwnDataValue(keys, index);
    if (
      typeof key === 'string' &&
      revealSubmittedFormValue(formHelperOwnDataValue(input, key)) === value
    ) {
      return true;
    }
  }
  return false;
}

function revealSubmittedFormValue(value: unknown): unknown {
  return revealUntrustedRequestValue(value, 'validated mutation form failure input');
}

function renderJsxElementChildren(type: string, props: JsxProps): MaybePromise<string> {
  const rawHtml = rawHtmlContent(props);
  if (rawHtml !== undefined) return rawHtml;
  const children = formHelperOwnDataValue(props, 'children') as JsxChild;
  return isExecutableTextElement(type)
    ? renderExecutableElementChildren(type, children)
    : renderJsxChildren(children);
}

function renderExecutableElementChildren(type: string, children: JsxChild): MaybePromise<string> {
  if (isPromiseLike(children)) {
    return formHelperPromiseThen(children, (resolved) =>
      renderExecutableElementChildren(type, resolved),
    );
  }
  if (formHelperIsArray(children)) {
    return renderJsxChildArray(children, (child) => renderExecutableElementChildren(type, child));
  }
  if (typeof children === 'object' && children !== null) {
    const trusted = kovoTrustedHtmlContent(children);
    if (trusted !== '') return trusted;
  }
  drainRuntimeSinkSecurityEvent(
    runtimeElementSinkEvent(
      type,
      'raw-html',
      executableElementTextValue(children),
      'element text is executable and lacks direct TrustedHtml provenance',
    ),
  );
  return '';
}

function isExecutableTextElement(type: string): boolean {
  const tag = formHelperStringToLowerCase(type);
  return tag === 'script' || tag === 'style';
}

function executableElementTextValue(children: JsxChild): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return children.toString();
  if (typeof children === 'boolean') return children ? 'true' : 'false';
  return '';
}

function renderContextualAttributeValue(
  type: string,
  props: JsxProps,
  name: string,
  value: unknown,
): string | null {
  if (isMetaRefreshContentAttribute(type, props, name)) {
    drainRuntimeSinkSecurityEvent(
      runtimeElementSinkEvent(
        'meta[http-equiv=refresh] content',
        'url',
        attributeText(name, value),
        'meta refresh content is an executable navigation sink',
      ),
    );
    return null;
  }
  return isKovoTrustedUrl(value) && isUrlAttributeName(name)
    ? escapeAttribute(value.value)
    : safeRuntimeAttribute(name, attributeText(name, value));
}

function isMetaRefreshContentAttribute(type: string, props: JsxProps, name: string): boolean {
  return (
    formHelperStringToLowerCase(type) === 'meta' &&
    formHelperStringToLowerCase(name) === 'content' &&
    formHelperStringToLowerCase(
      attributeText('http-equiv', props['http-equiv'] ?? props['httpEquiv']),
    ) === 'refresh'
  );
}

function runtimeElementSinkEvent(
  sink: string,
  family: RuntimeSinkSecurityEvent['family'],
  value: string,
  reason: string,
): RuntimeSinkSecurityEvent {
  return {
    action: 'remove',
    code: 'KV236',
    family,
    message: `KV236 runtime remove for ${family} sink "${sink}": ${reason}`,
    reason,
    sink,
    value: {
      length: value.length,
      preview: `<redacted:${value.length}>`,
      redacted: true,
    },
  };
}

function attributeText(name: string, value: unknown): string {
  if (isKovoTrustedUrl(value)) return value.value;
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
  const names = formHelperObjectKeys(props);
  for (let index = 0; index < names.length; index += 1) {
    const name = formHelperOwnDataValue(names, index);
    if (typeof name !== 'string') continue;
    const value = formHelperOwnDataValue(props, name);
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

function isAriaAttribute(name: string): boolean {
  return formHelperStringStartsWith(formHelperStringToLowerCase(name), 'aria-');
}

function renderJsxChildren(children: JsxChild): MaybePromise<string> {
  if (isPromiseLike(children)) {
    return formHelperPromiseThen(children, (resolved) => renderJsxChildren(resolved));
  }
  if (formHelperIsArray(children)) {
    return renderJsxChildArray(children, renderJsxChildren);
  }
  const helper = structuredMutationFormHelperOperation(children);
  if (helper !== undefined) {
    const failure = formHelperOwnDataValue(helper.props, 'failure');
    return failure === undefined
      ? deferMutationFormHelper(currentJsxMutationFormHelperRegistry(), helper.kind, helper.props)
      : renderMutationFormHelperOutput(helper.kind, helper.props, failure);
  }
  return renderServerRenderable(children);
}

function renderJsxChildArray(
  children: readonly unknown[],
  renderChild: (child: JsxChild) => MaybePromise<string>,
): MaybePromise<string> {
  const rendered: MaybePromise<string>[] = [];
  let containsPromise = false;
  for (let index = 0; index < children.length; index += 1) {
    const part = renderChild(formHelperOwnDataValue(children, index) as JsxChild);
    formHelperDefineArrayValue(rendered, index, part);
    if (isPromiseLike(part)) containsPromise = true;
  }
  if (containsPromise) {
    return formHelperPromiseThen(formHelperPromiseAll(rendered), (parts) => {
      let joined = '';
      for (let index = 0; index < parts.length; index += 1) {
        joined += formHelperOwnDataValue(parts, index) as string;
      }
      return joined;
    });
  }
  let joined = '';
  for (let index = 0; index < rendered.length; index += 1) {
    const part = formHelperOwnDataValue(rendered, index);
    if (typeof part !== 'string') {
      throw new TypeError('Kovo JSX child renderer produced a non-string synchronous value');
    }
    joined += part;
  }
  return joined;
}

function toRenderedHtml(value: MaybePromise<string>): MaybePromise<RenderedHtml> {
  return isPromiseLike(value)
    ? formHelperPromiseThen(value, (html) => renderedHtml(html))
    : renderedHtml(value);
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
  const html = await renderJsxChildren(rendered);
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
    recordQueryRuntimeWarnings(request, result.warnings);
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
      slots = componentMutationFailureSlots(name, failureContext.failure, slots, {
        submitted: failureContext.input,
      });
    }
  }

  return slots;
}

function jsxPropsToSlots(props: JsxProps): ComponentRenderSlots {
  return Object.fromEntries(Object.entries(props).filter(([name]) => name !== 'children'));
}

function isKovoComponent(value: unknown): value is KovoJsxComponent {
  return isKovoComponentDescriptor(value);
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
  return formHelperIsPromise(value);
}

/** @generated JSX automatic-runtime ABI `JSX` namespace (compiler-emitted). */
export declare namespace JSX {
  // Kovo's current component render-result model uses an opaque `object` and
  // existing route/site helpers often annotate JSX-returning helpers as `string`.
  // Keep the expression result broad while enforcing props, children, and
  // intrinsic attributes through the call-site prop types below.
  type Element = any;
  type ElementType = JsxComponent<any> | KovoJsxComponent | keyof IntrinsicElements;
  type LibraryManagedAttributes<ComponentType, Props> =
    ComponentType extends Component<ComponentDefinitionInput>
      ? KovoJsxComponentProps<ComponentType>
      : Props;
  interface ElementChildrenAttribute {
    children: {};
  }
  interface IntrinsicAttributes {
    key?: number | string;
    'kovo-key'?: number | string;
  }
  type AttributeValue = boolean | number | RenderedHtml | string | TrustedHtml | null | undefined;
  type UrlAttributeValue = AttributeValue | TrustedUrl;
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
    action?: UrlAttributeValue;
    accept?: AttributeValue;
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
    formaction?: UrlAttributeValue;
    formAction?: UrlAttributeValue;
    height?: number | string;
    hidden?: AttributeValue;
    high?: AttributeValue;
    href?: UrlAttributeValue;
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
    onBlur?: (event?: unknown) => void;
    onChange?: (event?: unknown) => void;
    onClick?: (event?: unknown) => void;
    onFocus?: (event?: unknown) => void;
    onInput?: (event?: unknown) => void;
    onKeyDown?: (event?: unknown) => void;
    onSubmit?: (event?: unknown) => void;
    open?: AttributeValue;
    optimum?: AttributeValue;
    pattern?: AttributeValue;
    placeholder?: AttributeValue;
    popover?: AttributeValue;
    popovertarget?: AttributeValue;
    popovertargetaction?: AttributeValue;
    poster?: UrlAttributeValue;
    background?: UrlAttributeValue;
    cite?: UrlAttributeValue;
    data?: UrlAttributeValue;
    ping?: UrlAttributeValue;
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
    src?: UrlAttributeValue;
    srcset?: AttributeValue;
    srcSet?: AttributeValue;
    stroke?: string;
    stream?: boolean;
    streamText?: string;
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
    'xlink:href'?: UrlAttributeValue;
    xmlns?: string;
    y?: number | string;
    y1?: number | string;
    y2?: number | string;
  }
  interface IntrinsicElements {
    [tag: string]: HtmlAttributes;
  }
}
