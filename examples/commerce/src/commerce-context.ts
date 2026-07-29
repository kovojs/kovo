import type { SessionProvider } from '@kovojs/server';

import type { CommerceAuthRequest } from './auth.js';
import type { CommerceDb, CommerceSession } from './domain.js';

const COMMERCE_CONTEXT_HEADER = 'x-kovo-commerce-context';
const commerceApplicationContexts = new Map<string, CommerceApplicationContext>();
let defaultCommerceContextId: string | undefined;

interface CommerceApplicationContext {
  db: CommerceDb;
  sessionProvider: SessionProvider<CommerceAuthRequest, CommerceSession>;
}

export interface CommerceContractRequest extends Request {
  authCsrfId?: string | null;
  clientIp?: string;
}

export function registerCommerceApplicationContext(context: CommerceApplicationContext): string {
  const id = crypto.randomUUID();
  commerceApplicationContexts.set(id, context);
  defaultCommerceContextId = id;
  return id;
}

export function bindCommerceApplicationRequest(request: Request, contextId: string): Request {
  if (!commerceApplicationContexts.has(contextId)) {
    throw new TypeError('Unknown commerce application context.');
  }
  request.headers.set(COMMERCE_CONTEXT_HEADER, contextId);
  return request;
}

export function commerceContractDbProvider(request: CommerceContractRequest): CommerceDb {
  return commerceApplicationContext(request).db;
}

export const commerceContractSessionProvider: SessionProvider<
  CommerceContractRequest,
  CommerceSession
> = (request) => {
  const context = commerceApplicationContext(request);
  return context.sessionProvider({
    ...(request.authCsrfId === undefined ? {} : { authCsrfId: request.authCsrfId }),
    ...(request.clientIp === undefined ? {} : { clientIp: request.clientIp }),
    db: context.db,
    headers: request.headers,
    url: request.url,
  });
};

function commerceApplicationContext(request: Request): CommerceApplicationContext {
  const requestedId = request.headers.get(COMMERCE_CONTEXT_HEADER);
  const context =
    (requestedId === null ? undefined : commerceApplicationContexts.get(requestedId)) ??
    (defaultCommerceContextId === undefined
      ? undefined
      : commerceApplicationContexts.get(defaultCommerceContextId));
  if (context === undefined) {
    throw new TypeError('Commerce application context is not registered.');
  }
  return context;
}
