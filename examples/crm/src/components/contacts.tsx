/** @jsxImportSource @kovojs/server */
import type { ContactRow } from '../queries.js';
import { freshId, renderCrmShell } from './chrome.js';

// Contact book (route `/contacts`). Reads the `contactList` rowset and shows
// each contact with their owner and rolling deal count (the `contacts.dealCount`
// column the createDeal mutation increments — see mutations.ts / the custom
// optimism that bumps contactList). The whole region is a `kovo-fragment-target`
// host so the addContact mutationResponse can re-render it from server truth: a
// no-JS POST to `/_m/addContact` morphs the list with the new person in place
// (SPEC.md §9.1).

export const CONTACT_LIST_TARGET = 'crm-contact-list';

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

// The interactive region, rendered both inside the full page and as the
// addContact / createDeal fragment payload (target = CONTACT_LIST_TARGET).
export function renderContactsRegion({ contacts }: ContactsPageData): string {
  return (
    <div class="space-y-6" kovo-fragment-target={CONTACT_LIST_TARGET}>
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Contacts</h1>
        <p class="mt-1 text-sm text-slate-600">{contacts.length} people in the book.</p>
      </div>

      {/* SPEC.md §6.3: a no-JS "add contact" form. POSTs to the addContact
          mutation; the fragment re-renders this whole region so the new contact
          appears and the composer resets (with a fresh id). The text primary key
          is minted at render time so each submission is unique; ownerId is the
          demo session user. */}
      <form
        method="post"
        action="/_m/addContact"
        enhance
        data-mutation="addContact"
        class="rounded-lg border border-slate-200 bg-white p-4"
      >
        <input type="hidden" name="id" value={freshId('c')} />
        <input type="hidden" name="ownerId" value="u1" />
        <div class="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
          <input
            name="name"
            required
            placeholder="Full name"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            name="email"
            required
            type="email"
            placeholder="name@example.com"
            class="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            class="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Add contact
          </button>
        </div>
      </form>

      <ul class="grid gap-3 sm:grid-cols-2">
        {contacts.map((contact) => (
          <li class="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-4">
            <span class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
              {initials(contact.name)}
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate font-medium">{contact.name}</p>
              <p class="truncate text-sm text-slate-500">{contact.email}</p>
            </div>
            <span class="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
              {contact.dealCount} {contact.dealCount === 1 ? 'deal' : 'deals'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function renderContactsPage(data: ContactsPageData): string {
  return renderCrmShell('contacts', renderContactsRegion(data));
}
