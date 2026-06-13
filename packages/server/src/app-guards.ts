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
    isRecord(value.document) &&
    isRecord(value.errorShells) &&
    isRecord(value.clientModules) &&
    typeof value.clientModules.put === 'function' &&
    typeof value.clientModules.resolve === 'function'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
