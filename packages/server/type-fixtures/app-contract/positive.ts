// Compile-only proof fixture for the public app contract.
import { component, type FormFailure } from '@kovojs/core';
import { defineKovo, domain, s } from '@kovojs/server';

type Contact = {
  id: string;
  name: string;
  ownerId: string;
  status: 'active' | 'pending';
};

const contactsDomain = domain('contacts');
const app = defineKovo({
  appId: '42f11752-e2ca-4be0-ac6d-75ffb3f188bf',
  auth: () => ({ user: { id: 'user-1', roles: ['admin'] as readonly string[] } }),
  db: () => ({
    contacts: [] as Contact[],
    insert(contact: Contact) {
      this.contacts.push(contact);
    },
    select() {
      return this.contacts;
    },
    transaction<Result>(run: (tx: unknown) => Result) {
      return run({});
    },
  }),
  egress: { enabled: false, justification: 'isolated Track 4 type fixture' },
  env: s.object({ CRM_NAME: s.string() }),
  envSource: { CRM_NAME: 'Kovo CRM' },
});

const authenticatedAdmin = app.all(app.authenticated, app.role('admin'));

export const contacts = app.query({
  access: [app.authenticated],
  load(_input, context) {
    const userId: string = context.session.user.id;
    const crmName: string = context.env.CRM_NAME;
    const rows: Contact[] = context.db.select();

    // @ts-expect-error SPEC §6.2.1/§10.2: query DB capabilities are read-only.
    context.db.insert({ id: 'bad', name: crmName, ownerId: userId, status: 'pending' });
    // @ts-expect-error SPEC §6.2.1: the env schema owns the field names.
    void context.env.RENAMED_CRM_NAME;
    // @ts-expect-error SPEC §6.2.1: authenticated session identity is a string.
    const invalidUserId: number = context.session.user.id;
    void invalidUserId;

    return { items: rows };
  },
  reads: [contactsDomain],
});

export const contactsByOwner = app.query({
  access: [app.authenticated],
  args: s.object({ ownerId: s.string() }),
  instanceKey: (input) => input.ownerId,
  load(input, context) {
    const ownerId: string = input.ownerId;
    // @ts-expect-error SPEC §6.2.1/§10.2: query input follows the declared schema.
    void input.renamedOwnerId;
    return { items: context.db.select().filter((contact) => contact.ownerId === ownerId) };
  },
  reads: [contactsDomain],
});

const createContactInput = s.object({
  id: s.string(),
  name: s.string(),
  ownerId: s.string(),
});

const appendContact = contacts.optimistic(createContactInput, (value, input) => ({
  items: [
    ...value.items,
    {
      id: input.id,
      name: input.name,
      ownerId: input.ownerId,
      status: 'pending',
    },
  ],
}));

const appendOwnerContact = contactsByOwner.optimistic(createContactInput, {
  apply: (value, input) => ({
    items: [
      ...value.items,
      {
        id: input.id,
        name: input.name,
        ownerId: input.ownerId,
        status: 'pending',
      },
    ],
  }),
  keys: (input) => [{ ownerId: input.ownerId }],
});

const awaitContactsFragment = contacts.optimistic('await-fragment');

// @ts-expect-error SPEC §6.2.1/§10.4: authored status has one finite spelling.
contacts.optimistic('pending');

contacts.optimistic(createContactInput, () => ({
  // @ts-expect-error SPEC §6.2.1/§10.4: optimistic output equals the query result.
  items: 1,
}));

// @ts-expect-error SPEC §6.2.1: keyed queries require an explicit instance-key selector.
contactsByOwner.optimistic(createContactInput, (value) => value);

const incompatibleInput = s.object({ renamedId: s.string() });
const incompatibleBinding = contacts.optimistic(incompatibleInput, (value) => ({
  items: [...value.items],
}));

export const createContact = app.mutation({
  access: [authenticatedAdmin],
  errors: {
    DUPLICATE_NAME: s.object({ name: s.string() }),
  },
  handler(input, request, context) {
    request.db.insert({ ...input, status: 'active' });
    const userId: string = request.session.user.id;
    const crmName: string = request.env.CRM_NAME;

    // @ts-expect-error SPEC §6.2.1: mutation input renames fail at the use site.
    void input.renamedId;
    // @ts-expect-error SPEC §6.3: mutation error codes are declaration-derived.
    context.fail('RENAMED_ERROR', {});
    context.fail('DUPLICATE_NAME', { name: input.name });

    return { crmName, id: input.id, userId };
  },
  input: createContactInput,
  optimistic: [appendContact, appendOwnerContact, awaitContactsFragment],
  registry: { touches: [contactsDomain] },
});

const assertIncompatibleOptimism = () =>
  app.mutation({
    access: app.publicAccess('negative Track 4 type fixture'),
    handler: (input) => input,
    input: createContactInput,
    // @ts-expect-error SPEC §6.2.1/§10.4: optimistic input follows its mutation.
    optimistic: [incompatibleBinding],
  });
void assertIncompatibleOptimism;

const assertCsrfPosture = () =>
  // @ts-expect-error SPEC §10.3: disabling CSRF requires a local justification.
  app.mutation({
    access: app.publicAccess('negative Track 4 CSRF fixture'),
    csrf: false,
    handler: (input) => input,
    input: createContactInput,
  });
void assertCsrfPosture;

export const ContactList = component({
  mutations: { createContact },
  queries: { contacts },
  render(
    { contacts: result }: { contacts: { items: Contact[] }; title: string },
    _state,
    { forms },
  ) {
    const firstName: string | undefined = result.items[0]?.name;
    const submittedName: string | undefined = forms.createContact.submitted?.name;
    if (forms.createContact.failure?.code === 'DUPLICATE_NAME') {
      const duplicateName: string = forms.createContact.failure.payload.name;
      // @ts-expect-error SPEC §6.3: failure payload fields follow the declared schema.
      void forms.createContact.failure.payload.renamedName;
      void duplicateName;
    }
    // @ts-expect-error SPEC §6.3: submitted fields follow mutation input.
    void forms.createContact.submitted?.renamedName;
    // @ts-expect-error SPEC §6.3: form-error codes follow the mutation declaration.
    if (forms.createContact.failure?.code === 'RENAMED_ERROR') void forms;
    void firstName;
    void submittedName;
    return null;
  },
});

ContactList({ title: 'Contacts' });
// @ts-expect-error SPEC §4.1/§6.2.1: component props are exact and rename-safe.
ContactList({ heading: 'Contacts' });
// @ts-expect-error SPEC §4.1/§6.2.1: query results are framework-owned render inputs.
ContactList({ contacts: { items: [] }, title: 'Contacts' });

type CreateFailure = FormFailure<typeof createContact>;
const duplicateFailure: CreateFailure = {
  code: 'DUPLICATE_NAME',
  payload: { name: 'Ada' },
};
const assertRenamedFailure = () => {
  const failure: CreateFailure = {
    // @ts-expect-error SPEC §6.3: mutation error-code renames fail locally.
    code: 'RENAMED_ERROR',
    payload: { name: 'Ada' },
  };
  return failure;
};
void duplicateFailure;
void assertRenamedFailure;

export const contactRoute = app.route('/contacts/:contactId', {
  access: [authenticatedAdmin],
  params: s.object({ contactId: s.string() }),
  page(context, request) {
    const contactId: string = context.params.contactId;
    const userId: string = request.session.user.id;
    // @ts-expect-error SPEC §6.4: path-parameter renames fail at the property.
    void context.params.renamedContactId;
    void contactId;
    void userId;
    return null;
  },
});

export const healthEndpoint = app.endpoint('/api/health', {
  access: app.publicAccess('public health fixture'),
  auth: { justification: 'public health fixture', kind: 'none' },
  csrf: false,
  csrfJustification: 'safe-method endpoint',
  handler: () => Response.json({ ok: true }),
  method: 'GET',
  reason: 'Track 4 endpoint posture fixture',
  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
});

const assertEndpointPosture = () => {
  // @ts-expect-error SPEC §6.2.1/§9.1: endpoint access/auth posture cannot be inferred away.
  app.endpoint('/api/unsafe', {
    csrf: false,
    csrfJustification: 'negative Track 4 fixture',
    handler: () => new Response('unreachable'),
    method: 'GET',
    reason: 'negative Track 4 fixture',
    response: { appOwnedSafety: true, body: 'text', cache: 'no-store' },
  });
};
void assertEndpointPosture;

export const refreshContact = app.task({
  input: s.object({ contactId: s.string() }),
  run(input) {
    const contactId: string = input.contactId;
    // @ts-expect-error SPEC §6.2.1: task input follows the declared schema.
    void input.renamedContactId;
    return { contactId };
  },
});

app.assemble({
  endpoints: [healthEndpoint],
  mutations: [createContact],
  queries: [contacts, contactsByOwner],
  routes: [contactRoute],
  tasks: [refreshContact],
});
