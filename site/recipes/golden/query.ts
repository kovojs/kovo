import { publicAccess, query, s } from '@kovojs/server';

export const contactQuery = query({
  access: publicAccess('the public directory is intentionally visible'),
  args: s.object({ contactId: s.string() }),
  output: s.object({ displayName: s.string(), id: s.string() }),
  load: ({ contactId }: { contactId: string }) => ({
    displayName: 'Ada Lovelace',
    id: contactId,
  }),
});
