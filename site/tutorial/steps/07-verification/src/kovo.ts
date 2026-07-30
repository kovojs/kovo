import { defineKovo } from '@kovojs/server';

import type { ShopRequest } from './db.js';

const EXAMPLE_ONLY_TUTORIAL_SHOP_CSRF_SECRET = 'EXAMPLE_ONLY_TUTORIAL_SHOP_CSRF_SECRET';

export interface TutorialSession {
  id: string;
  user: {
    id: string;
  };
}

export const shopCsrf = {
  secret: tutorialDeploymentSecret(
    'KOVO_TUTORIAL_SHOP_CSRF_SECRET',
    EXAMPLE_ONLY_TUTORIAL_SHOP_CSRF_SECRET,
  ),
  sessionId(request: Pick<ShopRequest, 'session'>) {
    return request.session?.id;
  },
};

type TutorialAppRequest = ShopRequest & {
  env: Readonly<Record<never, never>>;
  session: TutorialSession | null;
};

export const app = defineKovo<
  never,
  ShopRequest,
  typeof tutorialSession,
  undefined,
  TutorialAppRequest,
  '218f982a-4914-46e1-a707-000000000007'
>({
  appId: '218f982a-4914-46e1-a707-000000000007',
  auth: tutorialSession,
  csrf: shopCsrf,
});

function tutorialSession(request: ShopRequest): TutorialSession | null {
  const session = request.session;
  if (
    typeof session !== 'object' ||
    session === null ||
    !('id' in session) ||
    typeof session.id !== 'string' ||
    !('user' in session) ||
    typeof session.user !== 'object' ||
    session.user === null ||
    !('id' in session.user) ||
    typeof session.user.id !== 'string'
  ) {
    return null;
  }
  return { id: session.id, user: { id: session.user.id } };
}

function tutorialDeploymentSecret(envName: string, fallback: string): string {
  const secret = process.env[envName];
  if (secret && secret !== fallback) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${envName} must be set to a deployment-specific secret in production.`);
  }
  return fallback;
}
