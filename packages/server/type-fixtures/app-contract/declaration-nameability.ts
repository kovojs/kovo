// Declaration-emission proof for the ordinary app-scoped factories (SPEC §6.2.1).
import { component } from '@kovojs/core';
import { defineKovo, s } from '@kovojs/server';

export const app = defineKovo({
  appId: 'd1ac5e63-c597-4d9c-90f7-4513a1bf79ac',
  egress: { enabled: false, justification: 'isolated declaration-nameability fixture' },
});

const noteInput = s.object({ note: s.string() });

export const notes = app.query({
  access: app.publicAccess('public declaration-nameability fixture'),
  load: () => ({ items: [] as { note: string }[] }),
});

export const addNote = app.mutation({
  access: app.publicAccess('public declaration-nameability fixture'),
  handler: (input) => ({ note: input.note }),
  input: noteInput,
});

export const notesRoute = app.route('/notes', {
  access: app.publicAccess('public declaration-nameability fixture'),
  page: () => null,
});

export const healthEndpoint = app.endpoint('/api/health', {
  access: app.publicAccess('public declaration-nameability fixture'),
  auth: { justification: 'public health endpoint', kind: 'none' },
  csrf: false,
  csrfJustification: 'safe-method endpoint',
  handler: () => Response.json({ ok: true }),
  method: 'GET',
  reason: 'declaration-nameability fixture',
  response: { appOwnedSafety: true, body: 'json', cache: 'no-store' },
});

export const refreshNotes = app.task({
  input: s.object({ cursor: s.string() }),
  run: ({ cursor }) => ({ cursor }),
});

export const Notes = component({
  mutations: { addNote },
  queries: { notes },
  render: (_queries: { notes: { items: { note: string }[] }; title: string }) => null,
});

export const kovoApp = app.assemble({
  endpoints: [healthEndpoint],
  mutations: [addNote],
  queries: [notes],
  routes: [notesRoute],
  tasks: [refreshNotes],
});
