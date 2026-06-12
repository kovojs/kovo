import type {
  Endpoint as CoreEndpoint,
  EndpointAuthDeclaration,
  EndpointMethod,
  EndpointMount,
} from '@jiso/core';

export type EndpointRequest = Request & { readonly session?: never };

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

export type EndpointDefinition<
  Method extends EndpointMethod = EndpointMethod,
  Mount extends EndpointMount = 'exact',
> = EndpointDefinitionBase<Method, Mount> & (EndpointCsrfDefault | EndpointCsrfExempt);

export interface EndpointDeclaration<
  Path extends string = string,
  Method extends EndpointMethod = EndpointMethod,
  Mount extends EndpointMount = EndpointMount,
> extends CoreEndpoint<Path, Method, Mount> {
  handler: EndpointHandler;
}

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

export async function runEndpoint(
  definition: EndpointDeclaration<string, EndpointMethod, EndpointMount>,
  request: Request,
): Promise<Response> {
  return definition.handler(endpointRequestWithoutSession(request));
}

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
