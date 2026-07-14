/** @jsxImportSource @kovojs/server */
import { component } from '@kovojs/core';

import { chatQuery, type MessageRow } from './shared';

export const Messages = component({
  queries: { chatMessages: chatQuery },
  render: ({ chatMessages }: { chatMessages: { messages: MessageRow[] } }) => (
    <section aria-label="Messages">
      {chatMessages.messages.map((row) => (
        <article
          key={row.id}
          data-message-id={row.id}
          data-role={row.role}
          aria-live={row.role === 'assistant' ? 'polite' : undefined}
          aria-atomic={row.role === 'assistant' ? 'true' : undefined}
        >
          <p>{row.body}</p>
        </article>
      ))}
    </section>
  ),
});
