import { malformedJsonError } from './json.js';
import type { RuntimeErrorContext } from './events.js';

export type RuntimeErrorReporter = (error: unknown) => void;
export type RuntimeContextErrorReporter = (error: unknown, context: RuntimeErrorContext) => void;

export function reportRuntimeError(
  onError: RuntimeErrorReporter | undefined,
  error: unknown,
): void {
  onError?.(error);
}

export function reportRuntimeContextError(
  onError: RuntimeContextErrorReporter | undefined,
  error: unknown,
  context: RuntimeErrorContext,
): void {
  onError?.(error, context);
}

export function reportMalformedJson(
  onError: RuntimeErrorReporter | undefined,
  context: string,
  cause: unknown,
): void {
  reportRuntimeError(onError, malformedJsonError(context, cause));
}
