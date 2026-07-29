import { route, s } from '@kovojs/server';

export const contactRoute = route('/contacts/:contactId', {
  params: s.object({ contactId: s.string() }),
  page({ params }) {
    return <main>Contact {params.contactId}</main>;
  },
});
