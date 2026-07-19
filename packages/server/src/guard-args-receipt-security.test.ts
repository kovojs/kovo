import { describe, expect, it } from 'vitest';

import { guards, type GuardArgsRequest } from './guards.js';
import { runMutation } from './mutation.js';
import { query, runQuery } from './query.js';
import { s, type Schema } from './schema.js';
import { testMutation as mutation } from './test-fixtures.js';

// @kovo-security-classifier-corpus finite-security-operation-ir
// @kovo-security-certifies C13 guard-args-receipt-proxy-drift
describe('guard args classify-and-pin receipt (SPEC §6.6 / §10.3 C15)', () => {
  type AppRequest = { session?: { user?: { id: string } | null } | null };
  type ArgsRequest = GuardArgsRequest<AppRequest, { id: string }>;

  function driftingArgsSchema(): {
    readonly reads: () => number;
    readonly schema: Schema<{ id: string }>;
  } {
    const base = s.object({ id: s.string() });
    let reads = 0;
    return {
      reads: () => reads,
      schema: {
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
      },
    };
  }

  function ownershipGuard() {
    return guards.owns<AppRequest, ArgsRequest, string>(
      (request) => request.args.id,
      async (_request, acceptedKey) => acceptedKey === 'owned',
    );
  }

  it('pins the validated ownership key before an async query loader consumes it', async () => {
    const drift = driftingArgsSchema();
    const definition = query('security/guard-args-query-receipt', {
      args: drift.schema,
      guard: ownershipGuard(),
      async load(input: { id: string }): Promise<string> {
        await Promise.resolve();
        return input.id;
      },
      reads: [],
    });

    await expect(
      runQuery(definition, { id: 'owned' }, { session: { user: { id: 'owner' } } }),
    ).resolves.toMatchObject({ ok: true, value: 'owned' });
    expect(drift.reads()).toBe(0);
  });

  it('pins the validated ownership key before an async mutation handler consumes it', async () => {
    const drift = driftingArgsSchema();
    const definition = mutation('security/guard-args-mutation-receipt', {
      guard: ownershipGuard(),
      handler: async (input) => {
        await Promise.resolve();
        return input.id;
      },
      input: drift.schema,
    });

    await expect(
      runMutation(definition, { id: 'owned' }, { session: { user: { id: 'owner' } } }),
    ).resolves.toMatchObject({ ok: true, value: 'owned' });
    expect(drift.reads()).toBe(0);
  });
});
