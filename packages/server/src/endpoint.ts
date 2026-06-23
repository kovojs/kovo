import type { WebhookVerifier } from '@kovojs/core';

/** HTTP method for an endpoint; arbitrary strings are allowed for custom verbs. */
export type EndpointMethod = 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT' | (string & {});

/** Whether an endpoint matches an exact path or a path prefix. */
export type EndpointMount = 'exact' | 'prefix';

/** Records an explicit, justified opt-out of default-on CSRF for an endpoint (SPEC §6.6). */
export interface EndpointCsrfExemption {
  exempt: true;
  justification: string;
}

/** How an endpoint authenticates: a named verifier, a named custom scheme, or a justified `none`. */
export type EndpointAuthDeclaration =
  | { kind: 'custom'; name: string; verify?: WebhookVerifier }
  | { kind: 'none'; justification: string }
  | { kind: 'verifier'; name: string; verify?: WebhookVerifier };

/** A raw HTTP endpoint descriptor: path, method, mount mode, and auth/CSRF declarations. */
export interface Endpoint<
  Path extends string,
  Method extends EndpointMethod = EndpointMethod,
  Mount extends EndpointMount = 'exact',
> {
  auth?: EndpointAuthDeclaration;
  csrf?: EndpointCsrfExemption;
  method?: Method;
  mount: Mount;
  path: Path;
}

/** A `Request` guaranteed to carry no session, as endpoint handlers receive. */
export type EndpointRequest = Request & { readonly session?: never };

/** An endpoint handler: maps a session-free `Request` to a `Response`. */
export type EndpointHandler = (request: EndpointRequest) => Promise<Response> | Response;

interface EndpointDefinitionBase<Method extends EndpointMethod, Mount extends EndpointMount> {
  auth?: EndpointAuthDeclaration;
  handler: EndpointHandler;
  method?: Method;
  mount?: Mount;
}

interface EndpointCsrfDefault {
  csrf?: true;
  csrfJustification?: never;
}

interface EndpointCsrfExempt {
  csrf: false;
  csrfJustification: string;
}

/** The body passed to `endpoint()`: handler, method/mount, and the CSRF default-or-exempt choice. */
export type EndpointDefinition<
  Method extends EndpointMethod = EndpointMethod,
  Mount extends EndpointMount = 'exact',
> = EndpointDefinitionBase<Method, Mount> & (EndpointCsrfDefault | EndpointCsrfExempt);

/** An endpoint with its path attached, as returned by `endpoint()`. */
export interface EndpointDeclaration<
  Path extends string = string,
  Method extends EndpointMethod = EndpointMethod,
  Mount extends EndpointMount = EndpointMount,
> extends Endpoint<Path, Method, Mount> {
  handler: EndpointHandler;
}

/**
 * Declare a raw HTTP endpoint: a `handler` taking a `Request` and returning a
 * `Response`, mounted at an exact path or a path `prefix`. Endpoints are the
 * escape hatch for machine traffic (webhooks, APIs) that bypasses the page/query
 * pipeline. CSRF is default-on — opt out with `csrf: false` plus a justification
 * (SPEC §6.6).
 *
 * @param path - The path the endpoint mounts at.
 * @param definition - The `handler`, plus optional `method`, `mount`, `auth`, and CSRF opt-out.
 * @returns An `EndpointDeclaration`.
 * @example
 * import { endpoint } from '@kovojs/server';
 *
 * export const health = endpoint('/healthz', {
 *   method: 'GET',
 *   csrf: false,
 *   csrfJustification: 'read-only health probe',
 *   handler: () => new Response('ok'),
 * });
 */
export function endpoint<
  const Path extends string,
  const Method extends EndpointMethod = EndpointMethod,
  const Mount extends EndpointMount = 'exact',
>(
  path: Path,
  definition: EndpointDefinition<Method, Mount>,
): EndpointDeclaration<Path, Method, Mount> {
  const mount = definition.mount ?? ('exact' as Mount);

  return {
    ...(definition.auth === undefined ? {} : { auth: definition.auth }),
    ...(definition.csrf === false
      ? { csrf: { exempt: true, justification: definition.csrfJustification } }
      : {}),
    handler: definition.handler,
    ...(definition.method === undefined ? {} : { method: definition.method }),
    mount,
    path,
  };
}

/**
 * Invoke an endpoint's handler for a request (with the session stripped, since
 * endpoints are session-free by construction).
 *
 * @param definition - The endpoint to run.
 * @param request - The incoming request.
 * @returns The handler's `Response`.
 * @internal
 */
export async function runEndpoint(
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  request: Request,
): Promise<Response> {
  return definition.handler(endpointRequestWithoutSession(request));
}

/**
 * Enforce an endpoint's executable auth verifier before dispatch. Name-only
 * auth declarations remain audit metadata; declarations carrying `verify` are
 * checked fail-closed over cloned raw bytes so the handler still receives the
 * original body (SPEC §9.1).
 *
 * @param definition - The endpoint whose auth declaration should run.
 * @param request - The incoming request.
 * @returns A 401 `Response` when auth fails, otherwise `undefined`.
 * @internal
 */
export async function runEndpointAuth(
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  request: Request,
): Promise<Response | undefined> {
  const verifier = definition.auth?.kind === 'none' ? undefined : definition.auth?.verify;
  if (verifier === undefined) return undefined;

  let verified = false;
  try {
    const authRequest = endpointRequestWithoutSession(request.clone());
    verified = await verifier.verify({
      headers: authRequest.headers,
      payload: new Uint8Array(await authRequest.arrayBuffer()),
    });
  } catch {
    verified = false;
  }

  return verified ? undefined : endpointAuthFailureResponse();
}

/**
 * Test whether an endpoint matches a method and pathname, honoring exact vs
 * `prefix` mounting.
 *
 * @param definition - The endpoint to test.
 * @param input - The incoming `pathname` and optional `method`.
 * @returns `true` when the endpoint matches.
 * @internal
 */
export function endpointMatches(
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  input: { method?: string; pathname: string },
): boolean {
  if (definition.method !== undefined && input.method !== undefined) {
    if (definition.method.toUpperCase() !== input.method.toUpperCase()) return false;
  }

  if (definition.mount === 'prefix') {
    return (
      input.pathname === definition.path ||
      input.pathname.startsWith(`${definition.path.replace(/\/$/, '')}/`)
    );
  }

  return input.pathname === definition.path;
}

export function endpointRequestWithoutSession(request: Request): EndpointRequest {
  if (!('session' in request)) return request as EndpointRequest;

  // SPEC.md §9.1: raw endpoints do not receive the app session request extension.
  return new Proxy(request, {
    get(target, property) {
      if (property === 'session') return undefined;

      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
    has(target, property) {
      if (property === 'session') return false;
      return property in target;
    },
  }) as EndpointRequest;
}

function endpointAuthFailureResponse(): Response {
  return new Response('Unauthorized', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    status: 401,
  });
}
