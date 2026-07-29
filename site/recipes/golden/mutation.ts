import { defineKovo, s } from '@kovojs/server';

const app = defineKovo({
  appId: 'f68bd563-574a-42d4-af25-b1631e7937c4',
  csrf: {
    anonymousCookie: false,
    secret: 'golden-mutation-csrf-secret-at-least-32-bytes',
    sessionId: () => undefined,
  },
});

export const createContact = app.mutation({
  access: app.publicAccess('the public demo accepts contact submissions'),
  input: s.object({ email: s.string().email(), name: s.string() }),
  handler: (input) => ({ created: input.email, name: input.name }),
});
