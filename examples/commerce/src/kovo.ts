import { defineKovo } from '@kovojs/server';
import { renderRouteHtml } from '@kovojs/server/rendering';

import {
  commerceContractDbProvider,
  commerceContractSessionProvider,
} from './commerce-context.js';

export const EXAMPLE_ONLY_COMMERCE_AUTH_CSRF_SECRET = 'EXAMPLE_ONLY_COMMERCE_AUTH_CSRF_SECRET';

export const commerceAuthCsrf = {
  field: 'csrf',
  secret: localFixtureCsrfSecret(
    'KOVO_COMMERCE_AUTH_CSRF_SECRET',
    EXAMPLE_ONLY_COMMERCE_AUTH_CSRF_SECRET,
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

/** Commerce's one app-scoped provider and declaration contract (SPEC §6.2.1/§9.5). */
export const app = defineKovo({
  appId: '5f45a392-939c-41ad-9866-aec05b7798b8',
  auth: commerceContractSessionProvider,
  csrf: commerceAuthCsrf,
  db: commerceContractDbProvider,
  document: { lang: 'en-US' },
  renderRoute(value) {
    return routeValueToHtml(value);
  },
});

export type CommerceAppRequest = Parameters<typeof app.authenticated>[0];

function routeValueToHtml(value: unknown): string {
  return renderRouteHtml(value);
}

function localFixtureCsrfSecret(envName: string, fallback: string): string {
  const secret = process.env[envName];
  if (secret && secret !== fallback) return secret;
  // Auth operations are denied outside test/explicit local development by the fixture ingress
  // guard. Keep imports inert in production; this fallback never authorizes the disabled fixture.
  return fallback;
}
