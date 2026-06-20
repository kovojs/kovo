/** @jsxImportSource @kovojs/server */
import { component, FormError, type ComponentRenderSlots } from '@kovojs/core';
import { mutationFormAttributes } from '@kovojs/server';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';
import * as style from '@kovojs/style';

import { addContact, addContactForm } from '../mutations.js';
import { contactsQuery, type ContactListResult, type ContactRow } from '../queries.js';

// The contact book. Rendered as the full page region AND as the fragment that
// `addContact` refreshes, so adding a contact resets the form (with a fresh id)
// and re-renders the list in one round trip.

const styles = style.create({
  stack: { display: 'grid', gap: 24 },
  heading: {
    color: style.tokens.sys.color.onSurface,
    fontSize: 24,
    fontWeight: 700,
    lineHeight: 1.25,
    margin: 0,
  },
  muted: { color: style.tokens.sys.color.onSurfaceVariant, fontSize: 14 },
  formPanel: {
    backgroundColor: style.tokens.sys.color.surfaceContainerLowest,
    borderColor: style.tokens.sys.color.outlineVariant,
    borderRadius: style.tokens.sys.shape.cornerMedium,
    borderStyle: 'solid',
    borderWidth: 1,
    display: 'grid',
    gap: 12,
    padding: 16,
  },
  formGrid: {
    display: 'grid',
    gap: 8,
    '@media (min-width: 640px)': { gridTemplateColumns: '1fr 1fr 1fr auto', alignItems: 'start' },
  },
  input: {
    backgroundColor: style.tokens.sys.color.surfaceContainerLowest,
    borderColor: style.tokens.sys.color.outline,
    borderRadius: style.tokens.sys.shape.cornerSmall,
    borderStyle: 'solid',
    borderWidth: 1,
    boxSizing: 'border-box',
    color: style.tokens.sys.color.onSurface,
    fontSize: 14,
    paddingBlock: 8,
    paddingInline: 12,
    width: '100%',
  },
  list: {
    display: 'grid',
    gap: 12,
    listStyle: 'none',
    margin: 0,
    padding: 0,
    '@media (min-width: 640px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  },
  row: { alignItems: 'center', display: 'flex', gap: 12, justifyContent: 'space-between' },
  name: { fontWeight: 600 },
});

function freshId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function renderContactCard(contact: ContactRow): string {
  return Card.definition.render({
    children: (
      <div style={styles.row}>
        <div>
          <p style={styles.name}>{contact.name}</p>
          <p style={styles.muted}>{contact.email}</p>
        </div>
        {Badge.definition.render({ variant: 'neutral', children: contact.company })}
      </div>
    ),
  });
}

type ContactsRenderSlots = ComponentRenderSlots<{ addContact: typeof addContactForm }>;
interface DuplicateEmailFailure {
  code: 'DUPLICATE_EMAIL';
  payload: { email: string };
}
const defaultContactsRenderSlots: ContactsRenderSlots = {
  forms: { addContact: { failure: null } },
};

export const ContactsRegion = component({
  mutations: { addContact: addContactForm },
  queries: { contacts: contactsQuery },
  render: (
    { contacts }: { contacts: ContactListResult },
    _state,
    _slots: ContactsRenderSlots = defaultContactsRenderSlots,
  ) => {
    const items = contacts.items;

    return (
      <div style={styles.stack}>
        <div>
          <h1 style={styles.heading}>Contacts</h1>
          <p style={styles.muted}>{items.length} people in the book.</p>
        </div>

        {/* No-JS posts to /_m/addContact; `enhance` upgrades it to a fragment swap. */}
        <form {...mutationFormAttributes(addContact)} style={styles.formPanel}>
          <input type="hidden" name="id" value={freshId('c')} />
          <div style={styles.formGrid}>
            <input name="name" required placeholder="Full name" style={styles.input} />
            <input
              name="email"
              required
              type="email"
              placeholder="name@example.com"
              style={styles.input}
            />
            <input name="company" placeholder="Company" style={styles.input} />
            {Button.definition.render({
              children: 'Add contact',
              type: 'submit',
              variant: 'primary',
            })}
          </div>
          <FormError
            code="DUPLICATE_EMAIL"
            style={styles.muted}
            message={(failure: DuplicateEmailFailure) =>
              `${failure.payload.email} is already in the contact book.`
            }
          />
        </form>

        <ul style={styles.list}>
          {items.map((contact) => (
            <li>{renderContactCard(contact)}</li>
          ))}
        </ul>
      </div>
    );
  },
});
