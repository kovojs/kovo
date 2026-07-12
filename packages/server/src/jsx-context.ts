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
  const mutationFailure = formHelperOwnDataValue(options, 'mutationFailure');
  const context: JsxFrameworkContext = {
    anonymousCsrfBindings: formHelperOwnDataValue(options, 'anonymousCsrfBindings') as
      | Map<string, JsxAnonymousCsrfBinding>
      | undefined,
    csrf: formHelperOwnDataValue(options, 'csrf') as CsrfOptions<any> | undefined,
    deferredRegions: formHelperOwnDataValue(options, 'deferredRegions') as
      | DeferredRegionCollector
      | undefined,
    maxListItems: formHelperOwnDataValue(options, 'maxListItems') as number | undefined,
    mutationFailure:
      typeof mutationFailure === 'object' && mutationFailure !== null
        ? (formHelperSnapshotRecord(
            mutationFailure as unknown as Record<string, unknown>,
            'JSX mutation failure context',
          ) as unknown as JsxMutationFailureContext)
        : undefined,
    mutationFormHelpers: createMutationFormHelperRegistry(),
    onCsrfSetCookie: formHelperOwnDataValue(options, 'onCsrfSetCookie') as
      | ((rawSetCookie: string) => void)
      | undefined,
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
