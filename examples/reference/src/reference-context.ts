import type { SessionProvider } from '@kovojs/server';

import type {
  ReferenceAuthBindings,
  ReferenceAuthDb,
  ReferenceRequest,
  ReferenceSession,
} from './auth.js';

let currentReferenceApplicationContext: ReferenceApplicationContext | undefined;

interface ReferenceApplicationContext {
  auth: ReferenceAuthBindings;
}

export interface ReferenceContractRequest extends Request {
  authCsrfId?: string | null;
  clientIp?: string;
}

export function registerReferenceApplicationContext(auth: ReferenceAuthBindings): void {
  currentReferenceApplicationContext = { auth };
}

export function referenceContractDbProvider(request: ReferenceContractRequest): ReferenceAuthDb {
  return referenceApplicationContext(request).auth.db;
}

export const referenceContractSessionProvider: SessionProvider<
  ReferenceContractRequest,
  ReferenceSession
> = (request) => {
  const { auth } = referenceApplicationContext(request);
  return auth.sessionProvider(referenceAuthRequest(request, auth.db));
};

function referenceApplicationContext(_request: Request): ReferenceApplicationContext {
  const context = currentReferenceApplicationContext;
  if (context === undefined) {
    throw new TypeError('Reference application context is not registered.');
  }
  return context;
}

function referenceAuthRequest(
  request: ReferenceContractRequest,
  db: ReferenceAuthDb,
): ReferenceRequest {
  return {
    ...(request.authCsrfId === undefined ? {} : { authCsrfId: request.authCsrfId }),
    ...(request.clientIp === undefined ? {} : { clientIp: request.clientIp }),
    db,
    headers: request.headers,
    url: request.url,
  };
}
