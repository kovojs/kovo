// @kovo-security-classifier-corpus egress-ip
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { stampTrustedSql } from '@kovojs/core/internal/sql-safety';
import { scopedKeyFactsFor } from '@kovojs/core/internal/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';

import './sql-parser-authority-bootstrap.js';

import { frameworkEgressFetch, installNetConnectFloor, resolveEgressPolicy } from './egress.js';
import { installUndiciFloor } from './egress-undici.js';
import { mutation, runMutation } from './mutation.js';
import { query, runQuery } from './query.js';
import { s } from './schema.js';
import { task } from './task.js';
import { createDurableTaskRunner } from './task-runner.js';
import { MemoryDurableTaskQueue } from './task-queue.js';
import { assertNonRequestPrincipalPosture } from './auth-principal.js';
import { registerFrameworkManagedDbHooks } from './managed-db.js';

describe('durable task runner (SPEC §9.6)', () => {
  let uninstallEgressFloor: (() => void) | undefined;

  afterEach(() => {
    uninstallEgressFloor?.();
    uninstallEgressFloor = undefined;
  });

  it('resolves tasks by key and invokes run(args, ctx) with job context', async () => {
    const store = new MemoryDurableTaskQueue();
    const run = vi.fn(async () => undefined);
    const sendEmail = task('email.send', {
      input: s.object({ orderId: s.string() }),
      run,
    });
    const handle = await store.enqueue({
      task: sendEmail.key,
      args: { orderId: 'ord_1' },
      runAt: new Date('2026-06-30T10:00:00.000Z'),
    });
    const runner = createDurableTaskRunner({
      store,
      tasks: [sendEmail],
      batchSize: 1,
      leaseMs: 10_000,
      owner: 'runner-1',
      hooks: {
        runMutation: vi.fn(async () => ({ ok: true })),
        runQuery: vi.fn(async () => ({ ok: true })),
      },
    });

    const claimed = await runner.runOnce(new Date('2026-06-30T10:00:01.000Z'));

    expect(claimed).toHaveLength(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0]).toEqual({ orderId: 'ord_1' });
    expect(run.mock.calls[0]![1]).toMatchObject({ jobId: handle.id });
    expect(store.snapshot()[0]).toMatchObject({ id: handle.id, status: 'succeeded' });
  });

  it('dead-letters unknown task keys instead of dropping the claimed job', async () => {
    const store = new MemoryDurableTaskQueue();
    const handle = await store.enqueue({
      task: 'missing.task',
      args: {},
      runAt: new Date('2026-06-30T10:00:00.000Z'),
    });
    const runner = createDurableTaskRunner({ store, tasks: [] });

    await runner.runOnce(new Date('2026-06-30T10:00:00.000Z'));

    expect(store.snapshot()[0]).toMatchObject({
      id: handle.id,
      status: 'dead',
      lastError: 'No durable task is registered for key "missing.task".',
    });
  });

  it('fails closed on task query access without actAs and threads actAs posture to hooks', async () => {
    const store = new MemoryDurableTaskQueue();
    const hookInputs: unknown[] = [];
    const unsafe = task('owner.read.unsafe', {
      input: s.object({}),
      run: (_args, ctx) => ctx.runQuery({ key: 'orders/read' }, undefined),
    });
    const scoped = task('owner.read.scoped', {
      input: s.object({ ownerId: s.string() }),
      run: (args, ctx) => ctx.actAs(args.ownerId).runQuery({ key: 'orders/read' }, undefined),
    });
    await store.enqueue({ task: unsafe.key, args: {}, runAt: new Date('2026-06-30T10:00:00Z') });
    await store.enqueue({
      task: scoped.key,
      args: { ownerId: 'user_1' },
      runAt: new Date('2026-06-30T10:00:00Z'),
    });
    const runner = createDurableTaskRunner({
      store,
      tasks: [unsafe, scoped],
      batchSize: 2,
      hooks: {
        runQuery: vi.fn(async (_definition, _input, options) => {
          assertNonRequestPrincipalPosture(options.principalPosture);
          hookInputs.push(options.principalPosture);
          return [];
        }),
      },
    });

    await runner.runOnce(new Date('2026-06-30T10:00:01Z'));

    expect(store.snapshot().map((job) => ({ status: job.status, task: job.task }))).toEqual([
      { status: 'dead', task: 'owner.read.unsafe' },
      { status: 'succeeded', task: 'owner.read.scoped' },
    ]);
    expect(store.snapshot()[0]!.lastError).toContain(
      'without actAs(id) or declareSystemRead(reason)',
    );
    expect(hookInputs).toHaveLength(1);
  });

  it('threads task principal posture through runQuery and runMutation lifecycle DB resolution', async () => {
    const store = new MemoryDurableTaskQueue();
    const providerPostures: unknown[] = [];
    const queryResults: unknown[] = [];
    const mutationValues: unknown[] = [];
    type ScopedTaskDb = {
      select(): readonly { id: string; ownerId: string; scope: string }[];
      execute(statement: unknown): { id: string; ownerId: string; scope: string };
    };
    const readOrders = query('orders/read', {
      load: async (_input, context?: { db?: ScopedTaskDb }) => context?.db?.select() ?? [],
    });
    const recordOrder = mutation('orders/record', {
      input: s.object({ id: s.string() }),
      registry: { tables: ['orders'] },
      handler: async (input, request: { db?: ScopedTaskDb }) =>
        request.db?.execute(
          stampTrustedSql(
            { text: 'insert into orders (id) values (?)', values: [input.id] },
            'task-runner lifecycle posture test',
          ),
        ) ?? { id: input.id, ownerId: 'missing', scope: 'missing' },
    });
    const scoped = task('owner.read-write.scoped', {
      input: s.object({ ownerId: s.string() }),
      async run(args, ctx) {
        queryResults.push(await ctx.actAs(args.ownerId).runQuery(readOrders, undefined));
        queryResults.push(
          await ctx.declareSystemRead('compact system audit').runQuery(readOrders, undefined),
        );
        mutationValues.push(
          await ctx.actAs(args.ownerId).runMutation(recordOrder, { id: 'ord_1' }),
        );
      },
    });
    await store.enqueue({
      task: scoped.key,
      args: { ownerId: 'user_1' },
      runAt: new Date('2026-06-30T10:00:00Z'),
    });
    const db = async (request: unknown) => {
      const posture = (request as { principalPosture?: unknown }).principalPosture;
      assertNonRequestPrincipalPosture(posture);
      providerPostures.push(posture);
      const handle = {
        select() {
          return posture.kind === 'act-as'
            ? [{ id: 'ord_1', ownerId: posture.principal, scope: posture.kind }]
            : [{ id: 'system_ord', ownerId: '*', scope: posture.kind }];
        },
        execute() {
          return {
            id: 'ord_1',
            ownerId: posture.kind === 'act-as' ? posture.principal : 'system',
            scope: posture.kind,
          };
        },
      } satisfies ScopedTaskDb;
      const reader = { select: handle.select };
      registerFrameworkManagedDbHooks(handle, () => reader, undefined);
      return handle;
    };
    const runner = createDurableTaskRunner({
      store,
      tasks: [scoped],
      hooks: {
        runMutation: (definition, input, options) =>
          runMutation(
            definition as never,
            input,
            {},
            {
              csrf: false,
              db,
              principalPosture: options.principalPosture,
            },
          ).then((result) => (result.ok ? result.value : result)),
        runQuery: (definition, input, options) =>
          runQuery(
            definition as never,
            input,
            {},
            {
              db,
              principalPosture: options.principalPosture,
            },
          ).then((result) => (result.ok ? result.value : result)),
      },
    });

    await runner.runOnce(new Date('2026-06-30T10:00:01Z'));

    expect(store.snapshot()[0]).toMatchObject({ status: 'succeeded' });
    expect(providerPostures).toHaveLength(3);
    expect(providerPostures.map((posture) => (posture as { kind: string }).kind)).toEqual([
      'act-as',
      'system',
      'act-as',
    ]);
    expect(providerPostures[0]).toMatchObject({ kind: 'act-as', principal: 'user_1' });
    expect(providerPostures[1]).toMatchObject({ kind: 'system', reason: 'compact system audit' });
    expect(queryResults).toEqual([
      [{ id: 'ord_1', ownerId: 'user_1', scope: 'act-as' }],
      [{ id: 'system_ord', ownerId: '*', scope: 'system' }],
    ]);
    expect(mutationValues).toEqual([{ id: 'ord_1', ownerId: 'user_1', scope: 'act-as' }]);
  });

  it('routes default ctx.fetch through the framework egress allowlist choke', async () => {
    const server = http.createServer((_req, res) => res.end('task-ok'));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const policy = resolveEgressPolicy(
      {
        allowDestinations: [`http://127.0.0.1:${port}`],
        allowInternal: [`127.0.0.1:${port}`],
      },
      () => {},
    );
    const uninstallNet = installNetConnectFloor(policy);
    const uninstallUndici = installUndiciFloor(policy);
    uninstallEgressFloor = () => {
      uninstallUndici();
      uninstallNet();
    };
    try {
      const store = new MemoryDurableTaskQueue();
      const bodies: string[] = [];
      const outbound = task('outbound.task', {
        input: s.object({}),
        async run(_args, ctx) {
          bodies.push(await (await ctx.fetch(`http://127.0.0.1:${port}/`)).text());
          await expect(ctx.fetch(`http://localhost:${port}/`)).rejects.toMatchObject({
            reason: 'destination-allowlist',
          });
        },
      });
      await store.enqueue({ task: outbound.key, args: {} });
      const runner = createDurableTaskRunner({ store, tasks: [outbound] });

      await runner.runOnce(new Date());

      expect(bodies).toEqual(['task-ok']);
      expect(store.snapshot()[0]).toMatchObject({ status: 'succeeded' });
    } finally {
      uninstallEgressFloor?.();
      uninstallEgressFloor = undefined;
      server.close();
    }
  });

  it('lets a task schedule follow-on work through the queue-backed context helper', async () => {
    const store = new MemoryDurableTaskQueue();
    const child = task('child.task', {
      input: s.object({ parent: s.string() }),
      run: vi.fn(),
    });
    const parent = task('parent.task', {
      input: s.object({ id: s.string() }),
      async run(args, ctx) {
        await ctx.schedule(
          child,
          { parent: args.id },
          { key: ctx.actAs(args.id).stateKey(`child:${args.id}`), coalesce: 'throttle' },
        );
      },
    });
    await store.enqueue({ task: parent.key, args: { id: 'p1' } });
    const runner = createDurableTaskRunner({ store, tasks: [parent, child] });

    await runner.runOnce(new Date());

    expect(store.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ task: 'parent.task', status: 'succeeded' }),
        expect.objectContaining({
          task: 'child.task',
          args: { parent: 'p1' },
          key: expect.any(Object),
          status: 'ready',
        }),
      ]),
    );
    const childJob = store.snapshot().find((job) => job.task === 'child.task');
    expect(scopedKeyFactsFor(childJob?.key)).toMatchObject({
      authority: 'p1',
      key: 'child:p1',
      posture: 'principal',
    });
  });

  it('exposes stable job idempotency keys and retries with backoff until success', async () => {
    const store = new MemoryDurableTaskQueue();
    const effects: string[] = [];
    const flaky = task('flaky.task', {
      input: s.object({ id: s.string() }),
      retry: { maxAttempts: 3, backoff: 'linear' },
      async run(args, ctx) {
        if (effects.length < 2) {
          effects.push(`${ctx.jobId}:${ctx.idempotencyKey}:${args.id}`);
          throw new Error('transient');
        }
        effects.push(`done:${ctx.idempotencyKey}:${args.id}`);
      },
    });
    await store.enqueue({
      task: flaky.key,
      args: { id: 'ord_1' },
      runAt: new Date('2026-06-30T10:00:00.000Z'),
    });
    const runner = createDurableTaskRunner({ store, tasks: [flaky] });

    await runner.runOnce(new Date('2026-06-30T10:00:00.000Z'));
    await runner.runOnce(new Date(Date.now() + 5000));
    await runner.runOnce(new Date(Date.now() + 10_000));

    const [job] = store.snapshot();
    expect(job).toMatchObject({ status: 'succeeded', attempts: 3 });
    expect(effects).toHaveLength(3);
    expect(effects[0]!.split(':')[0]).toBe(effects[0]!.split(':')[1]);
    expect(effects[2]).toBe(`done:${job!.id}:ord_1`);
  });

  it('dead-letters permanently failing tasks at maxAttempts', async () => {
    const store = new MemoryDurableTaskQueue();
    const onError = vi.fn();
    const alwaysFails = task('always.fail', {
      input: s.object({}),
      retry: { maxAttempts: 2, backoff: 'exponential' },
      async run() {
        throw new Error('nope');
      },
    });
    await store.enqueue({
      task: alwaysFails.key,
      args: {},
      runAt: new Date('2026-06-30T10:00:00.000Z'),
    });
    const runner = createDurableTaskRunner({
      hooks: { onError },
      store,
      tasks: [alwaysFails],
    });

    await runner.runOnce(new Date('2026-06-30T10:00:00.000Z'));
    await runner.runOnce(new Date(Date.now() + 5000));

    expect(store.snapshot()[0]).toMatchObject({
      status: 'dead',
      attempts: 2,
      lastError: 'nope',
    });
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenLastCalledWith(
      expect.any(Error),
      expect.objectContaining({
        job: expect.objectContaining({ task: 'always.fail' }),
        phase: 'task-run',
        task: alwaysFails,
      }),
    );
  });

  it('persists structured diagnostics for non-Error task throws', async () => {
    const store = new MemoryDurableTaskQueue();
    const throwsObject = task('throws.object', {
      input: s.object({}),
      async run() {
        throw { code: 'PAYLOAD_INVALID', detail: { field: 'email' } };
      },
    });
    await store.enqueue({ task: throwsObject.key, args: {} });
    const runner = createDurableTaskRunner({ store, tasks: [throwsObject] });

    await runner.runOnce(new Date());

    expect(store.snapshot()[0]).toMatchObject({
      status: 'dead',
      lastError: '{"code":"PAYLOAD_INVALID","detail":{"field":"email"}}',
    });
  });

  it('times out hung tasks at the hard ceiling and retries without pinning the runner', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-30T10:00:00.000Z'));
      const store = new MemoryDurableTaskQueue();
      const hung = task('hung.task', {
        input: s.object({}),
        retry: { maxAttempts: 2 },
        timeoutMs: 5000,
        run: () => new Promise(() => undefined),
      });
      await store.enqueue({ task: hung.key, args: {} });
      const runner = createDurableTaskRunner({
        store,
        tasks: [hung],
        hardTimeoutMs: 100,
        heartbeatIntervalMs: 25,
        leaseMs: 30,
      });

      const run = runner.runOnce(new Date('2026-06-30T10:00:00.000Z'));
      await vi.advanceTimersByTimeAsync(125);
      await run;

      expect(store.snapshot()[0]).toMatchObject({
        status: 'ready',
        attempts: 1,
        lastError: 'Durable task "hung.task" exceeded timeoutMs 100.',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds claims by maxInFlight and per-task concurrency while respecting priority lanes', async () => {
    const store = new MemoryDurableTaskQueue();
    const order: string[] = [];
    const high = task('high.task', {
      input: s.object({ n: s.number() }),
      priority: 10,
      concurrency: 1,
      run: (args) => {
        order.push(`high:${args.n}`);
      },
    });
    const low = task('low.task', {
      input: s.object({ n: s.number() }),
      priority: 1,
      run: (args) => {
        order.push(`low:${args.n}`);
      },
    });
    await store.enqueue({ task: low.key, args: { n: 1 }, priority: 1 });
    await store.enqueue({ task: high.key, args: { n: 1 }, priority: 10 });
    await store.enqueue({ task: high.key, args: { n: 2 }, priority: 10 });

    const runner = createDurableTaskRunner({
      store,
      tasks: [high, low],
      batchSize: 3,
      maxInFlight: 2,
    });
    const claimed = await runner.runOnce(new Date());

    expect(claimed.map((job) => job.task)).toEqual(['high.task', 'low.task']);
    expect(order).toEqual(['high:1', 'low:1']);
    expect(
      store.snapshot().find((job) => job.args && (job.args as { n: number }).n === 2),
    ).toMatchObject({
      status: 'ready',
    });
  });

  it('keeps a timed-out task in the concurrency slot until the abandoned body settles', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-30T10:00:00.000Z'));
      const store = new MemoryDurableTaskQueue();
      let releaseFirst!: () => void;
      let runs = 0;
      const slow = task('slow.exclusive', {
        input: s.object({ n: s.number() }),
        concurrency: 1,
        timeoutMs: 100,
        run(args) {
          runs += 1;
          if (args.n === 1) return new Promise<void>((resolve) => (releaseFirst = resolve));
        },
      });
      await store.enqueue({ task: slow.key, args: { n: 1 } });
      await store.enqueue({ task: slow.key, args: { n: 2 } });
      const runner = createDurableTaskRunner({
        store,
        tasks: [slow],
        hardTimeoutMs: 100,
        leaseMs: 1000,
      });

      const firstRun = runner.runOnce(new Date('2026-06-30T10:00:00.000Z'));
      await vi.advanceTimersByTimeAsync(125);
      await firstRun;
      expect(runs).toBe(1);
      expect(
        store.snapshot().find((job) => job.args && (job.args as { n: number }).n === 1),
      ).toMatchObject({ status: 'dead' });

      await expect(runner.runOnce(new Date('2026-06-30T10:00:01.000Z'))).resolves.toEqual([]);
      releaseFirst();
      await Promise.resolve();
      await Promise.resolve();
      await expect(runner.runOnce(new Date('2026-06-30T10:00:01.000Z'))).resolves.toHaveLength(1);
      expect(runs).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('applies the self-reschedule delay floor and dead-letters past maxGenerations', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-30T10:00:00.000Z'));
      const store = new MemoryDurableTaskQueue();
      let loop!: ReturnType<typeof task>;
      loop = task('loop.task', {
        input: s.object({}),
        maxGenerations: 1,
        async run(_, ctx) {
          await ctx.schedule(loop, {}, { afterMs: 1 });
        },
      });
      await store.enqueue({ task: loop.key, args: {} });
      const runner = createDurableTaskRunner({
        store,
        tasks: [loop],
        selfRescheduleDelayFloorMs: 1000,
      });

      await runner.runOnce(new Date('2026-06-30T10:00:00.000Z'));
      const child = store.snapshot().find((job) => job.status === 'ready');
      expect(child).toMatchObject({
        generation: 1,
        lineage: store.snapshot()[0]!.id,
        runAt: new Date('2026-06-30T10:00:01.000Z'),
      });

      vi.setSystemTime(new Date('2026-06-30T10:00:01.000Z'));
      await runner.runOnce(new Date('2026-06-30T10:00:01.000Z'));
      expect(store.snapshot()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            generation: 2,
            status: 'dead',
            lastError: expect.stringContaining('exceeded maxGenerations 1'),
          }),
        ]),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects self-reschedule option accessors before they can bypass the delay floor', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-30T10:00:00.000Z'));
      const store = new MemoryDurableTaskQueue();
      let reads = 0;
      let loop!: ReturnType<typeof task>;
      loop = task('loop.accessor-options', {
        input: s.object({}),
        async run(_, context) {
          await context.schedule(
            loop,
            {},
            {
              get afterMs() {
                reads += 1;
                return reads < 4 ? 1 : undefined;
              },
            },
          );
        },
      });
      await store.enqueue({ task: loop.key, args: {} });
      const runner = createDurableTaskRunner({
        selfRescheduleDelayFloorMs: 1000,
        store,
        tasks: [loop],
      });

      await runner.runOnce(new Date('2026-06-30T10:00:00.000Z'));

      expect(reads).toBe(0);
      expect(store.snapshot()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            lastError: expect.stringContaining('Durable task property afterMs'),
            status: 'dead',
          }),
        ]),
      );
      expect(store.snapshot().filter((job) => job.status === 'ready')).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects ctx.schedule for tasks outside the runner registry', async () => {
    const store = new MemoryDurableTaskQueue();
    const registered = task('registered.parent', {
      input: s.object({}),
      async run(_, ctx) {
        await ctx.schedule(unregistered, {});
      },
    });
    const unregistered = task('unregistered.child', {
      input: s.object({}),
      run() {},
    });
    await store.enqueue({ task: registered.key, args: {} });
    const runner = createDurableTaskRunner({ store, tasks: [registered] });

    await runner.runOnce(new Date());

    expect(store.snapshot()).toEqual([
      expect.objectContaining({
        task: 'registered.parent',
        status: 'dead',
        lastError: 'No durable task is registered for key "unregistered.child".',
      }),
    ]);
  });

  it('rejects a same-key impostor instead of treating its key as registry provenance', async () => {
    const store = new MemoryDurableTaskQueue();
    const registeredChild = task('privileged.child', {
      input: s.object({}),
      run() {},
    });
    const impostor = task('privileged.child', {
      input: s.object({}),
      run() {},
    });
    const parent = task('ordinary.parent', {
      input: s.object({}),
      async run(_, ctx) {
        await ctx.schedule(impostor, {});
      },
    });
    await store.enqueue({ task: parent.key, args: {} });
    const runner = createDurableTaskRunner({ store, tasks: [parent, registeredChild] });

    await runner.runOnce(new Date());

    expect(store.snapshot()).toEqual([
      expect.objectContaining({
        task: 'ordinary.parent',
        status: 'dead',
        lastError: 'No durable task is registered for key "privileged.child".',
      }),
    ]);
  });

  it('is stoppable when started as a polling helper', async () => {
    vi.useFakeTimers();
    try {
      const store = new MemoryDurableTaskQueue();
      const runner = createDurableTaskRunner({ store, tasks: [], pollIntervalMs: 1000 });

      runner.start();
      await vi.runOnlyPendingTimersAsync();
      await runner.stop();

      expect(store.snapshot()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pins the queue identity and never accepts a replaceable egress hook', async () => {
    const originalStore = new MemoryDurableTaskQueue();
    const attackerStore = new MemoryDurableTaskQueue();
    const observed: string[] = [];
    let observedFetch: typeof fetch | undefined;
    let observedContext: { readonly fetch: typeof fetch } | undefined;
    const authorityProbe = task('authority.probe', {
      input: s.object({ source: s.string() }),
      run(args, context) {
        observed.push(args.source);
        observedFetch = context.fetch;
        observedContext = context;
      },
    });
    await originalStore.enqueue({ task: authorityProbe.key, args: { source: 'original-store' } });
    await attackerStore.enqueue({ task: authorityProbe.key, args: { source: 'attacker-store' } });
    const options = { store: originalStore, tasks: [authorityProbe] };
    const runner = createDurableTaskRunner(options);

    (options as { store: MemoryDurableTaskQueue }).store = attackerStore;
    await runner.runOnce(new Date());

    expect(observed).toEqual(['original-store']);
    expect(observedFetch).toBe(frameworkEgressFetch);
    expect(Object.getOwnPropertyDescriptor(observedContext!, 'fetch')).toEqual({
      configurable: false,
      enumerable: true,
      value: frameworkEgressFetch,
      writable: false,
    });
    expect(() => {
      (observedContext as { fetch: typeof fetch }).fetch = vi.fn() as typeof fetch;
    }).toThrow(TypeError);
    expect(observedContext!.fetch).toBe(frameworkEgressFetch);
    expect(originalStore.snapshot()[0]).toMatchObject({ status: 'succeeded' });
    expect(attackerStore.snapshot()[0]).toMatchObject({ status: 'ready' });

    expect(() =>
      createDurableTaskRunner({
        hooks: { fetch: vi.fn() } as never,
        store: new MemoryDurableTaskQueue(),
        tasks: [],
      }),
    ).toThrow(/egress capability is framework-owned/);
  });

  it('rejects claimed-job accessors without invoking them as registry authority', async () => {
    let taskReads = 0;
    let handled = 0;
    const registered = task('authority.claimed-job', {
      input: s.object({}),
      run() {
        handled += 1;
      },
    });
    const forgedJob = {
      args: {},
      attempts: 1,
      createdAt: new Date(0),
      generation: 0,
      id: 'forged-job',
      lineage: 'forged-job',
      priority: 0,
      runAt: new Date(0),
      status: 'running',
      get task() {
        taskReads += 1;
        return registered.key;
      },
      updatedAt: new Date(0),
    };
    const store = {
      async cancel() {
        return false;
      },
      async claimDue() {
        return [forgedJob];
      },
      async enqueue() {
        return { id: 'unused', task: registered.key };
      },
      async heartbeat() {
        return true;
      },
      async markFailed() {
        return true;
      },
      async markSucceeded() {
        return true;
      },
      async reapExpiredLeases() {
        return 0;
      },
    };
    const runner = createDurableTaskRunner({ store, tasks: [registered] });

    await expect(runner.runOnce(new Date())).rejects.toThrow(
      /Durable task property task must be an own data value/,
    );
    expect(taskReads).toBe(0);
    expect(handled).toBe(0);
  });

  it('rejects a queue adapter batch larger than the requested claim limit', async () => {
    const registered = task('authority.claim-limit', {
      input: s.object({}),
      run() {},
    });
    const job = {
      args: {},
      attempts: 1,
      createdAt: new Date(0),
      generation: 0,
      id: 'oversized-job',
      lineage: 'oversized-job',
      priority: 0,
      runAt: new Date(0),
      status: 'running' as const,
      task: registered.key,
      updatedAt: new Date(0),
    };
    const store = {
      async cancel() {
        return false;
      },
      async claimDue() {
        return [job, job];
      },
      async enqueue() {
        return { id: 'unused', task: registered.key };
      },
      async heartbeat() {
        return true;
      },
      async markFailed() {
        return true;
      },
      async markSucceeded() {
        return true;
      },
      async reapExpiredLeases() {
        return 0;
      },
    };

    await expect(
      createDurableTaskRunner({ store, tasks: [registered] }).runOnce(new Date()),
    ).rejects.toThrow(/claimDue result must not exceed the requested bounded limit/);
  });
});
