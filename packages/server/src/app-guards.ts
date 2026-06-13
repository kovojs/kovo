import type { JisoApp } from './app-types.js';

// SPEC §9.5: app-shell dev and export tasks dynamically load user modules, then
// replay the closed app aggregate through the public Request -> Response shell.
export function isJisoApp(value: unknown): value is JisoApp {
  return (
    isRecord(value) &&
    Array.isArray(value.endpoints) &&
    Array.isArray(value.mutations) &&
    Array.isArray(value.queries) &&
    Array.isArray(value.routes) &&
    isAppDocumentOptions(value.document) &&
    isAppErrorShellOptions(value.errorShells) &&
    isVersionedClientModuleRegistry(value.clientModules) &&
    isOptionalFunction(value.mutationResponse) &&
    isOptionalMutationReplayStore(value.mutationReplayStore) &&
    isOptionalFunction(value.onError) &&
    isOptionalFunction(value.renderRoute) &&
    isOptionalFunction(value.sessionProvider) &&
    isOptionalCsrfOptions(value.csrf)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAppDocumentOptions(value: unknown): value is JisoApp['document'] {
  return (
    isRecord(value) &&
    (value.lang === undefined || typeof value.lang === 'string') &&
    isOptionalFunction(value.template)
  );
}

function isAppErrorShellOptions(value: unknown): value is JisoApp['errorShells'] {
  return (
    isRecord(value) &&
    isOptionalFunction(value.forbidden) &&
    isOptionalFunction(value.notFound) &&
    isOptionalFunction(value.serverError)
  );
}

function isVersionedClientModuleRegistry(value: unknown): value is JisoApp['clientModules'] {
  return isRecord(value) && typeof value.put === 'function' && typeof value.resolve === 'function';
}

function isOptionalFunction(value: unknown): boolean {
  return value === undefined || typeof value === 'function';
}

function isOptionalCsrfOptions(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) && typeof value.secret === 'string' && typeof value.sessionId === 'function')
  );
}

function isOptionalMutationReplayStore(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      typeof value.get === 'function' &&
      typeof value.reserve === 'function' &&
      typeof value.set === 'function')
  );
}
