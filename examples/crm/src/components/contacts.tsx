/** @jsxImportSource @kovojs/server */
import { component, FormError, type ComponentRenderSlots } from '@kovojs/core';
import { csrfField, mutationFormAttributes } from '@kovojs/server';
import { Avatar, AvatarFallback } from '@kovojs/ui/avatar';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';
import * as style from '@kovojs/style';

import { addContact, crmCsrf, type CrmRequest } from '../mutations.js';
import { addContactForm } from '../model.js';
import { contactListQuery, type ContactListResult, type ContactRow } from '../queries.js';
import { freshId } from '../components/chrome.js';
import { crmStyles } from '../styles.js';

// Contact book for `/contacts`. The add-contact form posts back to this region
// so the list refreshes with the new person.

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function renderContactCard(contact: ContactRow): string {
  return Card.definition.render({
    children: (
      <div {...style.attrs(crmStyles.row)}>
        {Avatar.definition.render({
          children: AvatarFallback.definition.render({ children: initials(contact.name) }),
        })}
        <div class="min-w-0 flex-1">
          <p {...style.attrs(crmStyles.tabularStrong)}>{contact.name}</p>
          <p {...style.attrs(crmStyles.muted)}>{contact.email}</p>
        </div>
        <span class="shrink-0">
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
    slots: ContactsRenderSlots = defaultContactsRenderSlots,
  ) => {
    const contacts = contactList.items;

    return (
      <div {...style.attrs(crmStyles.stack)}>
        <div>
          <h1 {...style.attrs(crmStyles.heading)}>Contacts</h1>
          <p {...style.attrs(crmStyles.muted)}>{contacts.length} people in the book.</p>
        </div>

        {/* The refreshed fragment resets the form with a fresh contact id. */}
        <form
          {...mutationFormAttributes(addContact)}
          {...style.attrs(crmStyles.formPanel)}
        >
          {slots.request ? csrfField(slots.request, crmCsrf) : ''}
          <input type="hidden" name="id" value={freshId('c')} />
          <input type="hidden" name="ownerId" value="u1" />
          <div {...style.attrs(crmStyles.formGridContacts)}>
            <input
              name="name"
              required
              placeholder="Full name"
              {...style.attrs(crmStyles.input)}
            />
            <input
              name="email"
              required
              type="email"
              placeholder="name@example.com"
              {...style.attrs(crmStyles.input)}
            />
            {Button.definition.render({
              children: 'Add contact',
              type: 'submit',
              variant: 'primary',
            })}
          </div>
          <FormError
            code="DUPLICATE_EMAIL"
            {...style.attrs(crmStyles.muted)}
            message={(failure: DuplicateEmailFailure) =>
              `${failure.payload.email} is already in the contact book.`
            }
          />
        </form>

        <ul class="grid gap-3 sm:grid-cols-2">
          {contacts.map((contact) => (
            <li>{renderContactCard(contact)}</li>
          ))}
        </ul>
      </div>
    );
  },
});
