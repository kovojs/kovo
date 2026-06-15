/** @jsxImportSource @jiso/server */
import type { ContactRow } from '../queries.js';
import { renderCrmShell } from './chrome.js';

// Contact book (route `/contacts`). Reads the `contactList` rowset and shows
// each contact with their owner and rolling deal count (the `contacts.dealCount`
// column the createDeal mutation increments — see mutations.ts / the custom
// optimism that bumps contactList).

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

export function renderContactsPage({ contacts }: ContactsPageData): string {
  const body = (
    <div class="space-y-6">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">Contacts</h1>
        <p class="mt-1 text-sm text-slate-600">{contacts.length} people in the book.</p>
      </div>

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

  return renderCrmShell('contacts', body);
}
