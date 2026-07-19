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
  assertHtmlElementWireValueStable,
  assertHtmlWireValueStable,
  htmlAttributeWireValuePosture,
  htmlTextWireValuePosture,
} from '@kovojs/core/internal/semantic-attributes';
import {
  drainRuntimeSinkSecurityEvent,
  isBlockedSvgSmilElementName,
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
  escapeWireAttribute,
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
  formHelperAsciiCaseInsensitiveEqual,
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
  formHelperStringIndexOf,
  formHelperStringStartsWith,
  formHelperStringToLowerCase,
} from './jsx-form-helper-intrinsics.js';
import { recordQueryRuntimeWarnings, runQuery, type QueryDefinition } from './query.js';
import {
  requestFormDataGet,
  requestFormDataValues,
  requestIsFormData,
} from './request-body-intrinsics.js';
import {
  witnessCreateNullRecord,
  witnessGetOwnPropertyDescriptor,
  witnessObjectIs,
  witnessObjectKeys,
} from './security-witness-intrinsics.js';
import { renderServerRenderable } from './renderable.js';
import { stampKovoComponentRoot } from './component-root-stamps.js';
import { isDocumentConfig, isStructuredDocumentNode } from './document-structured.js';
import { revealUntrustedRequestValue } from './untrusted-request-body.js';
import {
  isDeclaredMutationDefinition,
  type MutationFormDefinition,
} from './mutation/definition.js';

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
  // HTML intrinsic identity is ASCII case-insensitive. The compiler already records `<fOrm>` as
  // the host `form`; keep the runtime on the same identity so mutation/void/security semantics do
  // not depend on authored casing. Function-valued `<Form>` components returned above never enter
  // this string-host branch.
  const intrinsicType = formHelperStringToLowerCase(type);
  // SPEC.md §4.8 / §5.2 rule 10: generic SVG SMIL elements can transfer values into an
  // ancestor or href-targeted sibling's executable attribute after per-attribute checks have
  // finished. Their target/value attributes can also arrive in either live-update order. Kovo's
  // technical-preview contract therefore disables the primitive instead of trying to preserve a
  // browser-specific temporal allowlist.
  if (isBlockedSvgSmilElementName(intrinsicType)) {
    drainRuntimeSinkSecurityEvent(
      runtimeElementSinkEvent(
        `<${intrinsicType}>`,
        'raw-html',
        intrinsicType,
        'SVG SMIL animation elements are disabled because they can transfer values into executable attributes',
      ),
    );
    return renderedHtml('');
  }
  // SPEC §4.8 / §5.2 rule 10: `<base>` is a document-wide navigation capability. Even a
  // same-origin, safe-scheme href retargets every later relative URL, so per-attribute URL
  // sanitation cannot make the element an ordinary output sink. The compiler rejects authored
  // `<base>` and this runtime floor removes direct/uncompiled JSX and opaque-spread construction.
  if (intrinsicType === 'base') {
    drainRuntimeSinkSecurityEvent(
      runtimeElementSinkEvent(
        'base',
        'url',
        intrinsicType,
        'HTML base elements are disabled because they change document-wide URL resolution',
      ),
    );
    return renderedHtml('');
  }
  // SPEC §13.2/§6.6: cross-attribute browser semantics must classify the same immutable
  // own-data props snapshot that the HTML sink consumes. In particular, hidden `_charset_`
  // controls substitute their authored value during native form entry-list construction.
  assertIntrinsicElementWireValueStable(intrinsicType, intrinsicProps);
  const attributes = renderJsxAttributes(intrinsicType, intrinsicProps, key);
  if (isVoidElement(intrinsicType)) return renderedHtml(`<${type}${attributes}>`);

  const children = renderJsxElementChildren(intrinsicType, intrinsicProps);
  const afterChildren =
    intrinsicType === 'form' ? renderFormAfterChildrenContent(intrinsicProps, key) : '';
  return isPromiseLike(children)
    ? formHelperPromiseThen(children, (html) =>
        renderedHtml(
          `<${type}${attributes}>${renderFormChildrenContent(intrinsicType, intrinsicProps, key, html)}${afterChildren}</${type}>`,
        ),
      )
    : renderedHtml(
        `<${type}${attributes}>${renderFormChildrenContent(intrinsicType, intrinsicProps, key, children)}${afterChildren}</${type}>`,
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
    rendered += ` kovo-key="${escapeWireAttribute(
      attributeText('kovo-key', key),
      'dom-identity',
      'kovo-key',
    )}"`;
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
    if (type === 'form' && name === 'mutation') {
      const mutation = retainedMutationDefinition(value);
      if (mutation) {
        rendered += renderMutationFormAttributes(mutation.key, props);
      }
      // `mutation` is compiler/runtime control metadata, never an authored HTML attribute. A
      // structural lookalike is omitted rather than serialized after failing the private witness.
      continue;
    }
    if (name === 'stream') {
      continue;
    }
    if (name === 'streamText') {
      if (props['data-stream-text'] === undefined) {
        rendered += ` data-stream-text="${escapeWireAttribute(
          attributeText(name, value),
          'dom-identity',
          'data-stream-text',
        )}"`;
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
      const className = joinPresentStrings([attributeText(name, value), styleAttrs.class], ' ');
      rendered += ` class="${escapeAttribute(className)}"`;
      renderedClass = true;
      continue;
    }
    if (styleAttrs && name === 'data-style-src') {
      const source = joinPresentStrings(
        [attributeText(name, value), styleAttrs['data-style-src']],
        '; ',
      );
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

function assertIntrinsicElementWireValueStable(type: string, props: JsxProps): void {
  if (type !== 'input') return;
  assertHtmlElementWireValueStable(
    type,
    firstRenderedAttributeValue(props, 'type'),
    firstRenderedAttributeValue(props, 'name'),
    '<input> submitted control',
  );
}

/**
 * Return the browser-effective first attribute value for an ASCII-case-insensitive HTML name.
 * `props` is already the frozen own-data snapshot made by `jsx()`. HTML ignores later duplicate
 * attributes after ASCII case-folding, while the JSX object itself can contain differently-cased
 * keys, so this scan follows the exact renderer order instead of indexing one spelling.
 */
function firstRenderedAttributeValue(props: JsxProps, expectedName: string): string | undefined {
  const names = formHelperObjectKeys(props);
  for (let index = 0; index < names.length; index += 1) {
    const name = formHelperOwnDataValue(names, index);
    if (typeof name !== 'string' || !formHelperAsciiCaseInsensitiveEqual(name, expectedName)) {
      continue;
    }
    const value = formHelperOwnDataValue(props, name);
    if (value === false || value === null || value === undefined) continue;
    if (isKovoTrustedUrl(value)) continue;
    if (!safeRuntimeAttributeName(name)) continue;
    if (value === true) return '';
    // Only a primitive string can serialize to either reserved keyword exactly. Numbers and
    // object JSON encodings remain first-attribute blockers but cannot spell `hidden`/`_charset_`.
    return typeof value === 'string' ? value : '';
  }
  return undefined;
}

function mergedStyle(...values: Array<string | undefined>): string {
  return joinPresentStrings(values, '; ');
}

function joinPresentStrings(values: readonly (string | undefined)[], separator: string): string {
  let result = '';
  for (let index = 0; index < values.length; index += 1) {
    const value = formHelperOwnDataValue(values, index);
    if (typeof value !== 'string' || value === '') continue;
    result += `${result === '' ? '' : separator}${value}`;
  }
  return result;
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
  if (formHelperIsArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (isKovoStyleInput(formHelperOwnDataValue(value, index))) return true;
    }
    return false;
  }
  return typeof value === 'object' && value !== null && '$$css' in value;
}

function renderMutationFormAttributes(key: string, props: JsxProps): string {
  let attributes = '';
  if (formHelperOwnDataValue(props, 'method') === undefined) attributes += ' method="post"';
  if (formHelperOwnDataValue(props, 'action') === undefined) {
    attributes += ` action="${escapeWireAttribute(
      `/_m/${key}`,
      'submitted-control',
      'form[action]',
    )}"`;
  }
  if (formHelperOwnDataValue(props, 'data-mutation') === undefined) {
    attributes += ` data-mutation="${escapeWireAttribute(
      key,
      'dom-identity',
      'form[data-mutation]',
    )}"`;
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
  const mutation = retainedMutationDefinition(formHelperOwnDataValue(props, 'mutation'));
  if (!mutation) return '';
  const key = formKeyValue(props, jsxKey);
  if (key === undefined) return '';

  return `<input type="hidden" name="${kovoFormKeyFieldName}" value="${escapeWireAttribute(
    key,
    'submitted-control',
    'input[name=kovo-form-key][value]',
  )}">`;
}

function renderFormCsrfContent(props: JsxProps): string {
  const mutation = retainedMutationDefinition(formHelperOwnDataValue(props, 'mutation'));
  if (!mutation) return '';
  // SPEC.md §10.3:1063/1065: no-JS forms must carry a per-submit idem field so
  // the server can dedup double-submits and Back-resubmit via the replay store.
  return renderMutationCsrfField(mutation) + renderMutationIdemField();
}

interface RetainedMutationDefinition {
  readonly csrf?: CsrfOptions<unknown> | false;
  readonly key: string;
}

function retainedMutationDefinition(value: unknown): RetainedMutationDefinition | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    formHelperIsArray(value) ||
    !isDeclaredMutationDefinition(value)
  ) {
    return undefined;
  }
  const key = retainedMutationOwnDataValue(value, 'key');
  if (typeof key !== 'string') return undefined;
  if (key.length === 0) {
    throw new TypeError('Retained JSX mutation.key must be a non-empty stable own data string.');
  }
  const csrf = retainedMutationOwnDataValue(value, 'csrf');
  return { ...(csrf === undefined ? {} : { csrf: csrf as CsrfOptions<unknown> | false }), key };
}

function retainedMutationOwnDataValue(value: object, property: 'csrf' | 'key'): unknown {
  const before = witnessGetOwnPropertyDescriptor(value, property);
  const after = witnessGetOwnPropertyDescriptor(value, property);
  if (before === undefined && after === undefined) return undefined;
  if (
    before === undefined ||
    after === undefined ||
    !('value' in before) ||
    !('value' in after) ||
    !witnessObjectIs(before.value, after.value) ||
    before.configurable !== after.configurable ||
    before.enumerable !== after.enumerable ||
    before.writable !== after.writable
  ) {
    throw new TypeError(`Retained JSX mutation.${property} must be a stable own data property.`);
  }
  return before.value;
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
  if (rawHtml !== undefined) {
    if (htmlTextWireValuePosture(type, optionHasExplicitValue(props)) !== undefined) {
      // Trusted raw HTML is still parsed as RCDATA in textarea and as markup/text in option.
      // Character references and element parsing can therefore change the submitted fallback
      // after this process has validated the source bytes. No honest injective check is possible
      // without running an HTML parser here, so authority-bearing text rejects the raw escape.
      throw new TypeError(
        `KV236: <${type}> submitted text cannot use raw HTML because parsing can change its native form value (SPEC §13.2).`,
      );
    }
    return rawHtml;
  }
  const children = formHelperOwnDataValue(props, 'children') as JsxChild;
  const posture = htmlTextWireValuePosture(type, optionHasExplicitValue(props));
  const rendered =
    posture !== undefined
      ? renderWireStableElementChildren(type, children)
      : isExecutableTextElement(type)
        ? renderExecutableElementChildren(type, children)
        : renderJsxChildren(children);
  return isPromiseLike(rendered)
    ? formHelperPromiseThen(rendered, (html) => validateWireStableElementText(type, props, html))
    : validateWireStableElementText(type, props, rendered);
}

function renderWireStableElementChildren(type: string, children: JsxChild): MaybePromise<string> {
  if (isPromiseLike(children)) {
    return formHelperPromiseThen(children, (resolved) =>
      renderWireStableElementChildren(type, resolved),
    );
  }
  if (formHelperIsArray(children)) {
    return renderJsxChildArray(children, (child) => renderWireStableElementChildren(type, child));
  }
  if (
    typeof children === 'object' &&
    children !== null &&
    kovoTrustedHtmlContent(children) !== ''
  ) {
    throw new TypeError(
      `KV236: <${type}> submitted text cannot use TrustedHtml because character references can change its native form value (SPEC §13.2).`,
    );
  }
  return renderJsxChildren(children);
}

function validateWireStableElementText(type: string, props: JsxProps, html: string): string {
  const posture = htmlTextWireValuePosture(type, optionHasExplicitValue(props));
  if (posture === undefined) return html;
  if (formHelperStringIndexOf(html, '<') >= 0) {
    throw new TypeError(
      `KV236: <${type}> submitted text must use scalar text so HTML parsing cannot change its native form value (SPEC §13.2).`,
    );
  }
  return assertHtmlWireValueStable(html, posture, `<${type}> submitted text`);
}

function optionHasExplicitValue(props: JsxProps): boolean {
  const names = formHelperObjectKeys(props);
  for (let index = 0; index < names.length; index += 1) {
    const name = formHelperOwnDataValue(names, index);
    if (typeof name !== 'string' || formHelperStringToLowerCase(name) !== 'value') continue;
    const value = formHelperOwnDataValue(props, name);
    if (value !== false && value !== null && value !== undefined && !isKovoTrustedUrl(value)) {
      return true;
    }
  }
  return false;
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
  const text = attributeText(name, value);
  const posture = htmlAttributeWireValuePosture(type, name);
  if (posture !== undefined) assertHtmlWireValueStable(text, posture, `<${type}>[${name}]`);
  return isKovoTrustedUrl(value) && isUrlAttributeName(name)
    ? escapeAttribute(text)
    : safeRuntimeAttribute(name, text);
}

function isMetaRefreshContentAttribute(type: string, props: JsxProps, name: string): boolean {
  if (
    !formHelperAsciiCaseInsensitiveEqual(type, 'meta') ||
    !formHelperAsciiCaseInsensitiveEqual(name, 'content')
  ) {
    return false;
  }
  const browserHttpEquiv = firstRenderedAttributeValue(props, 'http-equiv');
  // Keep the long-standing JSX `httpEquiv` guard when no browser-recognized hyphenated attribute
  // is emitted. Once a real `http-equiv` exists, its first rendered ASCII-case duplicate owns the
  // browser decision and a later exact/camel spelling cannot override it (SPEC §5.2 rule 11).
  const effectiveHttpEquiv =
    browserHttpEquiv ?? attributeText('httpEquiv', formHelperOwnDataValue(props, 'httpEquiv'));
  return formHelperAsciiCaseInsensitiveEqual(effectiveHttpEquiv, 'refresh');
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
  return typeof value === 'object' && value !== null && !formHelperIsArray(value);
}

function renderStyleProperties(properties: Record<string, unknown>): string {
  let rendered = '';
  const names = formHelperObjectKeys(properties);
  for (let index = 0; index < names.length; index += 1) {
    const propertyName = formHelperOwnDataValue(names, index);
    if (typeof propertyName !== 'string') continue;
    const propertyValue = formHelperOwnDataValue(properties, propertyName);
    const declaration = kovoStyleProperty(propertyName, propertyValue);
    if (declaration === '') continue;
    rendered += `${rendered === '' ? '' : '; '}${declaration}`;
  }
  return rendered;
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
      ...(context?.attestationAuthority === undefined
        ? {}
        : { attestationAuthority: context.attestationAuthority }),
      component,
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

  const values = witnessCreateNullRecord<unknown>() as Record<string, unknown>;
  const names = witnessObjectKeys(queryBindings);
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index]!;
    const descriptor = witnessGetOwnPropertyDescriptor(queryBindings, name);
    if (descriptor === undefined || !('value' in descriptor)) {
      throw new TypeError(`Route JSX component query ${name} must be an own data property.`);
    }
    const binding = descriptor.value;
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
    ? componentMutationDefaultForms(component.definition.mutations)
    : undefined;

  let slots: ComponentRenderSlots = {
    ...(props.children === undefined ? {} : { children: props.children }),
    ...(forms === undefined ? {} : { forms }),
    ...jsxPropsToSlots(props),
    ...(request === undefined ? {} : { request }),
  };

  const failureContext = currentJsxFrameworkContext()?.mutationFailure;
  if (!failureContext || !isRecord(component.definition.mutations)) return slots;

  const names = formHelperObjectKeys(component.definition.mutations);
  for (let index = 0; index < names.length; index += 1) {
    const name = formHelperOwnDataValue(names, index);
    if (typeof name !== 'string') continue;
    const mutation = formHelperOwnDataValue(component.definition.mutations, name);
    const retainedMutation = retainedMutationDefinition(mutation);
    if (retainedMutation && retainedMutation.key === failureContext.mutationKey) {
      slots = componentMutationFailureSlots(name, failureContext.failure, slots, {
        submitted: failureContext.input,
      });
    }
  }

  return slots;
}

function jsxPropsToSlots(props: JsxProps): ComponentRenderSlots {
  const slots = formHelperCreateRecord() as ComponentRenderSlots;
  const names = formHelperObjectKeys(props);
  for (let index = 0; index < names.length; index += 1) {
    const name = formHelperOwnDataValue(names, index);
    if (typeof name !== 'string' || name === 'children') continue;
    formHelperDefineDataProperty(
      slots as Record<string, unknown>,
      name,
      formHelperOwnDataValue(props, name),
    );
  }
  return slots;
}

function isKovoComponent(value: unknown): value is KovoJsxComponent {
  return isKovoComponentDescriptor(value);
}

function isQueryDefinition(value: unknown): value is QueryDefinition {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    (value.reads === undefined || formHelperIsArray(value.reads))
  );
}

function isQueryArgsBinding(
  value: unknown,
): value is { args: (props: JsxProps) => unknown; query: QueryDefinition } {
  return isRecord(value) && typeof value.args === 'function' && isQueryDefinition(value.query);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !formHelperIsArray(value);
}

function componentMutationDefaultForms(
  mutations: Record<string, unknown>,
): Record<string, { failure: null }> {
  const forms = formHelperCreateRecord() as Record<string, { failure: null }>;
  const names = formHelperObjectKeys(mutations);
  for (let index = 0; index < names.length; index += 1) {
    const name = formHelperOwnDataValue(names, index);
    if (typeof name === 'string') {
      formHelperDefineDataProperty(forms, name, { failure: null });
    }
  }
  return forms;
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
    mutation?: MutationFormDefinition;
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
