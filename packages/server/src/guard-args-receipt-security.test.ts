import { describe, expect, it, vi } from 'vitest';

import { guards, type Guard, type GuardArgsRequest } from './guards.js';
import { runMutation } from './mutation.js';
import { query, runQuery } from './query.js';
import { s, type Schema } from './schema.js';
import { testMutation as mutation } from './test-fixtures.js';

// @kovo-security-classifier-corpus finite-security-operation-ir
// @kovo-security-certifies C13 guard-args-receipt-proxy-drift
// @kovo-security-certifies C13 guard-args-receipt-borrowed-date-mutator
describe('guard args classify-and-pin receipt (SPEC §6.6 / §10.3 C15)', () => {
  type AppRequest = { session?: { user?: { id: string } | null } | null };
  type ArgsRequest = GuardArgsRequest<AppRequest, { id: string }>;
  type DateArgs = { authorized: Date; selected: Date };
  type DateArgsRequest = GuardArgsRequest<AppRequest, DateArgs>;

  const authorizedDate = '2025-07-20T00:00:00.000Z';
  const selectedDate = '1970-01-01T00:00:00.000Z';
  const rejectedDateMessage =
    'Validated guard args cannot contain Date values because JavaScript Date internal slots are mutable through borrowed native mutators; use an ISO timestamp string or epoch number instead.';

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
    return guards.unprovenOwns<AppRequest, ArgsRequest, string>(
      (request) => request.args.id,
      async (_request, acceptedKey) => acceptedKey === 'owned',
      { justification: 'Receipt regression exercises a legacy ownership predicate.' },
    );
  }

  function attemptedArgsMutationGuard(): Guard<AppRequest> {
    return (request) => {
      expect(() => {
        (request as ArgsRequest).args.id = 'victim';
      }).toThrow();
      expect(() => {
        Object.defineProperty((request as ArgsRequest).args, 'id', { value: 'victim' });
      }).toThrow();
      return true;
    };
  }

  function ownershipThenMutationAttempt(): Guard<AppRequest> {
    return guards.all<AppRequest>(ownershipGuard(), attemptedArgsMutationGuard());
  }

  function dateOwnershipThenRemoteSelection(): Guard<AppRequest> {
    const ownsAuthorizedDate = guards.unprovenOwns<AppRequest, DateArgsRequest, Date>(
      (request) => request.args.authorized,
      async (_request, accepted) => accepted.toISOString() === authorizedDate,
      { justification: 'Receipt regression exercises a legacy ownership predicate.' },
    );
    const applyRemoteSelection: Guard<AppRequest> = (request) => {
      const args = (request as DateArgsRequest).args;
      Date.prototype.setTime.call(args.authorized, args.selected.getTime());
      return true;
    };
    return guards.all<AppRequest>(ownsAuthorizedDate, applyRemoteSelection);
  }

  async function expectBorrowedDateMutationClosed(
    operation: Promise<unknown>,
    consumer: ReturnType<typeof vi.fn>,
    sessionProvider: ReturnType<typeof vi.fn>,
  ): Promise<void> {
    let failure: unknown;
    try {
      await operation;
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(TypeError);
    expect(failure).toHaveProperty('message', rejectedDateMessage);
    expect(consumer).not.toHaveBeenCalled();
    expect(sessionProvider).not.toHaveBeenCalled();
  }

  function accessorArgsSchema(reads: { value: number }): Schema<{ id: string }> {
    return {
      parse() {
        const output = {} as { id: string };
        Object.defineProperty(output, 'id', {
          enumerable: true,
          get() {
            reads.value += 1;
            return 'owned';
          },
        });
        return output;
      },
    };
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

  it('prevents a borrowed Date mutator from changing the accepted query final consumer', async () => {
    const load = vi.fn((input: DateArgs) => input.authorized.toISOString());
    const sessionProvider = vi.fn(async () => ({ user: { id: 'owner' } }));
    const definition = query('security/guard-args-query-date-receipt', {
      args: s.object({ authorized: s.datetime(), selected: s.datetime() }),
      guard: dateOwnershipThenRemoteSelection(),
      load,
      reads: [],
    });

    await expectBorrowedDateMutationClosed(
      runQuery(
        definition,
        { authorized: authorizedDate, selected: selectedDate },
        {},
        { sessionProvider },
      ),
      load,
      sessionProvider,
    );
  });

  it('prevents a borrowed Date mutator from changing the accepted mutation final consumer', async () => {
    const handler = vi.fn((input: DateArgs) => input.authorized.toISOString());
    const sessionProvider = vi.fn(async () => ({ user: { id: 'owner' } }));
    const definition = mutation('security/guard-args-mutation-date-receipt', {
      guard: dateOwnershipThenRemoteSelection(),
      handler,
      input: s.object({ authorized: s.datetime(), selected: s.datetime() }),
    });

    await expectBorrowedDateMutationClosed(
      runMutation(
        definition,
        { authorized: authorizedDate, selected: selectedDate },
        {},
        { sessionProvider },
      ),
      handler,
      sessionProvider,
    );
  });

  it('rejects query schema accessors without invoking them', async () => {
    const reads = { value: 0 };
    const load = vi.fn(() => 'unreachable');
    const definition = query('security/guard-args-query-accessor', {
      args: accessorArgsSchema(reads),
      guard: ownershipGuard(),
      load,
      reads: [],
    });

    await expect(runQuery(definition, {}, { session: { user: { id: 'owner' } } })).rejects.toThrow(
      /cannot contain accessors/u,
    );
    expect(reads.value).toBe(0);
    expect(load).not.toHaveBeenCalled();
  });

  it('rejects mutation schema accessors without invoking them', async () => {
    const reads = { value: 0 };
    const handler = vi.fn(() => 'unreachable');
    const definition = mutation('security/guard-args-mutation-accessor', {
      guard: ownershipGuard(),
      handler,
      input: accessorArgsSchema(reads),
    });

    await expect(
      runMutation(definition, {}, { session: { user: { id: 'owner' } } }),
    ).rejects.toThrow(/cannot contain accessors/u);
    expect(reads.value).toBe(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects schema outputs whose own data descriptor identity changes during receipt', async () => {
    let descriptorReads = 0;
    const schema: Schema<{ id: string }> = {
      parse() {
        return new Proxy(
          { id: 'owned' },
          {
            getOwnPropertyDescriptor(_target, property) {
              if (property !== 'id') return Reflect.getOwnPropertyDescriptor(_target, property);
              descriptorReads += 1;
              return {
                configurable: true,
                enumerable: true,
                value: descriptorReads === 1 ? 'owned' : 'victim',
                writable: true,
              };
            },
          },
        );
      },
    };
    const definition = query('security/guard-args-query-descriptor-drift', {
      args: schema,
      guard: ownershipGuard(),
      load: () => 'unreachable',
      reads: [],
    });

    await expect(runQuery(definition, {}, { session: { user: { id: 'owner' } } })).rejects.toThrow(
      /stable own data descriptors/u,
    );
  });

  it('keeps query args immutable after ownership authorization and before the loader', async () => {
    const raw = { id: 'owned' };
    const definition = query('security/guard-args-query-order', {
      args: s.object({ id: s.string() }),
      guard: ownershipThenMutationAttempt(),
      load(input: { id: string }, { request }: { request: AppRequest }): string {
        raw.id = 'victim';
        expect((request as ArgsRequest).args.id).toBe('owned');
        return input.id;
      },
      reads: [],
    });

    await expect(
      runQuery(definition, raw, { session: { user: { id: 'owner' } } }),
    ).resolves.toMatchObject({ ok: true, value: 'owned' });
  });

  it('keeps mutation args immutable after ownership authorization and before the handler', async () => {
    const raw = { id: 'owned' };
    const handler = vi.fn((input: { id: string }, request: AppRequest) => {
      raw.id = 'victim';
      expect((request as ArgsRequest).args.id).toBe('owned');
      return input.id;
    });
    const definition = mutation('security/guard-args-mutation-order', {
      guard: ownershipThenMutationAttempt(),
      handler,
      input: s.object({ id: s.string() }),
    });

    await expect(
      runMutation(definition, raw, { session: { user: { id: 'owner' } } }),
    ).resolves.toMatchObject({ ok: true, value: 'owned' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('layers query args after async providers without retaining provider or raw-input sources', async () => {
    const providerSession = { user: { id: 'owner' } };
    const raw = { id: 'owned' };
    const definition = query('security/guard-args-query-provider-order', {
      args: s.object({ id: s.string() }),
      guard: ownershipGuard(),
      async load(input: { id: string }, { request }: { request: AppRequest }): Promise<string> {
        providerSession.user.id = 'attacker';
        raw.id = 'victim';
        await Promise.resolve();
        expect(request.session?.user?.id).toBe('owner');
        expect((request as ArgsRequest).args.id).toBe('owned');
        return input.id;
      },
      reads: [],
    });

    await expect(
      runQuery(definition, raw, {}, { sessionProvider: async () => providerSession }),
    ).resolves.toMatchObject({ ok: true, value: 'owned' });
  });

  it('layers mutation args after async providers and preserves nested and file semantics', async () => {
    const providerSession = { user: { id: 'owner' } };
    const fileBytes = new TextEncoder().encode('safe').buffer;
    const raw = {
      attachment: {
        arrayBuffer: async () => fileBytes,
        name: 'proof.txt',
        size: 4,
        type: 'text/plain',
      },
      id: 'owned',
      nested: [{ label: 'kept' }],
    };
    const definition = mutation('security/guard-args-mutation-provider-order', {
      guard: ownershipGuard(),
      async handler(input, request) {
        providerSession.user.id = 'attacker';
        raw.id = 'victim';
        raw.nested[0]!.label = 'changed';
        raw.attachment.name = 'victim.txt';
        new Uint8Array(fileBytes)[0] = 'x'.charCodeAt(0);
        await Promise.resolve();
        const requestArgs = (request as GuardArgsRequest<AppRequest, typeof input>).args;
        expect(request.session?.user?.id).toBe('owner');
        expect(requestArgs.id).toBe('owned');
        expect(requestArgs.nested[0]?.label).toBe('kept');
        const receivedBytes = await input.attachment.arrayBuffer();
        return {
          bytes: receivedBytes.byteLength,
          contents: new TextDecoder().decode(receivedBytes),
          id: input.id,
          label: input.nested[0]?.label,
          name: input.attachment.name,
        };
      },
      input: s.object({
        attachment: s.file(),
        id: s.string(),
        nested: s.array(s.object({ label: s.string() })),
      }),
    });

    await expect(
      runMutation(definition, raw, {}, { sessionProvider: async () => providerSession }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        bytes: 4,
        contents: 'safe',
        id: 'owned',
        label: 'kept',
        name: 'proof.txt',
      },
    });
  });

  it('accepts an async custom schema only after reconstructing its completed plain result', async () => {
    const schema: Schema<{ id: string }> & {
      parseAsync(input: unknown): Promise<{ id: string }>;
    } = {
      parse(input) {
        return s.object({ id: s.string() }).parse(input);
      },
      async parseAsync(input) {
        await Promise.resolve();
        return this.parse(input);
      },
    };
    const definition = mutation('security/guard-args-mutation-async-schema', {
      guard: ownershipGuard(),
      handler: async (input) => {
        await Promise.resolve();
        return input.id;
      },
      input: schema,
    });

    await expect(
      runMutation(definition, { id: 'owned' }, { session: { user: { id: 'owner' } } }),
    ).resolves.toMatchObject({ ok: true, value: 'owned' });
  });
});
