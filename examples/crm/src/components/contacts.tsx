/** @jsxImportSource @kovojs/server */
import { component, FormError, type ComponentRenderSlots } from '@kovojs/core';
import { mutationFormAttributes } from '@kovojs/server';
import { Avatar, AvatarFallback } from '@kovojs/ui/avatar';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';
import * as style from '@kovojs/style';

import { addContact, type CrmRequest } from '../mutations.js';
import { addContactForm } from '../model.js';
import { contactListQuery, type ContactListResult, type ContactRow } from '../queries.js';
import { freshId } from '../components/chrome.js';

// Contact book for `/contacts`. The add-contact form posts back to this region
// so the list refreshes with the new person.

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

const contactStyles = style.create({
  cardBody: {
    flex: '1 1 0%',
    minWidth: 0,
  },
  cardBadge: {
    flexShrink: 0,
  },
  formGrid: {
    display: 'grid',
    gap: 8,
    '@media (min-width: 640px)': {
      alignItems: 'start',
      gridTemplateColumns: '1fr 1fr auto',
    },
  },
  formPanel: {
    backgroundColor: style.tokens.sys.color.surfaceContainerLowest,
    borderColor: style.tokens.sys.color.outlineVariant,
    borderRadius: style.tokens.sys.shape.cornerMedium,
    borderStyle: 'solid',
    borderWidth: 1,
    padding: 16,
  },
  heading: {
    color: style.tokens.sys.color.onSurface,
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: 0,
    lineHeight: 1.25,
    margin: 0,
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
    '@media (min-width: 640px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
  },
  muted: {
    color: style.tokens.sys.color.onSurfaceVariant,
    fontSize: 14,
  },
  row: {
    alignItems: 'center',
    display: 'flex',
    gap: 12,
  },
  stack: {
    display: 'grid',
    gap: 24,
  },
  tabularStrong: {
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
  },
});

function renderContactCard(contact: ContactRow): string {
  return Card.definition.render({
    children: (
      <div style={contactStyles.row}>
        {Avatar.definition.render({
          children: AvatarFallback.definition.render({ children: initials(contact.name) }),
        })}
        <div style={contactStyles.cardBody}>
          <p style={contactStyles.tabularStrong}>{contact.name}</p>
          <p style={contactStyles.muted}>{contact.email}</p>
        </div>
        <span style={contactStyles.cardBadge}>
          {Badge.definition.render({
            variant: contact.dealCount > 0 ? 'success' : 'neutral',
            children: `${contact.dealCount} ${contact.dealCount === 1 ? 'deal' : 'deals'}`,
          })}
        </span>
      </div>
    ),
  });
}

type ContactsRenderSlots = ComponentRenderSlots<{ addContact: typeof addContactForm }> & {
  request?: CrmRequest | undefined;
};
interface DuplicateEmailFailure {
  code: 'DUPLICATE_EMAIL';
  payload: { email: string };
}

const defaultContactsRenderSlots: ContactsRenderSlots = {
  forms: { addContact: { failure: null } },
};

// Rendered as both the full page region and the add-contact fragment payload.
export const ContactsRegion = component({
  mutations: { addContact: addContactForm },
  queries: { contactList: contactListQuery },
  render: (
    { contactList }: { contactList: ContactListResult },
    _state,
    _slots: ContactsRenderSlots = defaultContactsRenderSlots,
  ) => {
    const contacts = contactList.items;

    return (
      <div style={contactStyles.stack}>
        <div>
          <h1 style={contactStyles.heading}>Contacts</h1>
          <p style={contactStyles.muted}>{contacts.length} people in the book.</p>
        </div>

        {/* The refreshed fragment resets the form with a fresh contact id. */}
        <form {...mutationFormAttributes(addContact)} style={contactStyles.formPanel}>
          <input type="hidden" name="id" value={freshId('c')} />
          <div style={contactStyles.formGrid}>
            <input name="name" required placeholder="Full name" style={contactStyles.input} />
            <input
              name="email"
              required
              type="email"
              placeholder="name@example.com"
              style={contactStyles.input}
            />
            {Button.definition.render({
              children: 'Add contact',
              type: 'submit',
              variant: 'primary',
            })}
          </div>
          <FormError
            code="DUPLICATE_EMAIL"
            style={contactStyles.muted}
            message={(failure: DuplicateEmailFailure) =>
              `${failure.payload.email} is already in the contact book.`
            }
          />
        </form>

        <ul style={contactStyles.list}>
          {contacts.map((contact) => (
            <li>{renderContactCard(contact)}</li>
          ))}
        </ul>
      </div>
    );
  },
});
