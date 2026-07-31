import { createRequestHandler } from '@kovojs/server/custom-adapters';
import { renderRouteHtml } from '@kovojs/server/rendering';
import { toNodeHandler } from '@kovojs/server/node';
import { trustedHtml } from '@kovojs/browser';

import {
  accountRoute,
  adminRoute,
  createReferenceAuth,
  createReferenceAuthFixture,
  referenceSignIn,
  referenceSignOut,
  type ReferenceAuthBindings,
  type ReferenceRequest,
} from './app.js';
import { app } from './kovo.js';
import { registerReferenceApplicationContext } from './reference-context.js';
import { ReferenceShellLoginForm } from './shell-auth-form.js';

export type ReferenceShellRequest = Request & ReferenceRequest;

export interface ReferenceAppShellOptions {
  auth?: ReferenceAuthBindings;
}

export const referenceLoginRoute = app.route('/login', {
  // The sign-in page must be reachable before authentication — public by design
  // (KV436 access decision, SPEC §10.2).
  access: app.publicAccess('sign-in page reachable before authentication'),
  meta: {
    description: 'Sign in to the Kovo reference app.',
    title: 'Kovo Reference Sign In',
  },
  page(context) {
    const next = typeof context.search.next === 'string' ? context.search.next : '/account';
    return trustedHtml(`<main>${ReferenceShellLoginForm({ next })}</main>`, {
      reason: 'reference login route composes the reviewed login form renderer',
      source: 'examples/reference/src/app-shell.ts',
    });
  },
});

const referenceRuntimeApp = app.assemble({
  mutations: [referenceSignIn, referenceSignOut],
  routes: [referenceLoginRoute, accountRoute, adminRoute],
});

export function createReferenceAppShell(options: ReferenceAppShellOptions = {}) {
  const application = createReferenceApplication(options);
  const requestHandler = createRequestHandler(application.app);
  return {
    ...application,
    nodeHandler: toNodeHandler(requestHandler),
    requestHandler,
  };
}

export function createReferenceApplication(options: ReferenceAppShellOptions = {}) {
  const auth = options.auth ?? createReferenceAuth(createReferenceAuthFixture());
  registerReferenceApplicationContext(auth);
  return { app: referenceRuntimeApp, auth };
}

export function routeValueToHtml(value: unknown): string {
  return renderRouteHtml(value);
}

export const referenceAppShell = createReferenceApplication();

export default referenceAppShell.app;
