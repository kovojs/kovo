import { defineKovo, s } from '@kovojs/server';

const app = defineKovo({
  appId: '4109e077-a43d-4f42-bd6c-8b8a33981cd7',
});

export const contactQuery = app.query({
  access: app.publicAccess('the public directory is intentionally visible'),
  args: s.object({ contactId: s.string() }),
  output: s.object({ displayName: s.string(), id: s.string() }),
  load: ({ contactId }: { contactId: string }) => ({
    displayName: 'Ada Lovelace',
    id: contactId,
  }),
});
