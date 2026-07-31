import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  captureKovoDevRunnerBootstrapAuthority,
  type KovoDevRunnerGenerationBroker,
  type KovoDevRunnerModuleServer,
} from './dev-runner-generation.js';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function runnerFixture() {
  const closed: string[] = [];
  const origins: string[] = [];
  let failValidation = false;
  let validationFailure = 'assembly failed';
  let failCloseFor: string | undefined;
  let poisonImportOnNextCall = false;
  let source = 'initial';

  class FakeModuleGraph {
    invalidations = 0;

    invalidateAll(): void {
      this.invalidations += 1;
    }
  }

  class FakeRunner {
    readonly snapshot: string;

    constructor(environment: FakeEnvironment) {
      this.snapshot = environment.source;
    }

    clearCache(): void {}

    async close(): Promise<void> {
      if (this.snapshot === failCloseFor) throw new Error(`close failed: ${this.snapshot}`);
      closed.push(this.snapshot);
    }

    async import(id: string): Promise<Record<string, unknown>> {
      if (poisonImportOnNextCall) {
        poisonImportOnNextCall = false;
        FakeRunner.prototype.import = async () => ({ forged: true });
      }
      return { id, snapshot: this.snapshot };
    }
  }
  const authenticRunnerImport = FakeRunner.prototype.import;

  class FakeEnvironment {
    readonly moduleGraph = new FakeModuleGraph();
    private standardRunner: FakeRunner | undefined;
    source = source;

    get runner(): FakeRunner {
      this.standardRunner ??= new FakeRunner(this);
      return this.standardRunner;
    }
  }

  const viteModule = {
    createServerModuleRunner(environment: FakeEnvironment): FakeRunner {
      return new FakeRunner(environment);
    },
  };
  const bootstrapEnvironment = new FakeEnvironment();
  const liveEnvironment = new FakeEnvironment();
  const bootstrapServer = { environments: { ssr: bootstrapEnvironment } };
  const liveServer = { environments: { ssr: liveEnvironment } };
  const authority = captureKovoDevRunnerBootstrapAuthority(viteModule, bootstrapServer);
  const broker = authority.createBroker();
  const hooks = {
    async prepare(_server: KovoDevRunnerModuleServer): Promise<(origin: string) => void> {
      return (origin: string) => {
        origins.push(origin);
      };
    },
    async validate(server: KovoDevRunnerModuleServer): Promise<void> {
      await server.ssrLoadModule('/security-bootstrap');
      await server.ssrLoadModule('/server-root');
      await server.ssrLoadModule('/app');
      if (failValidation) throw new Error(validationFailure);
    },
  };

  return {
    authority,
    bootstrapEnvironment,
    broker,
    closed,
    configure(): void {
      broker.configure(liveServer, hooks);
    },
    fail(message = 'assembly failed'): void {
      failValidation = true;
      validationFailure = message;
    },
    failClose(snapshot: string): void {
      failCloseFor = snapshot;
    },
    FakeEnvironment,
    FakeRunner,
    liveEnvironment,
    liveServer,
    origins,
    poisonNextImport(): void {
      poisonImportOnNextCall = true;
    },
    restoreRunnerImport(): void {
      FakeRunner.prototype.import = authenticRunnerImport;
    },
    setSource(next: string): void {
      source = next;
      liveEnvironment.source = next;
    },
    viteModule,
  };
}

async function startBroker(
  broker: KovoDevRunnerGenerationBroker,
  configure: () => void,
): Promise<void> {
  configure();
  await broker.prepareInitial();
  broker.bindOrigin('http://127.0.0.1:4100');
  await broker.activateInitial();
}

describe('Kovo dev runner generations (SPEC §6.2.1 / §6.6 rule 6)', () => {
  it('validates a fresh candidate before atomically swapping the active generation', async () => {
    const fixture = runnerFixture();
    await startBroker(fixture.broker, fixture.configure);

    await expect(
      fixture.broker.withLease((server) => server.ssrLoadModule('/app')),
    ).resolves.toMatchObject({ snapshot: 'initial' });

    fixture.setSource('second');
    await fixture.broker.stage({});

    await expect(
      fixture.broker.withLease((server) => server.ssrLoadModule('/app')),
    ).resolves.toMatchObject({ snapshot: 'second' });
    expect(fixture.closed).toEqual(['initial']);
    // Vite invalidates the changed transform before calling handleHotUpdate. The broker must not
    // globally invalidate again while an old generation can still be draining a late import.
    expect(fixture.liveEnvironment.moduleGraph.invalidations).toBe(0);
    expect(fixture.origins).toEqual(['http://127.0.0.1:4100', 'http://127.0.0.1:4100']);

    await fixture.broker.close();
    expect(fixture.closed).toEqual(['initial', 'second']);
  });

  it('discards a failed candidate and keeps the prior closed graph serving', async () => {
    const fixture = runnerFixture();
    await startBroker(fixture.broker, fixture.configure);
    fixture.setSource('broken');
    fixture.fail();

    await expect(fixture.broker.stage({})).rejects.toThrow('assembly failed');
    await expect(
      fixture.broker.withLease((server) => server.ssrLoadModule('/app')),
    ).resolves.toMatchObject({ snapshot: 'initial' });
    expect(fixture.closed).toEqual(['broken']);

    await fixture.broker.close();
    expect(fixture.closed).toEqual(['broken', 'initial']);
  });

  it.each(['module evaluation failed', 'app assembly failed', 'declaration module deleted'])(
    'keeps the last-good generation when %s',
    async (failure) => {
      const fixture = runnerFixture();
      await startBroker(fixture.broker, fixture.configure);
      fixture.setSource('candidate');
      fixture.fail(failure);

      await expect(fixture.broker.stage({})).rejects.toThrow(failure);
      await expect(
        fixture.broker.withLease((server) => server.ssrLoadModule('/app')),
      ).resolves.toMatchObject({ snapshot: 'initial' });
      expect(fixture.closed).toEqual(['candidate']);
      await fixture.broker.close();
    },
  );

  it('deduplicates compiler and app-shell staging for one Vite hot-update token', async () => {
    const fixture = runnerFixture();
    await startBroker(fixture.broker, fixture.configure);
    fixture.setSource('second');
    const token = {};

    await Promise.all([fixture.broker.stage(token), fixture.broker.stage(token)]);

    expect(fixture.origins).toHaveLength(2);
    expect(fixture.closed).toEqual(['initial']);
    await fixture.broker.close();
  });

  it('gives startup, devtool, and app-shell work the exact same active runner lease', async () => {
    const fixture = runnerFixture();
    await startBroker(fixture.broker, fixture.configure);
    const moduleServers: KovoDevRunnerModuleServer[] = [];
    for (const surface of ['startup', 'devtool', 'app-shell']) {
      await fixture.broker.withLease(async (server) => {
        moduleServers.push(server);
        await server.ssrLoadModule(`/${surface}`);
      });
    }
    expect(moduleServers[1]).toBe(moduleServers[0]);
    expect(moduleServers[2]).toBe(moduleServers[0]);
    await fixture.broker.close();
  });

  it('retires the old runner only after its in-flight lease releases', async () => {
    const fixture = runnerFixture();
    await startBroker(fixture.broker, fixture.configure);
    const release = deferred<void>();
    const acquired = deferred<void>();
    const oldRequest = fixture.broker.withLease(async (server) => {
      const loaded = await server.ssrLoadModule('/app');
      acquired.resolve();
      await release.promise;
      return loaded;
    });
    await acquired.promise;

    fixture.setSource('second');
    await fixture.broker.stage({});
    expect(fixture.closed).toEqual([]);
    await expect(
      fixture.broker.withLease((server) => server.ssrLoadModule('/app')),
    ).resolves.toMatchObject({ snapshot: 'second' });

    release.resolve();
    await expect(oldRequest).resolves.toMatchObject({ snapshot: 'initial' });
    expect(fixture.closed).toEqual(['initial']);
    await fixture.broker.close();
  });

  it('keeps a draining generation on its closed snapshot during a late import', async () => {
    const fixture = runnerFixture();
    await startBroker(fixture.broker, fixture.configure);
    const importLate = deferred<void>();
    const acquired = deferred<void>();
    const oldRequest = fixture.broker.withLease(async (server) => {
      acquired.resolve();
      await importLate.promise;
      return server.ssrLoadModule('/late-handler');
    });
    await acquired.promise;

    fixture.setSource('second');
    await fixture.broker.stage({});
    importLate.resolve();

    await expect(oldRequest).resolves.toMatchObject({ snapshot: 'initial' });
    expect(fixture.liveEnvironment.moduleGraph.invalidations).toBe(0);
    await fixture.broker.close();
  });

  it('rejects forged live Vite runner identities before invoking them', () => {
    const fixture = runnerFixture();
    fixture.FakeRunner.prototype.import = async () => ({ forged: true });
    expect(() => fixture.configure()).toThrow(
      'Vite ModuleRunner.import identity does not match the Kovo bootstrap authority.',
    );
  });

  it('discards a candidate that poisons the runner prototype during evaluation', async () => {
    const fixture = runnerFixture();
    await startBroker(fixture.broker, fixture.configure);
    fixture.setSource('poisoned');
    fixture.poisonNextImport();

    await expect(fixture.broker.stage({})).rejects.toThrow(
      'Vite ModuleRunner.import identity does not match the Kovo bootstrap authority.',
    );
    expect(fixture.closed).toEqual(['poisoned']);

    fixture.restoreRunnerImport();
    await expect(
      fixture.broker.withLease((server) => server.ssrLoadModule('/app')),
    ).resolves.toMatchObject({ snapshot: 'initial' });
    await fixture.broker.close();
  });

  it('stops new leases and drains the active lease before broker close', async () => {
    const fixture = runnerFixture();
    await startBroker(fixture.broker, fixture.configure);
    const release = deferred<void>();
    const acquired = deferred<void>();
    const request = fixture.broker.withLease(async () => {
      acquired.resolve();
      await release.promise;
    });
    await acquired.promise;

    const closing = fixture.broker.close();
    await expect(fixture.broker.withLease(async () => undefined)).rejects.toThrow('closed');
    expect(fixture.closed).toEqual([]);
    release.resolve();
    await request;
    await closing;
    expect(fixture.closed).toEqual(['initial']);
  });

  it('closes a candidate that finishes validation after shutdown starts', async () => {
    const validationEntered = deferred<void>();
    const releaseValidation = deferred<void>();
    const delayed = runnerFixture();
    const delayedHooks = {
      async prepare(_server: KovoDevRunnerModuleServer): Promise<(origin: string) => void> {
        return () => undefined;
      },
      async validate(server: KovoDevRunnerModuleServer): Promise<void> {
        await server.ssrLoadModule('/app');
        if (
          (await server.ssrLoadModule<{ snapshot: string }>('/generation')).snapshot === 'second'
        ) {
          validationEntered.resolve();
          await releaseValidation.promise;
        }
      },
    };
    delayed.broker.configure(delayed.liveServer, delayedHooks);
    await delayed.broker.prepareInitial();
    delayed.broker.bindOrigin('http://127.0.0.1:4100');
    await delayed.broker.activateInitial();
    delayed.setSource('second');
    const staging = delayed.broker.stage({});
    await validationEntered.promise;
    const closing = delayed.broker.close();
    releaseValidation.resolve();
    await expect(staging).resolves.toBeUndefined();
    await closing;
    await expect(delayed.broker.withLease(async () => undefined)).rejects.toThrow('closed');
    expect(delayed.closed).toEqual(['second', 'initial']);
  });

  it('records runner-close rejection and surfaces it from broker close', async () => {
    const fixture = runnerFixture();
    await startBroker(fixture.broker, fixture.configure);
    fixture.failClose('initial');
    await expect(fixture.broker.close()).rejects.toThrow(
      'Kovo dev runner generation close failed.',
    );
  });

  it('atomically swaps fresh evaluated caches with the real Vite 8 module runner', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-real-runner-generation-'));
    const modulePath = join(root, 'app.ts');
    writeFileSync(modulePath, 'export const generation = "initial";\n');
    const viteModule = await import('vite-plus');
    const bootstrapServer = await viteModule.createServer({
      configFile: false,
      root,
      server: { hmr: false, middlewareMode: true },
    });
    const authority = captureKovoDevRunnerBootstrapAuthority(viteModule, bootstrapServer);
    const liveServer = await viteModule.createServer({
      configFile: false,
      root,
      server: { hmr: false, middlewareMode: true },
    });
    const broker = authority.createBroker();

    try {
      broker.configure(liveServer, {
        async prepare(): Promise<(origin: string) => void> {
          return () => undefined;
        },
        async validate(server): Promise<void> {
          const loaded = await server.ssrLoadModule<{ generation: string }>('/app.ts');
          if (loaded.generation !== 'initial' && loaded.generation !== 'second') {
            throw new Error('unexpected generation');
          }
        },
      });
      await broker.prepareInitial();
      broker.bindOrigin('http://127.0.0.1:4100');
      await broker.activateInitial();
      await expect(
        broker.withLease((server) => server.ssrLoadModule('/app.ts')),
      ).resolves.toMatchObject({ generation: 'initial' });

      writeFileSync(modulePath, 'export const generation = "second";\n');
      liveServer.environments.ssr.moduleGraph.invalidateAll();
      await broker.stage({});

      await expect(
        broker.withLease((server) => server.ssrLoadModule('/app.ts')),
      ).resolves.toMatchObject({ generation: 'second' });
    } finally {
      await broker.close();
      await liveServer.close();
      await bootstrapServer.close();
      rmSync(root, { force: true, recursive: true });
    }
  });

  it('rejects a real authored-config prototype forgery captured only after bootstrap', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kovo-real-runner-forgery-'));
    symlinkSync(join(process.cwd(), 'node_modules'), join(root, 'node_modules'), 'dir');
    const viteModule = await import('vite-plus');
    const bootstrapServer = await viteModule.createServer({
      configFile: false,
      root,
      server: { hmr: false, middlewareMode: true },
    });
    const authority = captureKovoDevRunnerBootstrapAuthority(viteModule, bootstrapServer);
    const runnerPrototype = Object.getPrototypeOf(bootstrapServer.environments.ssr.runner);
    const originalImport = Object.getOwnPropertyDescriptor(runnerPrototype, 'import')!;
    writeFileSync(
      join(root, 'malicious-config.ts'),
      [
        "import { ModuleRunner } from 'vite-plus/module-runner';",
        'ModuleRunner.prototype.import = async function () {',
        '  globalThis.__kovoForgedRunnerInvoked = true;',
        '  return { forged: true };',
        '};',
        'export default {};',
        '',
      ].join('\n'),
    );
    let liveServer: Awaited<ReturnType<typeof viteModule.createServer>> | undefined;

    try {
      await bootstrapServer.ssrLoadModule('/malicious-config.ts');
      liveServer = await viteModule.createServer({
        configFile: false,
        root,
        server: { hmr: false, middlewareMode: true },
      });
      const broker = authority.createBroker();
      expect(() =>
        broker.configure(liveServer, {
          async prepare(): Promise<(origin: string) => void> {
            return () => undefined;
          },
          async validate(): Promise<void> {},
        }),
      ).toThrow('Vite ModuleRunner.import identity does not match the Kovo bootstrap authority.');
      expect(
        (globalThis as typeof globalThis & { __kovoForgedRunnerInvoked?: boolean })
          .__kovoForgedRunnerInvoked,
      ).not.toBe(true);
    } finally {
      Object.defineProperty(runnerPrototype, 'import', originalImport);
      delete (globalThis as typeof globalThis & { __kovoForgedRunnerInvoked?: boolean })
        .__kovoForgedRunnerInvoked;
      await liveServer?.close();
      await bootstrapServer.close();
      rmSync(root, { force: true, recursive: true });
    }
  });
});
