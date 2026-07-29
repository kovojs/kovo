import { defineKovo, s } from '@kovojs/server';

const app = defineKovo({
  appId: '0c27a49f-2779-46cf-9b72-34478869ccb8',
  csrf: {
    anonymousCookie: false,
    secret: 'golden-inline-optimism-secret-at-least-32-bytes',
    sessionId: () => undefined,
  },
});

export const cartCountQuery = app.query({
  access: app.publicAccess('the anonymous cart count is intentionally visible'),
  output: s.object({ count: s.number().int().min(0) }),
  load: () => ({ count: 1 }),
});

const addItemInput = s.object({ quantity: s.number().int().min(1) });

export function predictCartCount(
  current: Readonly<{ count: number }>,
  input: { quantity: number },
) {
  return { count: current.count + input.quantity };
}

export const addItem = app.mutation({
  access: app.publicAccess('the anonymous cart write is protected by app CSRF'),
  input: addItemInput,
  optimistic: [cartCountQuery.optimistic(addItemInput, predictCartCount)],
  handler: ({ quantity }) => ({ quantity }),
});
