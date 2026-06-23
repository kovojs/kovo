import { AsyncLocalStorage } from 'node:async_hooks';

import type { CsrfValidationOptions } from './csrf.js';
import type { DeferredStreamChunk } from './deferred-stream.js';
import type { MutationFail } from './mutation.js';

type MaybePromise<Value> = Promise<Value> | Value;

export interface JsxMutationFailureContext {
  failure: MutationFail;
  input?: unknown;
  mutationKey: string;
  target?: string;
}

export interface JsxFrameworkContext {
  csrf?: CsrfValidationOptions<any>;
  deferredRegions?: DeferredRegionCollector;
  mutationFailure?: JsxMutationFailureContext;
  onCsrfSetCookie?: (rawSetCookie: string) => void;
  request: unknown;
}

export interface DeferredRegionCollector {
  add(chunk: Promise<DeferredStreamChunk> | DeferredStreamChunk): void;
}

const jsxRequestContext = new AsyncLocalStorage<JsxFrameworkContext>();

export function currentJsxRequestContext(): unknown {
  return jsxRequestContext.getStore()?.request;
}

export function currentJsxFrameworkContext(): JsxFrameworkContext | undefined {
  return jsxRequestContext.getStore();
}

export function runWithJsxRequestContext<Value>(
  request: unknown,
  render: () => MaybePromise<Value>,
): MaybePromise<Value>;
export function runWithJsxRequestContext<Value>(
  request: unknown,
  options: Omit<JsxFrameworkContext, 'request'>,
  render: () => MaybePromise<Value>,
): MaybePromise<Value>;
export function runWithJsxRequestContext<Value>(
  request: unknown,
  optionsOrRender: Omit<JsxFrameworkContext, 'request'> | (() => MaybePromise<Value>),
  maybeRender?: () => MaybePromise<Value>,
): MaybePromise<Value> {
  const options = typeof optionsOrRender === 'function' ? {} : optionsOrRender;
  const render = typeof optionsOrRender === 'function' ? optionsOrRender : maybeRender;
  if (!render) throw new Error('runWithJsxRequestContext requires a render callback');
  return jsxRequestContext.run({ ...options, request }, render);
}
