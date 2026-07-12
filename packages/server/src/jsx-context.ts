import type { CsrfOptions } from './csrf.js';
import type { DeferredStreamChunk } from './deferred-stream.js';
import {
  formHelperAsyncLocalGetStore,
  formHelperAsyncLocalRun,
  formHelperCreateAsyncLocalStorage,
  formHelperCreateMap,
  formHelperOwnDataValue,
  formHelperSnapshotRecord,
  formHelperToken,
} from './jsx-form-helper-intrinsics.js';
import type { MutationFail } from './mutation.js';

type MaybePromise<Value> = Promise<Value> | Value;

export interface JsxMutationFailureContext {
  failure: MutationFail;
  input?: unknown;
  mutationKey: string;
  target?: string;
}

export interface JsxFrameworkContext {
  anonymousCsrfBindings?: Map<string, JsxAnonymousCsrfBinding>;
  csrf?: CsrfOptions<any>;
  deferredRegions?: DeferredRegionCollector;
  maxListItems?: number;
  mutationFormHelpers: JsxMutationFormHelperRegistry;
  mutationFailure?: JsxMutationFailureContext;
  onCsrfSetCookie?: (rawSetCookie: string) => void;
  request: unknown;
}

export interface JsxAnonymousCsrfBinding {
  value: string;
}

export interface DeferredRegionCollector {
  add(chunk: Promise<DeferredStreamChunk> | DeferredStreamChunk): void;
}

export type JsxMutationFormHelperKind = 'field' | 'form';

export interface JsxMutationFormHelperPlaceholder {
  kind: JsxMutationFormHelperKind;
  props: Readonly<Record<string, unknown>>;
}

export interface JsxMutationFormHelperRegistry {
  nextId: number;
  placeholders: Map<number, JsxMutationFormHelperPlaceholder>;
  token: string;
}

const jsxRequestContext = formHelperCreateAsyncLocalStorage<JsxFrameworkContext>();

export function currentJsxRequestContext(): unknown {
  return formHelperAsyncLocalGetStore(jsxRequestContext)?.request;
}

export function currentJsxFrameworkContext(): JsxFrameworkContext | undefined {
  return formHelperAsyncLocalGetStore(jsxRequestContext);
}

export function currentJsxMutationFormHelperRegistry(): JsxMutationFormHelperRegistry | undefined {
  return formHelperAsyncLocalGetStore(jsxRequestContext)?.mutationFormHelpers;
}

export function runWithJsxRequestContext<Value>(
  request: unknown,
  render: () => MaybePromise<Value>,
): MaybePromise<Value>;
export function runWithJsxRequestContext<Value>(
  request: unknown,
  options: Omit<JsxFrameworkContext, 'mutationFormHelpers' | 'request'>,
  render: () => MaybePromise<Value>,
): MaybePromise<Value>;
export function runWithJsxRequestContext<Value>(
  request: unknown,
  optionsOrRender:
    | Omit<JsxFrameworkContext, 'mutationFormHelpers' | 'request'>
    | (() => MaybePromise<Value>),
  maybeRender?: () => MaybePromise<Value>,
): MaybePromise<Value> {
  const options = typeof optionsOrRender === 'function' ? {} : optionsOrRender;
  const render = typeof optionsOrRender === 'function' ? optionsOrRender : maybeRender;
  if (!render) throw new Error('runWithJsxRequestContext requires a render callback');
  return formHelperAsyncLocalRun(
    jsxRequestContext,
    createJsxFrameworkContext(request, options),
    render,
  );
}

function createJsxFrameworkContext(
  request: unknown,
  options: Omit<JsxFrameworkContext, 'mutationFormHelpers' | 'request'>,
): JsxFrameworkContext {
  const anonymousCsrfBindings = formHelperOwnDataValue(options, 'anonymousCsrfBindings') as
    | Map<string, JsxAnonymousCsrfBinding>
    | undefined;
  const csrf = formHelperOwnDataValue(options, 'csrf') as CsrfOptions<any> | undefined;
  const deferredRegions = formHelperOwnDataValue(options, 'deferredRegions') as
    | DeferredRegionCollector
    | undefined;
  const maxListItems = formHelperOwnDataValue(options, 'maxListItems') as number | undefined;
  const mutationFailure = formHelperOwnDataValue(options, 'mutationFailure');
  const onCsrfSetCookie = formHelperOwnDataValue(options, 'onCsrfSetCookie') as
    | ((rawSetCookie: string) => void)
    | undefined;
  const normalizedMutationFailure =
    typeof mutationFailure === 'object' && mutationFailure !== null
      ? (formHelperSnapshotRecord(
          mutationFailure as unknown as Record<string, unknown>,
          'JSX mutation failure context',
        ) as unknown as JsxMutationFailureContext)
      : undefined;
  const context: JsxFrameworkContext = {
    ...(anonymousCsrfBindings === undefined ? {} : { anonymousCsrfBindings }),
    ...(csrf === undefined ? {} : { csrf }),
    ...(deferredRegions === undefined ? {} : { deferredRegions }),
    ...(maxListItems === undefined ? {} : { maxListItems }),
    ...(normalizedMutationFailure === undefined
      ? {}
      : { mutationFailure: normalizedMutationFailure }),
    mutationFormHelpers: createMutationFormHelperRegistry(),
    ...(onCsrfSetCookie === undefined ? {} : { onCsrfSetCookie }),
    request,
  };
  return context;
}

function createMutationFormHelperRegistry(): JsxMutationFormHelperRegistry {
  return {
    nextId: 0,
    placeholders: formHelperCreateMap(),
    token: formHelperToken(),
  };
}
