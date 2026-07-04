import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import type { CsrfOptions } from './csrf.js';
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
  props: Record<string, unknown>;
}

export interface JsxMutationFormHelperRegistry {
  nextId: number;
  placeholders: Map<number, JsxMutationFormHelperPlaceholder>;
  token: string;
}

const jsxRequestContext = new AsyncLocalStorage<JsxFrameworkContext>();

export function currentJsxRequestContext(): unknown {
  return jsxRequestContext.getStore()?.request;
}

export function currentJsxFrameworkContext(): JsxFrameworkContext | undefined {
  return jsxRequestContext.getStore();
}

export function currentJsxMutationFormHelperRegistry(): JsxMutationFormHelperRegistry | undefined {
  return jsxRequestContext.getStore()?.mutationFormHelpers;
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
  return jsxRequestContext.run(
    { ...options, mutationFormHelpers: createMutationFormHelperRegistry(), request },
    render,
  );
}

function createMutationFormHelperRegistry(): JsxMutationFormHelperRegistry {
  return {
    nextId: 0,
    placeholders: new Map(),
    token: randomUUID(),
  };
}
