import type { JisoApp } from './app-types.js';

// SPEC §9.5: app-shell dev and export tasks dynamically load user modules, then
// replay the closed app aggregate through the public Request -> Response shell.
export function isJisoApp(value: unknown): value is JisoApp {
  return (
    isRecord(value) &&
    isEndpointDeclarations(value.endpoints) &&
    isMutationDeclarations(value.mutations) &&
    isQueryDeclarations(value.queries) &&
    isRouteDeclarations(value.routes) &&
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

function isEndpointDeclarations(value: unknown): value is JisoApp['endpoints'] {
  return (
    Array.isArray(value) &&
    value.every(
      (endpoint) =>
        isRecord(endpoint) &&
        typeof endpoint.path === 'string' &&
        typeof endpoint.handler === 'function' &&
        (endpoint.method === undefined || typeof endpoint.method === 'string') &&
        (endpoint.mount === undefined ||
          endpoint.mount === 'exact' ||
          endpoint.mount === 'prefix') &&
        (endpoint.auth === undefined || isRecord(endpoint.auth)) &&
        (endpoint.csrf === undefined ||
          (isRecord(endpoint.csrf) &&
            endpoint.csrf.exempt === true &&
            typeof endpoint.csrf.justification === 'string')),
    )
  );
}

function isMutationDeclarations(value: unknown): value is JisoApp['mutations'] {
  return (
    Array.isArray(value) &&
    value.every(
      (mutation) =>
        isRecord(mutation) &&
        typeof mutation.key === 'string' &&
        typeof mutation.handler === 'function' &&
        isSchemaLike(mutation.input) &&
        (mutation.csrf === undefined ||
          mutation.csrf === false ||
          isOptionalCsrfOptions(mutation.csrf)) &&
        (mutation.errors === undefined || isRecord(mutation.errors)) &&
        isOptionalFunction(mutation.guard) &&
        (mutation.registry === undefined || isRecord(mutation.registry)) &&
        isOptionalFunction(mutation.transaction),
    )
  );
}

function isQueryDeclarations(value: unknown): value is JisoApp['queries'] {
  return (
    Array.isArray(value) &&
    value.every(
      (query) =>
        isRecord(query) &&
        typeof query.key === 'string' &&
        Array.isArray(query.reads) &&
        query.reads.every(isDomainLike) &&
        (query.args === undefined || isSchemaLike(query.args)) &&
        isOptionalFunction(query.guard) &&
        (query.instanceKey === undefined ||
          typeof query.instanceKey === 'string' ||
          typeof query.instanceKey === 'function') &&
        isOptionalFunction(query.load) &&
        (query.output === undefined || isSchemaLike(query.output)) &&
        (query.version === undefined ||
          typeof query.version === 'number' ||
          typeof query.version === 'string' ||
          typeof query.version === 'function'),
    )
  );
}

function isRouteDeclarations(value: unknown): value is JisoApp['routes'] {
  return (
    Array.isArray(value) &&
    value.every(
      (route) =>
        isRecord(route) &&
        typeof route.path === 'string' &&
        isOptionalFunction(route.guard) &&
        isOptionalFunction(route.onUnauthenticated) &&
        isOptionalFunction(route.page) &&
        (route.params === undefined || isSchemaLike(route.params)) &&
        (route.search === undefined || isSchemaLike(route.search)) &&
        (route.staticPaths === undefined ||
          (Array.isArray(route.staticPaths) &&
            route.staticPaths.every((path) => typeof path === 'string'))),
    )
  );
}

function isDomainLike(value: unknown): boolean {
  return isRecord(value) && typeof value.key === 'string';
}

function isSchemaLike(value: unknown): boolean {
  return isRecord(value) && typeof value.parse === 'function';
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
