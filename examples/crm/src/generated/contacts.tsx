// @kovojs-ir — lowered from examples/crm/src/components/contacts.tsx by @kovojs/compiler (SPEC.md section 5.2). Do not edit; regenerate with `pnpm run emit-components`.
/** @jsxImportSource @kovojs/server */
import { escapeText } from '@kovojs/server/internal/html';
import { component, FormError, type ComponentRenderSlots } from '@kovojs/core';
import { mutationFormAttributes } from '@kovojs/server';
import { Avatar, AvatarFallback } from '@kovojs/ui/avatar';
import { Badge } from '@kovojs/ui/badge';
import { Button } from '@kovojs/ui/button';
import { Card } from '@kovojs/ui/card';
import { tokens } from '@kovojs/style';
import * as style from '@kovojs/style';

import { addContact, type CrmRequest } from '../mutations.js';
import { addContactForm } from '../model.js';
import { contactListQuery, type ContactListResult, type ContactRow } from '../queries.js';
import { freshId } from '../components/chrome.js';
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
    backgroundColor: tokens.sys.color.surfaceContainerLowest,
    borderColor: tokens.sys.color.outlineVariant,
    borderRadius: tokens.sys.shape.cornerMedium,
    borderStyle: 'solid',
    borderWidth: 1,
    padding: 16,
  },
  heading: {
    color: tokens.sys.color.onSurface,
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: 0,
    lineHeight: 1.25,
    margin: 0,
  },
  input: {
    backgroundColor: tokens.sys.color.surfaceContainerLowest,
    borderColor: tokens.sys.color.outline,
    borderRadius: tokens.sys.shape.cornerSmall,
    borderStyle: 'solid',
    borderWidth: 1,
    boxSizing: 'border-box',
    color: tokens.sys.color.onSurface,
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
    color: tokens.sys.color.onSurfaceVariant,
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

export const contactStyleCss = style.emitAtomicCss(
  Object.values(contactStyles).flatMap((entry) => entry.__rules ?? []),
);

function renderContactCard(contact: ContactRow): string {
  return Card.definition.render({
    children: (
      <div class="kv-contact-align-kr7kq4 kv-contact-d-gyheaw kv-contact-gap-98dr4o" data-style-src="examples/crm/src/components/contacts.tsx#row">
        {Avatar.definition.render({
          children: AvatarFallback.definition.render({ children: initials(contact.name) }),
        })}
        <div class="kv-contact-flex-16ca3z kv-contact-min-1wr6wg" data-style-src="examples/crm/src/components/contacts.tsx#cardBody">
          <p class="kv-contact-font-4v1il5 kv-contact-font-1bl9ee" data-style-src="examples/crm/src/components/contacts.tsx#tabularStrong">{escapeText(contact.name)}</p>
          <p class="kv-contact-fg-19gc10 kv-contact-font-1rygq8" data-style-src="examples/crm/src/components/contacts.tsx#muted">{escapeText(contact.email)}</p>
        </div>
        <span class="kv-contact-flex-12e9in" data-style-src="examples/crm/src/components/contacts.tsx#cardBadge">
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
      <div class="kv-contact-d-35rcxb kv-contact-gap-nekf6v" data-style-src="examples/crm/src/components/contacts.tsx#stack" kovo-c="contacts-region" kovo-deps="contactList" kovo-fragment-target="contacts-region" kovo-live-component="components/contacts/contacts-region">
        <div>
          <h1 class="kv-contact-fg-1b909x kv-contact-font-4cosxi kv-contact-font-11kkrq kv-contact-letter-15wj4r kv-contact-line-lk5pgb kv-contact-m-5u1b4h" data-style-src="examples/crm/src/components/contacts.tsx#heading">Contacts</h1>
          <p class="kv-contact-fg-19gc10 kv-contact-font-1rygq8" data-style-src="examples/crm/src/components/contacts.tsx#muted">{escapeText(contacts.length)} people in the book.</p>
        </div>

        {/* The refreshed fragment resets the form with a fresh contact id. */}
        <form {...mutationFormAttributes(addContact)} class="kv-contact-bg-144jhh kv-contact-bd-onez8x kv-contact-bd-ejq4bt kv-contact-bd-1sy3k0 kv-contact-bd-1c40yo kv-contact-pad-itmub1" data-style-src="examples/crm/src/components/contacts.tsx#formPanel">
          <input type="hidden" name="id" value={freshId('c')} />
          <input type="hidden" name="ownerId" value="u1" />
          <div class="kv-contact-d-35rcxb kv-contact-gap-ya510v kv-contact-align-5dr6mb kv-contact-grid-14pg6z" data-style-src="examples/crm/src/components/contacts.tsx#formGrid">
            <input name="name" required placeholder="Full name" class="kv-contact-bg-144jhh kv-contact-bd-1u2qp7 kv-contact-bd-ra0es7 kv-contact-bd-1sy3k0 kv-contact-bd-1c40yo kv-contact-box-1gvzd3 kv-contact-fg-1b909x kv-contact-font-1rygq8 kv-contact-pad-kcv6bq kv-contact-pad-13ileu kv-contact-w-lhhf6b" data-style-src="examples/crm/src/components/contacts.tsx#input" />
            <input
              name="email"
              required
              type="email"
              placeholder="name@example.com"
              class="kv-contact-bg-144jhh kv-contact-bd-1u2qp7 kv-contact-bd-ra0es7 kv-contact-bd-1sy3k0 kv-contact-bd-1c40yo kv-contact-box-1gvzd3 kv-contact-fg-1b909x kv-contact-font-1rygq8 kv-contact-pad-kcv6bq kv-contact-pad-13ileu kv-contact-w-lhhf6b" data-style-src="examples/crm/src/components/contacts.tsx#input"
            />
            {Button.definition.render({
              children: 'Add contact',
              type: 'submit',
              variant: 'primary',
            })}
          </div>
          {FormError({ "failure": _slots.forms.addContact.failure, "code": "DUPLICATE_EMAIL", "class": "kv-contact-fg-19gc10 kv-contact-font-1rygq8", "data-style-src": "examples/crm/src/components/contacts.tsx#muted", "message": (failure: DuplicateEmailFailure) =>
              `${failure.payload.email} is already in the contact book.` })}
        </form>

        <ul class="kv-contact-d-35rcxb kv-contact-gap-98dr4o kv-contact-list-13bp8i kv-contact-m-5u1b4h kv-contact-pad-18rrwl kv-contact-grid-bhng0g" data-style-src="examples/crm/src/components/contacts.tsx#list">
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
