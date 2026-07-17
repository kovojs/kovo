import { escapeAttribute, escapeHtml, escapeWireAttribute } from './html.js';
import type { JsxMutationFormHelperKind, JsxMutationFormHelperRegistry } from './jsx-context.js';
import {
  formHelperApply,
  formHelperCreateRecord,
  formHelperDefineArrayValue,
  formHelperDefineDataProperty,
  formHelperFreeze,
  formHelperIsArray,
  formHelperMapDelete,
  formHelperMapGet,
  formHelperMapSet,
  formHelperNextId,
  formHelperObjectKeys,
  formHelperOwnDataValue,
  formHelperParseId,
  formHelperSnapshotRecord,
  formHelperString,
  formHelperStringIndexOf,
  formHelperStringLastIndexOf,
  formHelperStringSlice,
} from './jsx-form-helper-intrinsics.js';

const operationTagName = '__kovoMutationFormHelperOperation';
const operationTagValue = 'v1';
const placeholderPrefix = '<!--kovo-form-helper:';
const placeholderSuffix = '-->';

export interface StructuredMutationFormHelperOperation {
  kind: JsxMutationFormHelperKind;
  props: Readonly<Record<string, unknown>>;
}

/**
 * Recognize the non-authoritative structured value returned by core FieldError/FormError.
 * A caller may forge this shape, but it can request only the fixed escaped output primitive below;
 * it cannot supply raw HTML bytes or acquire Kovo's RenderedHtml constructor.
 */
export function structuredMutationFormHelperOperation(
  value: unknown,
): StructuredMutationFormHelperOperation | undefined {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  if (formHelperOwnDataValue(value, operationTagName) !== operationTagValue) return undefined;
  const kind = formHelperOwnDataValue(value, 'kind');
  if (kind !== 'field' && kind !== 'form') return undefined;
  const props = formHelperOwnDataValue(value, 'props');
  if ((typeof props !== 'object' && typeof props !== 'function') || props === null) {
    return undefined;
  }
  return formHelperFreeze({
    kind,
    props: snapshotMutationFormHelperProps(props as Record<string, unknown>),
  });
}

export function deferMutationFormHelper(
  registry: JsxMutationFormHelperRegistry | undefined,
  kind: JsxMutationFormHelperKind,
  props: Record<string, unknown>,
): string {
  if (registry === undefined) return '';
  const id = formHelperNextId(registry.nextId);
  registry.nextId = id;
  const placeholder = formHelperFreeze({
    kind,
    props: snapshotMutationFormHelperProps(props),
  });
  formHelperMapSet(registry.placeholders, id, placeholder);
  return `${placeholderPrefix}${registry.token}:${formHelperString(id)}${placeholderSuffix}`;
}

export function resolveMutationFormHelpers(
  html: string,
  registry: JsxMutationFormHelperRegistry | undefined,
  failure: unknown,
): string {
  let rendered = '';
  let offset = 0;
  for (;;) {
    const markerStart = formHelperStringIndexOf(html, placeholderPrefix, offset);
    if (markerStart < 0) return rendered + formHelperStringSlice(html, offset);
    rendered += formHelperStringSlice(html, offset, markerStart);

    const bodyStart = markerStart + placeholderPrefix.length;
    const markerEnd = formHelperStringIndexOf(html, placeholderSuffix, bodyStart);
    if (markerEnd < 0) return rendered;
    if (registry !== undefined) {
      const body = formHelperStringSlice(html, bodyStart, markerEnd);
      const divider = formHelperStringLastIndexOf(body, ':');
      if (divider > 0) {
        const token = formHelperStringSlice(body, 0, divider);
        const id = formHelperParseId(formHelperStringSlice(body, divider + 1));
        if (token === registry.token && id !== undefined) {
          const placeholder = formHelperMapGet(registry.placeholders, id);
          formHelperMapDelete(registry.placeholders, id);
          if (placeholder !== undefined) {
            rendered += renderMutationFormHelperOutput(
              placeholder.kind,
              placeholder.props,
              failure,
            );
          }
        }
      }
    }
    offset = markerEnd + placeholderSuffix.length;
  }
}

export function renderMutationFormHelperOutput(
  kind: JsxMutationFormHelperKind,
  propsInput: Record<string, unknown>,
  failureInput: unknown,
): string {
  if (!isRecord(failureInput)) return '';
  const props = snapshotMutationFormHelperProps(propsInput);
  const failure = formHelperSnapshotRecord(failureInput, 'Mutation form-helper failure');

  let message: unknown;
  if (kind === 'field') {
    if (!failureCodeMatches(failure, formHelperOwnDataValue(props, 'code'))) return '';
    message = fieldErrorMessage(failure, props);
  } else {
    if (formHelperOwnDataValue(failure, 'code') === 'VALIDATION') return '';
    if (!failureCodeMatches(failure, formHelperOwnDataValue(props, 'code'))) return '';
    message = failureMessage(failure, props);
  }
  if (message === undefined || message === null || message === false) return '';

  let attributes = ` role="${escapeAttribute(
    formHelperString(formHelperOwnDataValue(props, 'role') ?? 'alert'),
  )}"`;
  const id = formHelperOwnDataValue(props, 'id');
  if (id !== undefined) {
    attributes += ` id="${escapeWireAttribute(
      formHelperString(id),
      'dom-identity',
      'mutation form helper[id]',
    )}"`;
  }
  const className = formHelperOwnDataValue(props, 'class');
  if (className !== undefined) {
    attributes += ` class="${escapeAttribute(formHelperString(className))}"`;
  }
  const failureCode = formHelperOwnDataValue(failure, 'code');
  if (typeof failureCode === 'string') {
    attributes += ` data-error-code="${escapeWireAttribute(
      failureCode,
      'dom-identity',
      'mutation form helper[data-error-code]',
    )}"`;
  }
  return `<output${attributes}>${escapeHtml(formHelperString(message))}</output>`;
}

function fieldErrorMessage(
  failure: Readonly<Record<string, unknown>>,
  props: Readonly<Record<string, unknown>>,
): unknown {
  const explicitMessage = formHelperOwnDataValue(props, 'message');
  const children = formHelperOwnDataValue(props, 'children');
  if (explicitMessage !== undefined || children !== undefined) {
    return failureMessage(failure, props);
  }
  if (formHelperOwnDataValue(failure, 'code') !== 'VALIDATION') return undefined;
  const fieldErrors = formHelperOwnDataValue(failure, 'fieldErrors');
  if (!isRecord(fieldErrors)) return undefined;
  const name = formHelperOwnDataValue(props, 'name');
  return typeof name === 'string' ? formHelperOwnDataValue(fieldErrors, name) : undefined;
}

function failureMessage(
  failure: Readonly<Record<string, unknown>>,
  props: Readonly<Record<string, unknown>>,
): unknown {
  const explicitMessage = formHelperOwnDataValue(props, 'message');
  const message = explicitMessage ?? formHelperOwnDataValue(props, 'children');
  if (typeof message === 'function') return formHelperApply(message, undefined, [failure]);
  if (message !== undefined) return message;
  const failureCode = formHelperOwnDataValue(failure, 'code');
  if (failureCode === 'VALIDATION') return undefined;
  return typeof failureCode === 'string' ? failureCode : 'Form submission failed.';
}

function failureCodeMatches(failure: Readonly<Record<string, unknown>>, code: unknown): boolean {
  if (code === undefined) return true;
  const failureCode = formHelperOwnDataValue(failure, 'code');
  if (typeof failureCode !== 'string') return false;
  if (!formHelperIsArray(code)) return failureCode === code;
  for (let index = 0; index < code.length; index += 1) {
    if (formHelperOwnDataValue(code, index) === failureCode) return true;
  }
  return false;
}

function snapshotMutationFormHelperProps(
  props: Record<string, unknown>,
): Readonly<Record<string, unknown>> {
  const shallow = formHelperSnapshotRecord(props, 'Mutation form-helper props');
  const code = formHelperOwnDataValue(shallow, 'code');
  if (!formHelperIsArray(code)) return shallow;

  const codeSnapshot: unknown[] = [];
  for (let index = 0; index < code.length; index += 1) {
    formHelperDefineArrayValue(codeSnapshot, index, formHelperOwnDataValue(code, index));
  }
  formHelperFreeze(codeSnapshot);

  const snapshot = formHelperCreateRecord();
  const names = formHelperObjectKeys(shallow);
  for (let index = 0; index < names.length; index += 1) {
    const name = formHelperOwnDataValue(names, index);
    if (typeof name !== 'string') continue;
    formHelperDefineDataProperty(
      snapshot,
      name,
      name === 'code' ? codeSnapshot : formHelperOwnDataValue(shallow, name),
    );
  }
  return formHelperFreeze(snapshot);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
