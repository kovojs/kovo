/** @jsxImportSource @kovojs/server */
import { component, FormError, type ComponentRenderSlots } from '@kovojs/core';
import { csrfField, mutationFormAttributes } from '@kovojs/server';
import { Avatar, AvatarFallback } from '@kovojs/ui/avatar';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';

import { addContact, crmCsrf, type CrmRequest } from '../mutations.js';
import { addContactForm } from '../forms.js';
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

function renderContactCard(contact: ContactRow): string {
  return Card.definition.render({
    children: (
      <div class="flex items-center gap-3">
        {Avatar.definition.render({
          children: AvatarFallback.definition.render({ children: initials(contact.name) }),
        })}
        <div class="min-w-0 flex-1">
          <p class="truncate font-semibold text-slate-900">{contact.name}</p>
          <p class="truncate text-sm text-slate-500">{contact.email}</p>
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
type DuplicateEmailFailure = Extract<
  NonNullable<ContactsRenderSlots['forms']['addContact']['failure']>,
  { code: 'DUPLICATE_EMAIL' }
>;

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
      <div class="space-y-6">
        <div>
          <h1 class="text-2xl font-bold tracking-tight">Contacts</h1>
          <p class="mt-1 text-sm text-slate-600">{contacts.length} people in the book.</p>
        </div>

        {/* The refreshed fragment resets the form with a fresh contact id. */}
        <form
          {...mutationFormAttributes(addContact)}
          class="rounded-lg border border-slate-200 bg-white p-4"
        >
          {slots.request ? csrfField(slots.request, crmCsrf) : ''}
          <input type="hidden" name="id" value={freshId('c')} />
          <input type="hidden" name="ownerId" value="u1" />
          <div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
            <input
              name="name"
              required
              placeholder="Full name"
              class="crm-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              name="email"
              required
              type="email"
              placeholder="name@example.com"
              class="crm-input w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            {Button.definition.render({
              children: 'Add contact',
              type: 'submit',
              variant: 'primary',
            })}
          </div>
          <FormError
            code="DUPLICATE_EMAIL"
            class="mt-2 block text-sm text-red-700"
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
