import { mutation, publicAccess, s } from '@kovojs/server';
import { type CsrfOptions } from '@kovojs/server/security';

interface ContactsRequest {
  contacts: { create(input: { email: string; name: string }): Promise<void> };
}

export function defineCreateContact(csrf: CsrfOptions<ContactsRequest>) {
  return mutation({
    access: publicAccess('the public demo accepts contact submissions'),
    csrf,
    input: s.object({ email: s.string().email(), name: s.string() }),
    async handler(input, request: ContactsRequest) {
      await request.contacts.create(input);
      return { created: input.email };
    },
  });
}
