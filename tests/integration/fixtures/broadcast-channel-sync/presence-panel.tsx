/** @jsxImportSource @kovojs/server */
import { component, form } from '@kovojs/core';

import { publishPresence } from './app';
import { presenceQuery, type Presence } from './shared';

const publishPresenceForm = form<'broadcast-channel-sync/publish', Record<string, never>>(
  'broadcast-channel-sync/publish',
);

// SPEC §§9.1/9.3: compiler-owned response authority produces the query chunk
// that the browser may rebroadcast to another same-principal tab.
export const PresencePanel = component({
  mutations: { publishPresence: publishPresenceForm },
  queries: { presence: presenceQuery },
  render: ({ presence }: { presence: Presence }) => (
    <section id="presence-panel">
      <output>{presence.status}</output>
      <form id="presence-form" mutation={publishPresence}>
        <button type="submit">Publish presence</button>
      </form>
    </section>
  ),
});
