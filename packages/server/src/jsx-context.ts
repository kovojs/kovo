import type { CsrfOptions } from './csrf.js';
import type { DeferredStreamChunk } from './deferred-stream.js';
import type { LiveTargetAttestationAuthority } from './live-target-app-identity.js';
import {
  createFrameworkAsyncContextCell,
  currentFrameworkAsyncContextValue,
  runWithFrameworkAsyncContext,
  runWithRevocableIsolatedFrameworkAsyncContext,
  type RevocableFrameworkAsyncContextTask,
} from './async-context.js';
import {
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
  attestationAuthority?: LiveTargetAttestationAuthority;
  csrf?: CsrfOptions<any>;
  deferredRegions?: DeferredRegionCollector;
  maxListItems?: number;
  mutationFormHelpers: JsxMutationFormHelperRegistry;
  mutationFailure?: JsxMutationFailureContext;
  onCsrfSetCookie?: (rawSetCookie: string) => void;
  request: unknown;
}

export interface JsxAnonymousCsrfBinding {
  framed: string;
  kind: 'anonymous';
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

const jsxRequestContext =
  createFrameworkAsyncContextCell<JsxFrameworkContext>('server.jsx-request');

export function currentJsxRequestContext(): unknown {
  return currentFrameworkAsyncContextValue(jsxRequestContext)?.request;
}

export function currentJsxFrameworkContext(): JsxFrameworkContext | undefined {
  return currentFrameworkAsyncContextValue(jsxRequestContext);
}

export function currentJsxMutationFormHelperRegistry(): JsxMutationFormHelperRegistry | undefined {
  return currentFrameworkAsyncContextValue(jsxRequestContext)?.mutationFormHelpers;
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
  return runWithFrameworkAsyncContext(
    jsxRequestContext,
    createJsxFrameworkContext(request, options),
    render,
  );
}

/**
 * Bind one framework-owned deferred render to the exact JSX context that registered it.
 *
 * The callback re-enters through an isolated lifecycle, so response-body deferral preserves only
 * the JSX cell and cannot revive sibling request, egress, provenance, credential, or build cells
 * after the request owner has settled (SPEC §6.6).
 *
 * @internal Deferred-region lowering only; not exported from a package entrypoint.
 */
export function bindCurrentJsxRequestContext<Result>(
  callback: () => Result,
): () => RevocableFrameworkAsyncContextTask<Result> {
  const context = currentFrameworkAsyncContextValue(jsxRequestContext);
  if (context === undefined) {
    throw new TypeError('Owned deferred JSX re-entry requires an active registration context.');
  }
  let started = false;
  return () => {
    if (started) {
      throw new TypeError('Owned deferred JSX re-entry capabilities are one-shot.');
    }
    started = true;
    return runWithRevocableIsolatedFrameworkAsyncContext(jsxRequestContext, context, callback);
  };
}

function createJsxFrameworkContext(
  request: unknown,
  options: Omit<JsxFrameworkContext, 'mutationFormHelpers' | 'request'>,
): JsxFrameworkContext {
  const anonymousCsrfBindings = formHelperOwnDataValue(options, 'anonymousCsrfBindings') as
    | Map<string, JsxAnonymousCsrfBinding>
    | undefined;
  const attestationAuthority = formHelperOwnDataValue(options, 'attestationAuthority') as
    | LiveTargetAttestationAuthority
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
    ...(attestationAuthority === undefined ? {} : { attestationAuthority }),
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
