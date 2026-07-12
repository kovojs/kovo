import { describe, expect, it } from 'vitest';
import type { Secret } from '@kovojs/core';
import { stampTrustedSql } from '@kovojs/core/internal/sql-safety';
import { createMemoryStorage } from '@kovojs/core/internal/storage';

import { invalidate } from './change-record.js';
import { csrfToken } from './csrf.js';
import { domain, tag } from './domain.js';
import { guards } from './guards.js';
import { assignDerivedMutationKey } from './internal/wire.js';
import {
  mutation as defineMutation,
  mutationFormAttributes,
  queue,
  renderMutationFormAttributes,
  renderMutationResponse,
  renderNoJsMutationResponse,
  runMutation,
} from './mutation.js';
import { query } from './query.js';
import { s, type Schema } from './schema.js';
import { task, type TaskSchedulingRequest } from './task.js';
import { testMutation as mutation } from './test-fixtures.js';

declare module '@kovojs/core' {
  interface InvalidationSets {
    'contacts/add': 'activityList' | 'contactList';
  }

  interface OptimisticDerivationSets {
    'contacts/add': 'activityList';
  }

  interface QueryRegistry {
    activityList: {
      items: Array<{ id: string; message: string }>;
    };
    contactList: {
      items: Array<{ id: string; name: string }>;
    };
  }
}

function protectedMutationFixture<Input extends Record<string, unknown>>(
  key: string,
  input: Input,
): {
  csrf: {
    secret: string;
    sessionId(request: { sessionId: string }): string;
  };
  rawInput: Input & { 'kovo-csrf': string };
  request: { sessionId: string };
} {
  const request = { sessionId: 'protected-mutation-test-session' };
  const csrf = {
    secret: 'protected-mutation-test-secret-0123456789abcdef',
    sessionId(value: typeof request) {
      return value.sessionId;
    },
  };
  return {
    csrf,
    rawInput: { ...input, 'kovo-csrf': csrfToken(request, csrf, { mutation: key }) },
    request,
  };
}

describe('server mutation lifecycle', () => {
  function createTransactionalListDb() {
    const state = {
      commits: 0,
      rollbacks: 0,
      rows: [] as string[],
    };

    const handle = (rows: string[]) => ({
      get commits() {
        return state.commits;
      },
      insert(id: string) {
        rows.push(id);
      },
      get rollbacks() {
        return state.rollbacks;
      },
      get rows() {
        return rows;
      },
      async transaction<Result>(callback: (tx: ReturnType<typeof handle>) => Promise<Result>) {
        const transactionRows = [...state.rows];
        try {
          const result = await callback(handle(transactionRows));
          state.rows.splice(0, state.rows.length, ...transactionRows);
          state.commits += 1;
          return result;
        } catch (error) {
          state.rollbacks += 1;
          throw error;
        }
      },
    });

    return handle(state.rows);
  }

  function createBetterSqliteStyleListDb() {
    const state = {
      commits: 0,
      nativeTransactionCalls: 0,
      rollbacks: 0,
      rows: [] as string[],
      transactionRows: undefined as string[] | undefined,
    };

    const insert = (id: string) => {
      (state.transactionRows ?? state.rows).push(id);
    };

    const client = {
      exec(statement: string) {
        if (statement === 'BEGIN') {
          if (state.transactionRows !== undefined) throw new Error('nested begin');
          state.transactionRows = [...state.rows];
          return;
        }
        if (statement === 'COMMIT') {
          if (state.transactionRows === undefined) throw new Error('commit without transaction');
          state.rows.splice(0, state.rows.length, ...state.transactionRows);
          state.transactionRows = undefined;
          state.commits += 1;
          return;
        }
        if (statement === 'ROLLBACK') {
          if (state.transactionRows === undefined) throw new Error('rollback without transaction');
          state.transactionRows = undefined;
          state.rollbacks += 1;
          return;
        }
        throw new Error(`unexpected SQLite transaction control: ${statement}`);
      },
      get inTransaction() {
        return state.transactionRows !== undefined;
      },
      prepare() {
        return {};
      },
      transaction<Result>(callback: (tx: { insert(id: string): void }) => Result): Result {
        state.nativeTransactionCalls += 1;
        const transactionRows = [...state.rows];
        try {
          const result = callback({ insert: (id) => transactionRows.push(id) });
          if (result && typeof (result as { then?: unknown }).then === 'function') {
            throw new TypeError('Transaction function cannot return a promise');
          }
          state.rows.splice(0, state.rows.length, ...transactionRows);
          state.commits += 1;
          return result;
        } catch (error) {
          state.rollbacks += 1;
          throw error;
        }
      },
    };

    return {
      $client: client,
      get commits() {
        return state.commits;
      },
      insert,
      get nativeTransactionCalls() {
        return state.nativeTransactionCalls;
      },
      get rollbacks() {
        return state.rollbacks;
      },
      get rows() {
        return state.rows;
      },
      transaction: client.transaction,
    };
  }

  function createTransactionalTaskDb() {
    const state = {
      commits: 0,
      jobs: [] as Array<{ args: unknown; task: string }>,
      rollbacks: 0,
      rows: [] as string[],
    };

    const handle = (
      rows: string[],
      jobs: Array<{ args: unknown; task: string }>,
      transactionScoped: boolean,
    ) => ({
      enqueueJob(job: { args: unknown; task: string }) {
        jobs.push(job);
      },
      get commits() {
        return state.commits;
      },
      insert(id: string) {
        rows.push(id);
      },
      get jobs() {
        return jobs;
      },
      get rollbacks() {
        return state.rollbacks;
      },
      get rows() {
        return rows;
      },
      get transactionScoped() {
        return transactionScoped;
      },
      async transaction<Result>(callback: (tx: ReturnType<typeof handle>) => Promise<Result>) {
        const transactionRows = [...state.rows];
        const transactionJobs = [...state.jobs];
        try {
          const result = await callback(handle(transactionRows, transactionJobs, true));
          state.rows.splice(0, state.rows.length, ...transactionRows);
          state.jobs.splice(0, state.jobs.length, ...transactionJobs);
          state.commits += 1;
          return result;
        } catch (error) {
          state.rollbacks += 1;
          throw error;
        }
      },
    });

    return handle(state.rows, state.jobs, false);
  }

  it('types inline optimistic transforms from mutation key and input schema', () => {
    const addContact = mutation('contacts/add', {
      input: s.object({ id: s.string(), name: s.string() }),
      queue: 'crm',
      optimistic: {
        contactList(draft, input) {
          draft.items.push({ id: input.id, name: input.name });
          // @ts-expect-error input is inferred from the sibling input schema.
          draft.items.push({ id: input.missing, name: input.name });
        },
      },
      handler() {
        return 'ok';
      },
    });
    const assertUnknownOptimisticKeyRejected = () => {
      mutation('contacts/add', {
        input: s.object({ id: s.string(), name: s.string() }),
        optimistic: {
          // @ts-expect-error unknownQuery is not invalidated by contacts/add.
          unknownQuery(_draft, _input) {},
        },
        handler() {
          return 'ok';
        },
      });
    };
    const assertMissingNonDerivableKeyRejected = () => {
      mutation('contacts/add', {
        input: s.object({ id: s.string(), name: s.string() }),
        // @ts-expect-error contactList is not compiler-derivable and needs a transform or await-fragment.
        optimistic: {
          activityList(_draft, _input) {},
        },
        handler() {
          return 'ok';
        },
      });
    };

    expect(addContact.queue).toBe('crm');
    expect(Object.keys(addContact.optimistic ?? {})).toEqual(['contactList']);
    expect(assertUnknownOptimisticKeyRejected).toBeTypeOf('function');
    expect(assertMissingNonDerivableKeyRejected).toBeTypeOf('function');
  });

  it('uses the mutation key for per-mutation queue shorthand', () => {
    const addContact = mutation('contacts/add', {
      input: s.object({ id: s.string(), name: s.string() }),
      queue: true,
      handler() {
        return 'ok';
      },
    });

    expect(addContact.queue).toBe('contacts/add');
  });

  it('normalizes first-class shared queue values without using them as registry identities', () => {
    const crmQueue = queue('crm');
    const addContact = mutation('contacts/add', {
      input: s.object({ id: s.string(), name: s.string() }),
      queue: crmQueue,
      handler() {
        return 'ok';
      },
    });
    const mergeContact = mutation('contacts/merge', {
      input: s.object({ id: s.string() }),
      queue: crmQueue,
      handler() {
        return 'ok';
      },
    });

    expect(crmQueue.name).toBe('crm');
    expect(addContact.key).toBe('contacts/add');
    expect(mergeContact.key).toBe('contacts/merge');
    expect(addContact.queue).toBe('crm');
    expect(mergeContact.queue).toBe('crm');
  });

  it('rejects empty first-class queue names', () => {
    expect(() => queue('')).toThrow('queue(name) requires a non-empty queue name.');
  });

  it('derives direct-render form attributes from typed mutation values', () => {
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    expect(mutationFormAttributes(addToCart)).toEqual({
      action: '/_m/cart/add',
      'data-mutation': 'cart/add',
      enhance: true,
      method: 'post',
      mutation: addToCart,
    });
    expect(renderMutationFormAttributes(addToCart)).toBe(
      'method="post" action="/_m/cart/add" enhance data-mutation="cart/add"',
    );
  });

  it('uses compiler-derived keys on object-form mutation values', () => {
    const addToCart = assignDerivedMutationKey(
      defineMutation({
        csrf: false,
        input: s.object({ productId: s.string() }),
        queue: true,
        handler() {
          return 'ok';
        },
      }),
      'components/cart/add-to-cart',
    );

    expect(addToCart.queue).toBe('components/cart/add-to-cart');
    expect(mutationFormAttributes(addToCart)).toMatchObject({
      action: '/_m/components/cart/add-to-cart',
      'data-mutation': 'components/cart/add-to-cart',
      mutation: addToCart,
    });
    expect(renderMutationFormAttributes(addToCart)).toContain(
      'action="/_m/components/cart/add-to-cart"',
    );
  });

  it('rejects conflicting compiler-derived mutation keys', () => {
    const addToCart = defineMutation({
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    assignDerivedMutationKey(addToCart, 'components/cart/add-to-cart');

    expect(() => assignDerivedMutationKey(addToCart, 'components/cart/other-add-to-cart')).toThrow(
      'Cannot assign derived mutation key "components/cart/other-add-to-cart" to mutation already keyed as "components/cart/add-to-cart".',
    );
  });

  it('fails closed when object-form mutation values are used before compiler key derivation', () => {
    const addToCart = defineMutation({
      csrf: false,
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    expect(() => mutationFormAttributes(addToCart)).toThrow(/compiler derives one/);
  });

  it('derives multipart form attributes for file-upload mutations', () => {
    const uploadAvatar = mutation('avatar/upload', {
      input: s.object({ avatar: s.file(), caption: s.string().optional() }),
      handler() {
        return 'ok';
      },
    });
    const uploadReceipt = mutation('order/receipt', {
      input: s.object({
        receipt: s.file().store({ keyPrefix: 'receipts', storage: createMemoryStorage() }),
      }),
      handler() {
        return 'ok';
      },
    });

    expect(uploadAvatar).toMatchObject({
      enctype: 'multipart/form-data',
      fileFields: ['avatar'],
    });
    expect(mutationFormAttributes(uploadAvatar)).toMatchObject({
      enctype: 'multipart/form-data',
    });
    expect(renderMutationFormAttributes(uploadAvatar)).toContain('enctype="multipart/form-data"');
    expect(uploadReceipt.fileFields).toEqual(['receipt']);
    expect(mutationFormAttributes(uploadReceipt).enctype).toBe('multipart/form-data');
  });

  it('returns typed validation failures from ctx.fail', async () => {
    const addToCart = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({
        productId: s.string(),
        quantity: s.number().int().min(1).default(1),
      }),
      handler(_input, _request, context) {
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1', quantity: 9 }, {})).resolves.toEqual({
      error: {
        code: 'OUT_OF_STOCK',
        payload: { availableQuantity: 0 },
      },
      ok: false,
      status: 422,
    });
  });

  it('bounds typed fail payloads to JSON-serializable values', () => {
    const dateSchema: Schema<Date> = {
      parse() {
        return new Date();
      },
    };
    const assertNonJsonFailPayloadRejected = () => {
      mutation('cart/date-fail', {
        errors: {
          BAD_DATE: dateSchema,
        },
        input: s.object({ productId: s.string() }),
        handler(_input, _request, context) {
          // @ts-expect-error SPEC §9.2 fail() payloads are JsonValue-bound client wire payloads.
          return context.fail('BAD_DATE', new Date());
        },
      });
      mutation('cart/secret-fail', {
        errors: {
          BAD_SECRET: s.secret(s.string()),
        },
        input: s.object({ productId: s.string() }),
        handler(_input, _request, context) {
          // @ts-expect-error SPEC §9.2 secret values cannot enter fail() payloads.
          return context.fail('BAD_SECRET', 'hash-1' as unknown as Secret<string>);
        },
      });
    };

    expect(assertNonJsonFailPayloadRejected).toBeTypeOf('function');
  });

  it('composes guards with all()', async () => {
    const guarded = mutation('cart/add', {
      guard: guards.all<{ authed: boolean }>((request) => request.authed),
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(runMutation(guarded, { productId: 'p1' }, { authed: false })).resolves.toEqual({
      error: { code: 'UNAUTHORIZED', payload: {} },
      ok: false,
      status: 422,
    });
  });

  it('parses mutation input before running guards', async () => {
    let guardCalls = 0;
    const guarded = mutation('cart/add', {
      guard() {
        guardCalls += 1;
        return false;
      },
      input: s.object({ productId: s.string() }),
      handler() {
        return 'ok';
      },
    });

    await expect(runMutation(guarded, {}, {})).resolves.toEqual({
      error: {
        code: 'VALIDATION',
        payload: { issues: [{ message: 'Expected string', path: ['productId'] }] },
      },
      ok: false,
      status: 422,
    });
    expect(guardCalls).toBe(0);
  });

  it('runs guarded mutation handlers inside the configured transaction', async () => {
    const events: string[] = [];
    const transactional = mutation('cart/add', {
      guard() {
        events.push('guard');
        return true;
      },
      input: s.object({ productId: s.string() }),
      async transaction(request: { tx?: boolean }, run) {
        events.push('begin');
        const value = await run({ ...request, tx: true });
        events.push('commit');
        return value;
      },
      handler(input, request: { tx?: boolean }) {
        events.push(`handler:${request.tx === true ? 'tx' : 'plain'}`);
        return input.productId;
      },
    });

    await expect(
      runMutation(
        transactional,
        { productId: 'p1' },
        {
          db: {
            transaction() {
              events.push('default-transaction');
              throw new Error('explicit transaction should win');
            },
          },
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: 'p1',
    });
    expect(events).toEqual(['guard', 'begin', 'handler:tx', 'commit']);
  });

  it('rolls back default framework transactions when handlers throw after writing', async () => {
    const db = createTransactionalListDb();
    const addContact = mutation('contacts/add', {
      input: s.object({ id: s.string() }),
      handler(input, request: { db: ReturnType<typeof createTransactionalListDb> }) {
        request.db.insert(input.id);
        throw new Error('boom');
      },
    });

    await expect(runMutation(addContact, { id: 'partial-A' }, { db })).rejects.toThrow('boom');
    expect(db.rows).toEqual([]);
    expect(db.commits).toBe(0);
    expect(db.rollbacks).toBe(1);
  });

  it('runs async default mutation handlers on better-sqlite3-style transaction adapters', async () => {
    const db = createBetterSqliteStyleListDb();
    const addContact = mutation('contacts/sqlite-add', {
      input: s.object({ id: s.string() }),
      async handler(input, request: { db: ReturnType<typeof createBetterSqliteStyleListDb> }) {
        request.db.insert(input.id);
        await Promise.resolve();
        return input.id;
      },
    });

    await expect(
      runMutation(addContact, { id: 'async-sqlite-A' }, {}, { db: () => db }),
    ).resolves.toMatchObject({
      ok: true,
      value: 'async-sqlite-A',
    });
    expect(db.rows).toEqual(['async-sqlite-A']);
    expect(db.commits).toBe(1);
    expect(db.rollbacks).toBe(0);
    expect(db.nativeTransactionCalls).toBe(0);
  });

  it('rolls back better-sqlite3-style default transactions when async handlers throw', async () => {
    const db = createBetterSqliteStyleListDb();
    const addContact = mutation('contacts/sqlite-rollback', {
      input: s.object({ id: s.string() }),
      async handler(input, request: { db: ReturnType<typeof createBetterSqliteStyleListDb> }) {
        request.db.insert(input.id);
        await Promise.resolve();
        throw new Error('boom');
      },
    });

    await expect(
      runMutation(addContact, { id: 'partial-sqlite-A' }, {}, { db: () => db }),
    ).rejects.toThrow('boom');
    expect(db.rows).toEqual([]);
    expect(db.commits).toBe(0);
    expect(db.rollbacks).toBe(1);
    expect(db.nativeTransactionCalls).toBe(0);
  });

  it('schedules durable tasks through the transaction-scoped mutation request', async () => {
    const db = createTransactionalTaskDb();
    const sendReceipt = task('receipt/send', {
      input: s.object({ orderId: s.string() }),
      run() {
        return 'sent';
      },
    });
    const schedulerRequests: boolean[] = [];
    const checkout = mutation('checkout/complete', {
      input: s.object({ orderId: s.string() }),
      async handler(
        input,
        request: { db: ReturnType<typeof createTransactionalTaskDb> } & TaskSchedulingRequest,
      ) {
        request.db.insert(input.orderId);
        const handle = await request.schedule(sendReceipt, { orderId: input.orderId });
        const typedTask: 'receipt/send' = handle.task;
        return typedTask;
      },
    });

    await expect(
      runMutation(
        checkout,
        { orderId: 'o1' },
        { db },
        {
          taskScheduler: {
            registeredTasks: [sendReceipt],
            schedule(request, input) {
              const db = (request as { db: ReturnType<typeof createTransactionalTaskDb> }).db;
              schedulerRequests.push(db.transactionScoped);
              db.enqueueJob({ args: input.args, task: input.task });
              return { id: 'job-1', task: input.task };
            },
            cancel() {
              return false;
            },
          },
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: 'receipt/send',
    });
    expect(schedulerRequests).toEqual([true]);
    expect(db.rows).toEqual(['o1']);
    expect(db.jobs).toEqual([{ args: { orderId: 'o1' }, task: 'receipt/send' }]);
    expect(db.commits).toBe(1);
    expect(db.rollbacks).toBe(0);
  });

  it('keeps the guard-accepted body bound through lifecycle request wrappers', async () => {
    const acceptedBody = 'SIGNED-SAFE';
    const substitutedBody = 'DANGEROUS-SUBSTITUTE';
    const request = new Request('https://example.test/mutate', {
      body: acceptedBody,
      method: 'POST',
    });
    const nativeBind = Function.prototype.bind;
    const nativeText = Request.prototype.text;
    const guarded = mutation('security/body-carrier-binding', {
      guard: async (guardRequest: Request) =>
        (await guardRequest.clone().text()) === acceptedBody,
      input: s.object({}),
      handler: async (_input, handlerRequest: Request) => handlerRequest.text(),
    });

    try {
      await expect(
        runMutation(guarded, {}, request, {
          sessionProvider() {
            Function.prototype.bind = function (thisArg: unknown, ...args: unknown[]) {
              if (this === nativeText) return () => Promise.resolve(substitutedBody);
              return Reflect.apply(nativeBind, this, [thisArg, ...args]);
            };
            return null;
          },
        }),
      ).resolves.toMatchObject({ ok: true, value: acceptedBody });
    } finally {
      Function.prototype.bind = nativeBind;
    }
  });

  it('keeps principal, task, and transaction carriers on one pinned session snapshot', async () => {
    const victimSession = { user: { id: 'victim', roles: ['member'] } };
    const attackerSession = { user: { id: 'attacker', roles: ['admin'] } };
    const followup = task('security/carrier-followup', {
      input: s.object({ id: s.string() }),
      run() {
        return 'done';
      },
    });
    const db = {
      async transaction<Result>(callback: (tx: { marker: string }) => Promise<Result>) {
        victimSession.user.id = 'attacker';
        victimSession.user.roles = ['admin'];
        return callback({ marker: 'transaction' });
      },
    };
    const schedulerSessions: string[] = [];
    const guarded = mutation('security/session-carrier-binding', {
      guard: guards.role('member'),
      input: s.object({}),
      async handler(_input, request) {
        const handle = await request.schedule(followup, { id: request.session.user.id });
        return `${request.session.user.id}:${request.db.marker}:${handle.task}`;
      },
    });
    const nativeReflectGet = Reflect.get;
    let sessionCarrier: object | undefined;

    try {
      await expect(
        runMutation(guarded, {}, {}, {
          db(request) {
            sessionCarrier = request as object;
            Reflect.get = function (
              target: object,
              propertyKey: PropertyKey,
              receiver?: unknown,
            ): unknown {
              if (target === sessionCarrier && propertyKey === 'session') return attackerSession;
              return nativeReflectGet(target, propertyKey, receiver);
            };
            return db;
          },
          sessionProvider: () => victimSession,
          taskScheduler: {
            cancel() {
              return false;
            },
            registeredTasks: [followup],
            schedule(request, input) {
              schedulerSessions.push(
                (request as { session: typeof victimSession }).session.user.id,
              );
              return { id: 'job-1', task: input.task };
            },
          },
        }),
      ).resolves.toMatchObject({
        ok: true,
        value: 'victim:transaction:security/carrier-followup',
      });
    } finally {
      Reflect.get = nativeReflectGet;
    }
    expect(schedulerSessions).toEqual(['victim']);
    expect(victimSession).toEqual({ user: { id: 'attacker', roles: ['admin'] } });
  });

  it('validates durable task args before scheduling from a mutation handler', async () => {
    const sendReceipt = task('receipt/send-invalid', {
      input: s.object({ orderId: s.string() }),
      run() {
        return 'sent';
      },
    });
    const calls: unknown[] = [];
    const checkout = mutation('checkout/invalid-task', {
      input: s.object({ orderId: s.string() }),
      async handler(input, request) {
        return request.schedule(sendReceipt, { orderId: input.orderId.length });
      },
    });

    await expect(
      runMutation(
        checkout,
        { orderId: 'o1' },
        {},
        {
          taskScheduler: {
            registeredTasks: [sendReceipt],
            schedule(_request, input) {
              calls.push(input);
              return { id: 'job-1', task: 'receipt/send-invalid' };
            },
            cancel() {
              return false;
            },
          },
        },
      ),
    ).rejects.toThrow('Expected string');
    expect(calls).toEqual([]);
  });

  it('rolls back transaction-local durable task writes when the mutation handler throws', async () => {
    const db = createTransactionalTaskDb();
    const sendReceipt = task('receipt/rollback', {
      input: s.object({ orderId: s.string() }),
      run() {
        return 'sent';
      },
    });
    const checkout = mutation('checkout/rollback-task', {
      input: s.object({ orderId: s.string() }),
      async handler(
        input,
        request: { db: ReturnType<typeof createTransactionalTaskDb> } & TaskSchedulingRequest,
      ) {
        request.db.insert(input.orderId);
        await request.schedule(sendReceipt, { orderId: input.orderId });
        throw new Error('boom');
      },
    });

    await expect(
      runMutation(
        checkout,
        { orderId: 'o1' },
        { db },
        {
          taskScheduler: {
            registeredTasks: [sendReceipt],
            schedule(request, input) {
              (request as { db: ReturnType<typeof createTransactionalTaskDb> }).db.enqueueJob({
                args: input.args,
                task: input.task,
              });
              return { id: 'job-1', task: input.task };
            },
            cancel() {
              return false;
            },
          },
        },
      ),
    ).rejects.toThrow('boom');
    expect(db.rows).toEqual([]);
    expect(db.jobs).toEqual([]);
    expect(db.commits).toBe(0);
    expect(db.rollbacks).toBe(1);
  });

  it('fails loudly when a direct mutation caller schedules without a task scheduler', async () => {
    const sendReceipt = task('receipt/no-scheduler', {
      input: s.object({ orderId: s.string() }),
      run() {
        return 'sent';
      },
    });
    const checkout = mutation('checkout/no-scheduler', {
      input: s.object({ orderId: s.string() }),
      handler(input, request) {
        return request.schedule(sendReceipt, { orderId: input.orderId });
      },
    });

    await expect(runMutation(checkout, { orderId: 'o1' }, {})).rejects.toThrow(
      'request.schedule(task, args) requires a durable task scheduler',
    );
  });

  it('delegates durable task cancellation to the mutation task scheduler', async () => {
    const handle = { id: 'job-1', task: 'receipt/cancel' };
    const calls: unknown[] = [];
    const cancelReceipt = mutation('checkout/cancel-receipt', {
      input: s.object({}),
      handler(_input, request) {
        return request.cancel(handle);
      },
    });

    await expect(
      runMutation(
        cancelReceipt,
        {},
        { marker: 'request-1' },
        {
          taskScheduler: {
            registeredTasks: [],
            schedule() {
              throw new Error('not used');
            },
            cancel(request, taskHandle) {
              calls.push({ marker: (request as { marker: string }).marker, taskHandle });
              return true;
            },
          },
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: true,
    });
    expect(calls).toEqual([{ marker: 'request-1', taskHandle: handle }]);
  });

  it('types transaction callbacks with the mutation request shape', async () => {
    interface TxRequest {
      db: {
        txOnly(): void;
        write(table: string): void;
      };
    }

    const events: string[] = [];
    const typeOnly = undefined as unknown as boolean;
    const transactional = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      transaction(request: TxRequest, run) {
        request.db.txOnly();
        if (typeOnly) {
          // @ts-expect-error transaction callbacks must receive the typed request shape.
          void run({ db: { write() {} } });
        }
        return run(request);
      },
      handler(input, request: TxRequest) {
        request.db.txOnly();
        request.db.write('cart_items');
        return input.productId;
      },
    });

    await expect(
      runMutation(
        transactional,
        { productId: 'p1' },
        {
          db: {
            txOnly() {
              events.push('tx');
            },
            write(table) {
              events.push(`write:${table}`);
            },
          },
        },
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: 'p1',
    });
    expect(events).toEqual(['tx', 'tx', 'write:cart_items']);
  });

  it('rolls back configured transactions for typed mutation failures', async () => {
    const events: string[] = [];
    const transactional = mutation('cart/add', {
      errors: {
        OUT_OF_STOCK: s.object({ availableQuantity: s.number().int().min(0) }),
      },
      input: s.object({ productId: s.string() }),
      async transaction(request: {}, run) {
        events.push('begin');
        try {
          return await run(request);
        } catch (error) {
          events.push('rollback');
          throw error;
        }
      },
      handler(_input, _request, context) {
        events.push('handler');
        return context.fail('OUT_OF_STOCK', { availableQuantity: 0 });
      },
    });

    await expect(runMutation(transactional, { productId: 'p1' }, {})).resolves.toEqual({
      error: {
        code: 'OUT_OF_STOCK',
        payload: { availableQuantity: 0 },
      },
      ok: false,
      status: 422,
    });
    expect(events).toEqual(['begin', 'handler', 'rollback']);
  });

  it('forwards committed mutation Set-Cookie headers in enhanced responses', async () => {
    // B3: raw single-string overload removed; use typed (name, value, options) builder.
    const protectedRequest = protectedMutationFixture('auth/sign-in', {
      email: 'ada@example.test',
    });
    const signIn = defineMutation('auth/sign-in', {
      csrf: protectedRequest.csrf,
      input: s.object({ email: s.string() }),
      handler(input, _request, context) {
        context.setCookie?.('kovo_session', 's1', {
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
        });
        context.setCookie?.('kovo_csrf', 'c1', {
          httpOnly: true,
          path: '/',
          sameSite: 'strict',
          secure: true,
        });

        return input.email;
      },
    });

    await expect(
      renderMutationResponse(signIn, {
        buildToken: 'mutation-test-build',
        rawInput: protectedRequest.rawInput,
        request: protectedRequest.request,
      }),
    ).resolves.toEqual({
      body: '',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        'Kovo-Changes': '[]',
        'Kovo-Build': 'mutation-test-build',
        'Kovo-Session-Transition': 'reload',
        'Set-Cookie': [
          'kovo_session=s1; Path=/; HttpOnly; SameSite=Lax',
          '__Host-kovo_csrf=c1; Path=/; HttpOnly; Secure; SameSite=Strict',
        ],
        Vary: 'Cookie',
      },
      status: 200,
    });
  });

  it('forwards committed mutation Set-Cookie headers in no-JS PRG responses', async () => {
    // B3: raw single-string overload removed; use typed (name, value, options) builder.
    const protectedRequest = protectedMutationFixture('auth/sign-out', {});
    const signOut = defineMutation('auth/sign-out', {
      csrf: protectedRequest.csrf,
      input: s.object({}),
      handler(_input, _request, context) {
        context.setCookie?.('kovo_session', '', {
          httpOnly: true,
          maxAge: 0,
          path: '/',
        });
        return 'signed-out';
      },
    });

    await expect(
      renderNoJsMutationResponse(signOut, {
        rawInput: protectedRequest.rawInput,
        redirectTo: '/login',
        request: protectedRequest.request,
      }),
    ).resolves.toEqual({
      body: '',
      headers: {
        'Cache-Control': 'no-store',
        Location: '/login',
        'Set-Cookie': ['kovo_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'],
      },
      status: 303,
    });
  });

  it('does not leak mutation Set-Cookie headers when the handler returns a typed failure', async () => {
    // B3: raw single-string overload removed; use typed (name, value, options) builder.
    const protectedRequest = protectedMutationFixture('auth/sign-in', {
      email: 'ada@example.test',
    });
    const signIn = defineMutation('auth/sign-in', {
      csrf: protectedRequest.csrf,
      errors: {
        INVALID_CREDENTIALS: s.object({}),
      },
      input: s.object({ email: s.string() }),
      handler(_input, _request, context) {
        context.setCookie?.('kovo_session', 's1', { httpOnly: true, path: '/' });
        return context.fail('INVALID_CREDENTIALS', {});
      },
    });

    await expect(
      renderMutationResponse(signIn, {
        rawInput: protectedRequest.rawInput,
        request: protectedRequest.request,
      }),
    ).resolves.toEqual({
      body: '<kovo-fragment target="error"><output role="alert" data-error-code="INVALID_CREDENTIALS">{}</output></kovo-fragment>',
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'text/vnd.kovo.fragment+html; charset=utf-8',
        Vary: 'Cookie',
      },
      status: 422,
    });
  });

  // B3 (SPEC §9.1.1:846): the raw single-string setCookie overload is removed;
  // only the typed (name, value, options) builder is exposed.
  it('B3: setCookie typed builder sets cookies correctly via (name, value, options)', async () => {
    const protectedRequest = protectedMutationFixture('auth/sign-in', {
      email: 'ada@example.test',
    });
    const signIn = defineMutation('auth/sign-in', {
      csrf: protectedRequest.csrf,
      input: s.object({ email: s.string() }),
      handler(input, _request, context) {
        context.setCookie?.('kovo_session', 's1', { httpOnly: true, path: '/', sameSite: 'lax' });
        return input.email;
      },
    });

    const result = await renderMutationResponse(signIn, {
      buildToken: 'mutation-test-build',
      rawInput: protectedRequest.rawInput,
      request: protectedRequest.request,
    });
    // Typed builder correctly serializes the cookie.
    const setCookieHeader = Array.isArray(result.headers['Set-Cookie'])
      ? result.headers['Set-Cookie'].join('')
      : String(result.headers['Set-Cookie']);
    expect(setCookieHeader).toContain('kovo_session=s1');
    expect(setCookieHeader).toContain('HttpOnly');
    expect(result.status).toBe(200);
  });

  it('derives post-commit rerun queries from declared touches', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const cartQuery = query('cart', { reads: [cart] });
    const productQuery = query('product', { reads: [product] });
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        queries: [cartQuery, productQuery],
        touches: [cart],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'cart',
          input: { productId: 'p1' },
        },
      ],
      ok: true,
      rerunQueries: ['cart'],
      value: 'p1',
    });
  });

  it('enforces declared raw-SQL tables on mutation DB handles before driver execution', async () => {
    const contact = domain('contact');
    const calls: unknown[] = [];
    const driftedWrite = stampTrustedSql(
      { text: 'update users set role = $1 where id = $2', values: ['admin', 'u1'] },
      'drifted user write',
    );
    const addContact = mutation('contacts/raw-drift', {
      input: s.object({}),
      registry: {
        tables: ['contacts'],
        touches: [contact],
      },
      handler(_input, request) {
        return (request as { db: { execute(statement: unknown): unknown } }).db.execute(
          driftedWrite,
        );
      },
    });

    await expect(
      runMutation(
        addContact,
        {},
        {},
        {
          db: () => ({
            execute(statement: unknown) {
              calls.push(statement);
              return 'ok';
            },
          }),
        },
      ),
    ).rejects.toThrow(/KV406/);
    expect(calls).toEqual([]);
  });

  it('accepts only the mutation registry declared raw-SQL tables at the managed write choke', async () => {
    const contact = domain('contact-declared-write-choke');
    const calls: unknown[] = [];
    const runContactWrite = (name: string, statement: unknown) =>
      runMutation(
        mutation(`contacts/${name}`, {
          input: s.object({}),
          registry: {
            tables: ['contacts'],
            touches: [contact],
          },
          handler(_input, request) {
            return (request as { db: { execute(statement: unknown): unknown } }).db.execute(
              statement,
            );
          },
        }),
        {},
        {},
        {
          db: () => ({
            execute(executed: unknown) {
              calls.push(executed);
              return 'ok';
            },
          }),
        },
      );

    await expect(
      runContactWrite(
        'declared-table',
        stampTrustedSql(
          { text: 'update contacts set name = $1 where id = $2', values: ['Ada', 'c1'] },
          'declared contact update',
        ),
      ),
    ).resolves.toEqual({
      changes: [{ domain: 'contact-declared-write-choke', input: {} }],
      ok: true,
      rerunQueries: [],
      value: 'ok',
    });
    expect(calls).toHaveLength(1);

    await expect(
      runContactWrite(
        'userx-drift',
        stampTrustedSql(
          { text: 'update userx set name = $1 where id = $2', values: ['Ada', 'u1'] },
          'drifted userx update',
        ),
      ),
    ).rejects.toThrow(/KV406/);
    await expect(
      runContactWrite(
        'schema-drift',
        stampTrustedSql(
          {
            text: 'update otherschema.contacts set name = $1 where id = $2',
            values: ['Ada', 'c1'],
          },
          'drifted schema-qualified contact update',
        ),
      ),
    ).rejects.toThrow(/KV406/);
    await expect(
      runContactWrite(
        'pragma-drift',
        stampTrustedSql({ text: 'pragma user_version = 1' }, 'drifted pragma write'),
      ),
    ).rejects.toThrow(/KV406/);
    expect(calls).toHaveLength(1);
  });

  it('enforces declared raw-SQL tables inside the default transaction wrapper', async () => {
    const calls: unknown[] = [];
    const chunk = (value: string) => ({ value: [value] });
    const driftedWrite = stampTrustedSql(
      {
        queryChunks: [
          chunk('insert into users (id, role) values ('),
          'u1',
          chunk(', '),
          'admin',
          chunk(')'),
        ],
      },
      'drifted user transaction write',
    );
    const addContact = mutation('contacts/default-tx-raw-drift', {
      input: s.object({}),
      registry: {
        tables: ['contacts'],
      },
      handler(_input, request) {
        return (request as { db: { execute(statement: unknown): unknown } }).db.execute(
          driftedWrite,
        );
      },
    });

    await expect(
      runMutation(
        addContact,
        {},
        {},
        {
          db: () => ({
            transaction<Result>(
              callback: (tx: { execute(statement: unknown): unknown }) => Result,
            ): Result {
              return callback({
                execute(statement: unknown) {
                  calls.push(statement);
                  return 'ok';
                },
              });
            },
          }),
        },
      ),
    ).rejects.toThrow(/KV406/);
    expect(calls).toEqual([]);
  });

  it('denies mutation writes when registry tables are absent even if touches is declared', async () => {
    const contact = domain('contact-absent-tables');
    const calls: unknown[] = [];
    const absentTables = mutation('contacts/absent-tables', {
      input: s.object({}),
      registry: {
        touches: [contact],
      },
      handler(_input, request) {
        return (request as { db: { execute(statement: unknown): unknown } }).db.execute(
          stampTrustedSql(
            { text: 'insert into contacts (id) values ($1)', values: ['c1'] },
            'absent tables mutation write',
          ),
        );
      },
    });

    await expect(
      runMutation(
        absentTables,
        {},
        {},
        {
          db: () => ({
            execute(statement: unknown) {
              calls.push(statement);
              return 'ok';
            },
          }),
        },
      ),
    ).rejects.toThrow(/KV406/);
    expect(calls).toEqual([]);
  });

  it('renders mutation query chunks after the configured transaction commits', async () => {
    const state = { committed: 0, pending: 0 };
    const cart = domain('cart');
    const cartQuery = query('cart', {
      load: () => ({ count: state.committed }),
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ quantity: s.number().int().min(1) }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      async transaction(request: {}, run) {
        const result = await run(request);
        state.committed = state.pending;
        return result;
      },
      handler(input) {
        state.pending += input.quantity;
        return input.quantity;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        buildToken: 'mutation-test-build',
        fragment: true,
        rawInput: { quantity: 2 },
        request: {},
      }),
    ).resolves.toMatchObject({
      body: '<kovo-query name="cart">{"count":2}</kovo-query>',
      status: 200,
    });
  });

  it('reruns post-commit queries with the same request context', async () => {
    interface RequestContext {
      session: {
        cartId: string;
      };
    }

    const cart = domain('cart');
    const cartQuery = query('cart', {
      instanceKey: (_input) => 'cart:c1',
      load(_input, context: { request: RequestContext }) {
        const cartId: string = context.request.session.cartId;
        return { cartId };
      },
      reads: [cart],
    });
    const addToCart = mutation('cart/add', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [cartQuery],
        touches: [cart],
      },
      handler(input, request: RequestContext) {
        return `${request.session.cartId}:${input.productId}`;
      },
    });

    await expect(
      renderMutationResponse(addToCart, {
        buildToken: 'mutation-test-build',
        fragment: true,
        rawInput: { productId: 'p1' },
        request: { session: { cartId: 'c1' } },
      }),
    ).resolves.toMatchObject({
      body: '<kovo-query name="cart" key="cart:c1">{"cartId":"c1"}</kovo-query>',
      status: 200,
    });
  });

  it('derives post-commit rerun queries from inferred touch sites when touches are absent or empty', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const cartQuery = query('cart', { reads: [cart] });
    const productQuery = query('product', { reads: [product] });
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [cartQuery, productQuery],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
          keys: ['p1'],
        },
      ],
      ok: true,
      rerunQueries: ['product'],
      value: 'p1',
    });

    const addToCartWithEmptyTouches = mutation('cart/add-empty', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [cartQuery, productQuery],
        touches: [],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCartWithEmptyTouches, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
          keys: ['p1'],
        },
      ],
      ok: true,
      rerunQueries: ['product'],
      value: 'p1',
    });
  });

  it('narrows post-commit rerun query instances by row keys (canonical §10.2 name:keyValue)', async () => {
    // Canonical single-row identity of domain `product` is `product:<key>`
    // (SPEC §10.2:1019 `product:p1`) — no `via`/source-table segment. The sibling
    // `product:p2` must NOT rerun (L2-invalidation-2: prior `domain:via:key`
    // matcher over-invalidated every sibling instance).
    const product = domain('product');
    const productP1 = query('product', {
      instanceKey: 'product:p1',
      reads: [product],
    });
    const productP2 = query('product', {
      instanceKey: 'product:p2',
      reads: [product],
    });
    const reserveProduct = mutation('product/reserve', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId', via: 'products' }],
        queries: [productP1, productP2],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(reserveProduct, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
          keys: ['p1'],
          via: 'products',
        },
      ],
      ok: true,
      rerunQueries: ['product'],
      rerunQueryInstances: [{ instanceKey: 'product:p1', key: 'product' }],
      value: 'p1',
    });
  });

  it('preserves manual invalidations when inferred touch sites are active', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const cartQuery = query('cart', { reads: [cart] });
    const productQuery = query('product', { reads: [product] });
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: 'arg:productId' }],
        queries: [cartQuery, productQuery],
      },
      handler(input, _request, context) {
        context.invalidate(cart, {
          keys: [input.productId],
          reason: 'cart side effect',
        });
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
          keys: ['p1'],
        },
        {
          domain: 'cart',
          keys: ['p1'],
          manual: true,
          reason: 'cart side effect',
        },
      ],
      ok: true,
      rerunQueries: ['cart', 'product'],
      value: 'p1',
    });
  });

  it('keeps inferred touch sites authoritative over declared fallback touches', async () => {
    const cart = domain('cart');
    const product = domain('product');
    const cartQuery = query('cart', { reads: [cart] });
    const productQuery = query('product', { reads: [product] });
    const addToCart = mutation('cart/add', {
      input: s.object({
        productId: s.string(),
      }),
      registry: {
        inferredTouches: [{ domain: 'product', keys: null }],
        queries: [cartQuery, productQuery],
        touches: [cart],
      },
      handler(input) {
        return input.productId;
      },
    });

    await expect(runMutation(addToCart, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'product',
          input: { productId: 'p1' },
        },
      ],
      ok: true,
      rerunQueries: ['product'],
      value: 'p1',
    });
  });

  it('uses flat tags as the low-ceremony domain on-ramp', async () => {
    const pricing = tag('pricing');
    const pricingQuery = query('pricing', { reads: [pricing] });
    const recalculate = mutation('pricing/recalculate', {
      input: s.object({ productId: s.string() }),
      registry: {
        queries: [pricingQuery],
        touches: [pricing],
      },
      handler(input, _request, context) {
        context.invalidate(pricing, {
          keys: [input.productId],
          reason: 'external catalog feed',
        });
        return input.productId;
      },
    });

    await expect(runMutation(recalculate, { productId: 'p1' }, {})).resolves.toEqual({
      changes: [
        {
          domain: 'pricing',
          input: { productId: 'p1' },
        },
        {
          domain: 'pricing',
          keys: ['p1'],
          manual: true,
          reason: 'external catalog feed',
        },
      ],
      ok: true,
      rerunQueries: ['pricing'],
      value: 'p1',
    });
    expect(invalidate(pricing, { reason: 'manual price import' })).toEqual({
      domain: 'pricing',
      manual: true,
      reason: 'manual price import',
    });
  });
});
