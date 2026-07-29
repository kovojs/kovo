import { defineKovo } from '@kovojs/server';
import { renderRouteHtml } from '@kovojs/server/rendering';

import {
  referenceContractDbProvider,
  referenceContractSessionProvider,
} from './reference-context.js';

export const EXAMPLE_ONLY_REFERENCE_AUTH_CSRF_SECRET = 'EXAMPLE_ONLY_REFERENCE_AUTH_CSRF_SECRET';

export const referenceAuthCsrf = {
  field: 'csrf',
  secret: localFixtureCsrfSecret(
    'KOVO_REFERENCE_AUTH_CSRF_SECRET',
    EXAMPLE_ONLY_REFERENCE_AUTH_CSRF_SECRET,
  ),
  sessionId(request: unknown) {
    if (typeof request !== 'object' || request === null) return undefined;
    const authCsrfId =
      'authCsrfId' in request && typeof request.authCsrfId === 'string'
        ? request.authCsrfId
        : undefined;
    const session =
      'session' in request && typeof request.session === 'object' && request.session !== null
        ? request.session
        : undefined;
    const sessionId =
      session !== undefined && 'id' in session && typeof session.id === 'string'
        ? session.id
        : undefined;
    return sessionId ?? authCsrfId;
  },
};

/** Reference app provider and declaration contract (SPEC §6.2.1/§9.5). */
export const app = defineKovo({
  appId: '1f067065-c40a-4579-b35a-7fbcf928e32c',
  auth: referenceContractSessionProvider,
  csrf: referenceAuthCsrf,
  db: referenceContractDbProvider,
  document: { lang: 'en-US' },
  renderRoute(value) {
    return `<main>${renderRouteHtml(value)}</main>`;
  },
});

export type ReferenceAppRequest = Parameters<typeof app.authenticated>[0];

function localFixtureCsrfSecret(envName: string, fallback: string): string {
  const secret = process.env[envName];
  if (secret && secret !== fallback) return secret;
  // Auth operations are denied outside test/explicit local development by the fixture ingress
  // guard. Keep imports inert in production; this fallback never authorizes the disabled fixture.
  return fallback;
}
