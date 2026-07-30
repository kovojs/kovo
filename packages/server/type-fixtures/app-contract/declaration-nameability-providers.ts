// Provider-backed declaration-emission proof for SPEC §6.2.1's inferred app contract.
import { component } from '@kovojs/core';
import { defineKovo, s } from '@kovojs/server';
import type { InferKovoAppTypes } from '@kovojs/server/custom-adapters';

export type ProviderNote = {
  id: string;
  ownerId: string;
  text: string;
};

export interface ProviderSession {
  user: {
    id: string;
  };
}

export interface ProviderDb {
  insert(note: ProviderNote): void;
  notes: ProviderNote[];
  select(): ProviderNote[];
  transaction<Result>(run: (tx: unknown) => Result): Result;
}

const providerDb: ProviderDb = {
  insert(note) {
    this.notes.push(note);
  },
  notes: [],
  select() {
    return this.notes;
  },
  transaction(run) {
    return run({});
  },
};

export const providerApp = defineKovo({
  appId: 'a61f23f4-468f-48bc-8adf-9dfa43a09055',
  auth: (): ProviderSession => ({ user: { id: 'fixture-user' } }),
  db: (): ProviderDb => providerDb,
  egress: { enabled: false, justification: 'isolated provider nameability fixture' },
  env: s.object({ APP_NAME: s.string() }),
  envSource: { APP_NAME: 'Provider fixture' },
});

const providerNoteInput = s.object({
  id: s.string(),
  ownerId: s.string(),
  text: s.string(),
});

export const providerRefreshNotes = providerApp.task({
  input: s.object({ cursor: s.string() }),
  run: ({ cursor }) => ({ cursor }),
});

export const providerNotes = providerApp.query({
  access: [providerApp.authenticated],
  args: s.object({ ownerId: s.string() }),
  instanceKey: (input) => input.ownerId,
  load(input, context) {
    const appName: string = context.env.APP_NAME;
    const userId: string = context.session.user.id;
    return {
      appName,
      items: context.db.select().filter((note) => note.ownerId === input.ownerId),
      userId,
    };
  },
});

export const providerAddNote = providerApp.mutation({
  access: [providerApp.authenticated],
  errors: {
    DUPLICATE_NOTE: s.object({ id: s.string() }),
  },
  handler(input, request) {
    request.db.insert(input);
    void request.schedule(providerRefreshNotes, { cursor: input.id });
    void request.schedule(providerRefreshNotes, {
      // @ts-expect-error SPEC §6.2.1: scheduled task args retain the declared schema.
      renamedCursor: input.id,
    });
    return { id: input.id, userId: request.session.user.id };
  },
  input: providerNoteInput,
});

if (false) {
  // @ts-expect-error SPEC §6.2.1: opaque mutation handles do not expose runtime callbacks.
  providerAddNote.handler;
}

export const providerNotesRoute = providerApp.route('/provider-notes', {
  access: [providerApp.authenticated],
  page(_context, request) {
    const userId: string = request.session.user.id;
    void userId;
    return null;
  },
});

export const providerHealthEndpoint = providerApp.endpoint('/api/provider-health', {
  access: providerApp.publicAccess('public provider health fixture'),
  auth: { justification: 'public provider health fixture', kind: 'none' },
  csrf: false,
  csrfJustification: 'safe-method endpoint',
  db: true,
  handler: async (_request, context) => {
    const scope = await context.actAs('fixture-user');
    return Response.json({ count: scope.db.read.select().length });
  },
  method: 'GET',
  reason: 'provider declaration-nameability fixture',
  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
});

export const ProviderNotes = component({
  mutations: { addNote: providerAddNote },
  queries: { notes: providerNotes },
  render(
    _queries: {
      notes: {
        appName: string;
        items: ProviderNote[];
        userId: string;
      };
      title: string;
    },
    _state,
    { forms },
  ) {
    const submittedText: string | undefined = forms.addNote.submitted?.text;
    void submittedText;
    return null;
  },
});

export const providerKovoApp = providerApp.assemble({
  endpoints: [providerHealthEndpoint],
  mutations: [providerAddNote],
  queries: [providerNotes],
  routes: [providerNotesRoute],
  tasks: [providerRefreshNotes],
});

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Condition extends true> = Condition;
type ProviderAppTypes = InferKovoAppTypes<typeof providerKovoApp>;

// The opaque handle projection must not weaken the exact request contract consumed by the harness.
type _ProviderRequestDb = Assert<Equal<ProviderAppTypes['request']['db'], ProviderDb>>;
type _ProviderRequestSession = Assert<
  Equal<ProviderAppTypes['request']['session'], ProviderSession | null>
>;
type _ProviderRequestEnv = Assert<
  Equal<ProviderAppTypes['request']['env'], Readonly<{ readonly APP_NAME: string }>>
>;
