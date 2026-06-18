// @kovojs-ir — lowered from examples/crm/src/components/contacts.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server/internal/html';
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
import { componentLiveTargetRenderer, registerGeneratedLiveTargetRenderer } from '@kovojs/server/internal/wire';


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
          <p {...style.attrs(crmStyles.tabularStrong)}>{escapeText(contact.name)}</p>
          <p {...style.attrs(crmStyles.muted)}>{escapeText(contact.email)}</p>
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
      <div {...style.attrs(crmStyles.stack)} kovo-c="contacts-region" kovo-deps="contactList" kovo-fragment-target="contacts-region" kovo-live-component="components/contacts/contacts-region">
        <div>
          <h1 {...style.attrs(crmStyles.heading)}>Contacts</h1>
          <p {...style.attrs(crmStyles.muted)}>{escapeText(contacts.length)} people in the book.</p>
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
          {FormError({ "failure": slots.forms.addContact.failure, "code": "DUPLICATE_EMAIL", "message": (failure: DuplicateEmailFailure) =>
              `${failure.payload.email} is already in the contact book.` })}
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
ContactsRegion.name = "components/contacts/contacts-region";

export const ContactsRegion$liveTargetRenderer = registerGeneratedLiveTargetRenderer(componentLiveTargetRenderer({
  component: ContactsRegion,
  componentId: "components/contacts/contacts-region",
}));
