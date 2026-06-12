import { malformedJsonError } from './json.js';

export type RuntimeErrorReporter = (error: unknown) => void;

export function reportRuntimeError(
  onError: RuntimeErrorReporter | undefined,
  error: unknown,
): void {
  onError?.(error);
}

export function reportMalformedJson(
  onError: RuntimeErrorReporter | undefined,
  context: string,
  cause: unknown,
): void {
  reportRuntimeError(onError, malformedJsonError(context, cause));
}
