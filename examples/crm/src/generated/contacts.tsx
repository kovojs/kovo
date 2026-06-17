// @kovojs-ir — lowered from examples/crm/src/components/contacts.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server/internal/html';
import { component } from '@kovojs/core';
import { mutationFormAttributes } from '@kovojs/server';
import { Avatar, AvatarFallback } from '@kovojs/ui/avatar';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';

import { addContact } from '../mutations.js';
import { contactListQuery, type ContactListResult, type ContactRow } from '../queries.js';
import { freshId, renderCrmShell } from '../components/chrome.js';
import { componentLiveTargetRenderer } from '@kovojs/server/internal/wire';


// Contact book (route `/contacts`). Reads the `contactList` rowset and shows
// each contact with their owner and rolling deal count (the `contacts.dealCount`
// column the createDeal mutation increments — see mutations.ts / the custom
// optimism that bumps contactList). The whole region is a `kovo-fragment-target`
// host so the addContact mutationResponse can re-render it from server truth: a
// no-JS POST to `/_m/addContact` morphs the list with the new person in place
// (SPEC.md §9.1). The presentational company / job-title columns are intentionally
// NOT in this rowset query (they would leak placeholder tempIds into derived
// optimism — SPEC.md §10.5); they surface on the deal-detail page instead.

export const CONTACT_LIST_TARGET = 'contacts-region';

export interface ContactsPageData {
  contacts: ContactRow[];
}

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
          <p class="truncate font-semibold text-slate-900">{escapeText(contact.name)}</p>
          <p class="truncate text-sm text-slate-500">{escapeText(contact.email)}</p>
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

// The interactive region, rendered both inside the full page and as the
// addContact / createDeal fragment payload. SPEC.md §4.8: the query-backed
// component root derives its fragment target in the generated module.
export const ContactsRegion = component({
  queries: { contactList: contactListQuery },
  render: ({ contactList }: { contactList: ContactListResult }) => {
    const contacts = contactList.items;

    return (
      <div class="space-y-6" kovo-c="contacts-region" kovo-deps="contactList" kovo-fragment-target="contacts-region" kovo-live-component="components/contacts/contacts-region">
        <div>
          <h1 class="text-2xl font-bold tracking-tight">Contacts</h1>
          <p class="mt-1 text-sm text-slate-600">{escapeText(contacts.length)} people in the book.</p>
        </div>

        {/* SPEC.md §6.3: a no-JS "add contact" form. POSTs to the addContact
          mutation; the fragment re-renders this whole region so the new contact
          appears and the composer resets (with a fresh id). The text primary key
          is minted at render time so each submission is unique; ownerId is the
          demo session user. */}
        <form
          {...mutationFormAttributes(addContact)}
          class="rounded-lg border border-slate-200 bg-white p-4"
        >
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

export function renderContactsRegion({ contacts }: ContactsPageData): string {
  return ContactsRegion.definition.render({ contactList: { items: contacts } });
}

export function renderContactsPage(data: ContactsPageData): string {
  return renderCrmShell('contacts', renderContactsRegion(data));
}

export const ContactsRegion$liveTargetRenderer = componentLiveTargetRenderer({
  component: ContactsRegion,
  componentId: "components/contacts/contacts-region",
  queries: [
    {
      name: "contactList",
      query: contactListQuery,
    },
  ],
});
