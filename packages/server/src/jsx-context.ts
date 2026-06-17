import { AsyncLocalStorage } from 'node:async_hooks';

type MaybePromise<Value> = Promise<Value> | Value;

const jsxRequestContext = new AsyncLocalStorage<unknown>();

export function currentJsxRequestContext(): unknown {
  return jsxRequestContext.getStore();
}

export function runWithJsxRequestContext<Value>(
  request: unknown,
  render: () => MaybePromise<Value>,
): MaybePromise<Value> {
  return jsxRequestContext.run(request, render);
}
