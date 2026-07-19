import { describe, expect, it } from 'vitest';

import { guards, type GuardArgsRequest } from './guards.js';
import { runMutation } from './mutation.js';
import { query, runQuery } from './query.js';
import { s, type Schema } from './schema.js';
import { testMutation as mutation } from './test-fixtures.js';

// Retained regression for SPEC §6.6 / §10.3 C15: both final consumers must use the detached value
// accepted by guards.owns, never a later read from the schema-produced Proxy.
describe('OPP-28 runtime receipt regression', () => {
  type AppRequest = { session?: { user?: { id: string } | null } | null };
  type ArgsRequest = GuardArgsRequest<AppRequest, { id: string }>;

  function driftingArgsSchema(): Schema<{ id: string }> {
    const base = s.object({ id: s.string() });
    let reads = 0;
    return {
      parse(input) {
        const parsed = base.parse(input);
        return new Proxy(
          { id: parsed.id },
          {
            get(target, property, receiver) {
              if (property !== 'id') return Reflect.get(target, property, receiver) as unknown;
              reads += 1;
              return reads === 1 ? 'owned' : 'victim';
            },
          },
        );
      },
    };
  }

  function ownershipGuard() {
    return guards.owns<AppRequest, ArgsRequest, string>(
      (request) => request.args.id,
      async (_request, acceptedKey) => acceptedKey === 'owned',
    );
  }

  it('pins an accepted query key before the final consumer', async () => {
    const definition = query('opp28/args-query-drift', {
      args: driftingArgsSchema(),
      guard: ownershipGuard(),
      load: (input: { id: string }): string => input.id,
      reads: [],
    });

    await expect(
      runQuery(definition, { id: 'owned' }, { session: { user: { id: 'owner' } } }),
    ).resolves.toMatchObject({ ok: true, value: 'owned' });
  });

  it('pins an accepted mutation key through async handler dispatch', async () => {
    const definition = mutation('opp28/args-mutation-drift', {
      guard: ownershipGuard(),
      handler: async (input) => {
        await Promise.resolve();
        return input.id;
      },
      input: driftingArgsSchema(),
    });

    await expect(
      runMutation(definition, { id: 'owned' }, { session: { user: { id: 'owner' } } }),
    ).resolves.toMatchObject({ ok: true, value: 'owned' });
  });
});
