/** @jsxImportSource @kovojs/server */
import { component, FormError, type ComponentRenderSlots } from '@kovojs/core';
import { mutationFormAttributes } from '@kovojs/server';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';
import * as style from '@kovojs/style';

import { addContact } from '../mutations.js';
import { contactsQuery, type ContactListResult, type ContactRow } from '../queries.js';

// The contact book. Rendered as the full page region AND as the fragment that
// `addContact` refreshes, so adding a contact resets the form (with a fresh id)
// and re-renders the list in one round trip.

const styles = style.create({
  stack: { display: 'grid', gap: 22 },
  intro: {
    alignItems: 'end',
    display: 'flex',
    gap: 16,
    justifyContent: 'space-between',
    '@media (max-width: 640px)': {
      alignItems: 'start',
      flexDirection: 'column',
      gap: 8,
    },
  },
  titleBlock: { display: 'grid', gap: 6 },
  heading: {
    color: style.tokens.sys.color.onSurface,
    fontSize: 30,
    fontWeight: 700,
    letterSpacing: 0,
    lineHeight: 1.15,
    margin: 0,
    '@media (max-width: 640px)': { fontSize: 26 },
  },
  summary: {
    color: style.tokens.sys.color.onSurfaceVariant,
    fontSize: 14,
    lineHeight: 1.5,
    margin: 0,
    maxWidth: 560,
  },
  muted: {
    color: style.tokens.sys.color.onSurfaceVariant,
    fontSize: 14,
    lineHeight: 1.5,
    margin: 0,
  },
  formPanel: {
    backgroundColor: style.tokens.sys.color.surfaceContainerLowest,
    borderColor: style.tokens.sys.color.outlineVariant,
    borderRadius: style.tokens.sys.shape.cornerMedium,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: '0 1px 2px rgb(15 23 42 / 0.04)',
    display: 'grid',
    gap: 16,
    padding: 20,
    '@media (max-width: 640px)': { padding: 16 },
  },
  formHeader: { display: 'grid', gap: 4 },
  formTitle: {
    color: style.tokens.sys.color.onSurface,
    fontSize: 16,
    fontWeight: 650,
    lineHeight: 1.4,
    margin: 0,
  },
  formGrid: {
    display: 'grid',
    gap: 10,
    '@media (min-width: 820px)': { gridTemplateColumns: '1fr 1.1fr 1fr auto', alignItems: 'end' },
  },
  field: {
    color: style.tokens.sys.color.onSurfaceVariant,
    display: 'grid',
    fontSize: 12,
    fontWeight: 600,
    gap: 6,
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
    minHeight: 36,
    paddingBlock: 7,
    paddingInline: 12,
    width: '100%',
    ':focus-visible': {
      outlineColor: style.tokens.sys.color.primary,
      outlineOffset: 2,
      outlineStyle: 'solid',
      outlineWidth: 2,
    },
  },
  submit: {
    minWidth: 112,
    '@media (max-width: 819px)': {
      width: '100%',
    },
  },
  list: {
    display: 'grid',
    gap: 12,
    listStyle: 'none',
    margin: 0,
    padding: 0,
    '@media (min-width: 640px)': { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' },
  },
  card: {
    height: '100%',
    transitionProperty: 'border-color, box-shadow, transform',
    ':hover': {
      borderColor: style.tokens.sys.color.outline,
      boxShadow: '0 10px 24px rgb(15 23 42 / 0.07)',
      transform: 'translateY(-1px)',
    },
  },
  row: { display: 'grid', gap: 12 },
  rowTop: {
    alignItems: 'start',
    display: 'flex',
    gap: 12,
    justifyContent: 'space-between',
  },
  avatar: {
    alignItems: 'center',
    backgroundColor: style.tokens.sys.color.secondaryContainer,
    borderRadius: '999px',
    color: style.tokens.sys.color.onSecondaryContainer,
    display: 'inline-flex',
    flexShrink: 0,
    fontSize: 13,
    fontWeight: 700,
    height: 36,
    justifyContent: 'center',
    textTransform: 'uppercase',
    width: 36,
  },
  person: { alignItems: 'start', display: 'flex', gap: 12, minWidth: 0 },
  personCopy: { display: 'grid', gap: 2, minWidth: 0 },
  name: {
    color: style.tokens.sys.color.onSurface,
    fontSize: 15,
    fontWeight: 650,
    lineHeight: 1.35,
    margin: 0,
  },
  email: {
    color: style.tokens.sys.color.onSurfaceVariant,
    fontSize: 14,
    lineHeight: 1.45,
    margin: 0,
    overflowWrap: 'anywhere',
  },
  empty: {
    backgroundColor: style.tokens.sys.color.surfaceContainerLow,
    borderColor: style.tokens.sys.color.outlineVariant,
    borderRadius: style.tokens.sys.shape.cornerMedium,
    borderStyle: 'dashed',
    borderWidth: 1,
    color: style.tokens.sys.color.onSurfaceVariant,
    margin: 0,
    paddingBlock: 28,
    paddingInline: 20,
    textAlign: 'center',
  },
});

function renderContactCard(contact: ContactRow): string {
  const initials =
    contact.name
      .split(/\s+/u)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part.charAt(0))
      .join('') || 'C';

  return Card.definition.render({
    style: styles.card,
    children: (
      <div style={styles.row}>
        <div style={styles.rowTop}>
          <div style={styles.person}>
            <span aria-hidden="true" style={styles.avatar}>
              {initials}
            </span>
            <div style={styles.personCopy}>
              <p style={styles.name}>{contact.name}</p>
              <p style={styles.email}>{contact.email}</p>
            </div>
          </div>
          {Badge.definition.render({ variant: 'neutral', children: contact.company })}
        </div>
      </div>
    ),
  });
}

type ContactsRenderSlots = ComponentRenderSlots<{ addContact: typeof addContact }>;
interface DuplicateEmailFailure {
  code: 'DUPLICATE_EMAIL';
  payload: { email: string };
}
const defaultContactsRenderSlots: ContactsRenderSlots = {
  forms: { addContact: { failure: null } },
};

export const ContactsRegion = component({
  mutations: { addContact },
  queries: { contacts: contactsQuery },
  render: (
    { contacts }: { contacts: ContactListResult },
    _state,
    _slots: ContactsRenderSlots = defaultContactsRenderSlots,
  ) => {
    const items = contacts.items;

    return (
      <div style={styles.stack}>
        <div style={styles.intro}>
          <div style={styles.titleBlock}>
            <h1 style={styles.heading}>Contacts</h1>
            <p style={styles.summary}>Add a teammate, customer, or lead to the shared book.</p>
          </div>
          {Badge.definition.render({
            variant: 'outline',
            children: `${items.length} ${items.length === 1 ? 'contact' : 'contacts'}`,
          })}
        </div>

        {/* No-JS posts to the typed mutation endpoint; `enhance` upgrades it to a fragment swap. */}
        <form {...mutationFormAttributes(addContact)} style={styles.formPanel}>
          <div style={styles.formHeader}>
            <p style={styles.formTitle}>New contact</p>
            <p style={styles.muted}>Keep the people you work with close at hand.</p>
          </div>
          <div style={styles.formGrid}>
            <label style={styles.field}>
              <span>Name</span>
              <input name="name" required placeholder="Ada Lovelace" style={styles.input} />
            </label>
            <label style={styles.field}>
              <span>Email</span>
              <input
                name="email"
                required
                type="email"
                placeholder="ada@example.com"
                style={styles.input}
              />
            </label>
            <label style={styles.field}>
              <span>Company</span>
              <input name="company" placeholder="Analytical Engines" style={styles.input} />
            </label>
            {Button.definition.render({
              children: 'Add contact',
              size: 'md',
              style: styles.submit,
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

        {items.length === 0 ? (
          <p style={styles.empty}>No contacts yet. Add the first one above.</p>
        ) : (
          <ul style={styles.list}>
            {items.map((contact) => (
              <li>{renderContactCard(contact)}</li>
            ))}
          </ul>
        )}
      </div>
    );
  },
});
