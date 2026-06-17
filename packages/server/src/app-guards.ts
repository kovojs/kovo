import type { KovoApp } from './app-types.js';

// SPEC §9.5: app-shell dev and export tasks dynamically load user modules, then
// replay the closed app aggregate through the public Request -> Response shell.
export function isKovoApp(value: unknown): value is KovoApp {
  return (
    isRecord(value) &&
    isEndpointDeclarations(value.endpoints) &&
    isAppDiagnostics(value.diagnostics) &&
    isMutationDeclarations(value.mutations) &&
    isQueryDeclarations(value.queries) &&
    isRouteDeclarations(value.routes) &&
    isAppDocumentOptions(value.document) &&
    isAppErrorShellOptions(value.errorShells) &&
    isLiveTargetRenderers(value.liveTargetRenderers) &&
    isVersionedClientModuleRegistry(value.clientModules) &&
    isMutationResponses(value.mutationResponses) &&
    isOptionalMutationReplayStore(value.mutationReplayStore) &&
    isOptionalFunction(value.db) &&
    isOptionalFunction(value.onError) &&
    isOptionalFunction(value.renderRoute) &&
    isOptionalFunction(value.sessionProvider) &&
    isOptionalCsrfOptions(value.csrf)
  );
}

function isAppDiagnostics(value: unknown): value is KovoApp['diagnostics'] {
  return (
    Array.isArray(value) &&
    value.every(
      (diagnostic) =>
        isRecord(diagnostic) &&
        typeof diagnostic.code === 'string' &&
        typeof diagnostic.fileName === 'string' &&
        typeof diagnostic.message === 'string' &&
        (diagnostic.help === undefined || typeof diagnostic.help === 'string') &&
        (diagnostic.length === undefined || typeof diagnostic.length === 'number') &&
        (diagnostic.severity === undefined || typeof diagnostic.severity === 'string') &&
        (diagnostic.start === undefined ||
          (isRecord(diagnostic.start) &&
            typeof diagnostic.start.column === 'number' &&
            typeof diagnostic.start.line === 'number')),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAppDocumentOptions(value: unknown): value is KovoApp['document'] {
  return (
    isRecord(value) &&
    (value.lang === undefined || typeof value.lang === 'string') &&
    isOptionalFunction(value.template)
  );
}

function isAppErrorShellOptions(value: unknown): value is KovoApp['errorShells'] {
  return (
    isRecord(value) &&
    isOptionalFunction(value.forbidden) &&
    isOptionalFunction(value.notFound) &&
    isOptionalFunction(value.serverError)
  );
}

function isLiveTargetRenderers(value: unknown): value is KovoApp['liveTargetRenderers'] {
  return (
    Array.isArray(value) &&
    value.every(
      (renderer) =>
        isRecord(renderer) &&
        typeof renderer.component === 'string' &&
        typeof renderer.render === 'function',
    )
  );
}

function isMutationResponses(value: unknown): value is KovoApp['mutationResponses'] {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, policy]) =>
        typeof key === 'string' &&
        (typeof policy === 'function' || isMutationResponseOptions(policy)),
    )
  );
}

function isMutationResponseOptions(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.redirectTo === undefined ||
      typeof value.redirectTo === 'string' ||
      typeof value.redirectTo === 'function') &&
    isOptionalFunction(value.renderFailureFragment) &&
    isOptionalFunction(value.renderFailurePage) &&
    (value.failureTarget === undefined || typeof value.failureTarget === 'string') &&
    (value.failureStylesheets === undefined || Array.isArray(value.failureStylesheets)) &&
    (value.csrf === undefined || isOptionalCsrfOptions(value.csrf))
  );
}

function isVersionedClientModuleRegistry(value: unknown): value is KovoApp['clientModules'] {
  return (
    isRecord(value) &&
    typeof value.buildToken === 'function' &&
    typeof value.put === 'function' &&
    typeof value.resolve === 'function'
  );
}

function isEndpointDeclarations(value: unknown): value is KovoApp['endpoints'] {
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

function isMutationDeclarations(value: unknown): value is KovoApp['mutations'] {
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

function isQueryDeclarations(value: unknown): value is KovoApp['queries'] {
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

function isRouteDeclarations(value: unknown): value is KovoApp['routes'] {
  return (
    Array.isArray(value) &&
    value.every(
      (route) =>
        isRecord(route) &&
        typeof route.path === 'string' &&
        (route.boundaries === undefined || isRouteBoundaries(route.boundaries)) &&
        isOptionalFunction(route.guard) &&
        (route.layout === undefined || isRecord(route.layout)) &&
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

function isRouteBoundaries(value: unknown): boolean {
  return (
    isRecord(value) &&
    isOptionalFunction(value.error) &&
    isOptionalFunction(value.notFound) &&
    isOptionalFunction(value.unauthorized)
  );
}

function isDomainLike(value: unknown): boolean {
  return isRecord(value) && typeof value.key === 'string';
}

function isSchemaLike(value: unknown): boolean {
  return (
    (isRecord(value) || typeof value === 'function') &&
    typeof (value as { parse?: unknown }).parse === 'function'
  );
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
