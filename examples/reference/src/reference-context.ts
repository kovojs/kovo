import type { SessionProvider } from '@kovojs/server';

import type {
  ReferenceAuthBindings,
  ReferenceAuthDb,
  ReferenceRequest,
  ReferenceSession,
} from './auth.js';

const referenceApplicationContextCapacity = 4_096;
const referenceApplicationContexts = new Map<string, ReferenceApplicationContext>();
let defaultReferenceContextId: string | undefined;

interface ReferenceApplicationContext {
  auth: ReferenceAuthBindings;
}

export interface ReferenceContractRequest extends Request {
  authCsrfId?: string | null;
  clientIp?: string;
}

export function registerReferenceApplicationContext(auth: ReferenceAuthBindings): string {
  if (referenceApplicationContexts.size >= referenceApplicationContextCapacity) {
    throw new TypeError('Reference application context capacity exceeded.');
  }
  const id = crypto.randomUUID();
  referenceApplicationContexts.set(id, { auth });
  defaultReferenceContextId = id;
  return id;
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
  const context =
    defaultReferenceContextId === undefined
      ? undefined
      : referenceApplicationContexts.get(defaultReferenceContextId);
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
