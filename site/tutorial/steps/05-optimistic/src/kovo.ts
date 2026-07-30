import { defineKovo } from '@kovojs/server';

import type { ShopRequest } from './db.js';

const EXAMPLE_ONLY_TUTORIAL_SHOP_CSRF_SECRET = 'EXAMPLE_ONLY_TUTORIAL_SHOP_CSRF_SECRET';

export const shopCsrf = {
  secret: tutorialDeploymentSecret(
    'KOVO_TUTORIAL_SHOP_CSRF_SECRET',
    EXAMPLE_ONLY_TUTORIAL_SHOP_CSRF_SECRET,
  ),
  sessionId(request: Pick<ShopRequest, 'session'>) {
    return request.session?.id;
  },
};

// One receiver owns the tutorial's query and mutation declarations. A deployed
// app supplies its DB provider to defineKovo; this in-memory tutorial keeps its
// custom database on the request carrier instead.
function tutorialAuth(request: ShopRequest) {
  return request.session ?? null;
}

type TutorialAppRequest = ShopRequest & {
  env: Readonly<Record<never, never>>;
  session: NonNullable<ShopRequest['session']> | null;
};

export const app = defineKovo<
  never,
  ShopRequest,
  typeof tutorialAuth,
  undefined,
  TutorialAppRequest,
  '218f982a-4914-46e1-a705-000000000005'
>({
  appId: '218f982a-4914-46e1-a705-000000000005',
  auth: tutorialAuth,
  csrf: shopCsrf,
});

function tutorialDeploymentSecret(envName: string, fallback: string): string {
  const secret = process.env[envName];
  if (secret && secret !== fallback) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${envName} must be set to a deployment-specific secret in production.`);
  }
  return fallback;
}
