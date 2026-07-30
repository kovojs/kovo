/* oxlint-disable typescript/unbound-method -- Boot-captured controls are invoked through pinned Reflect.apply. */

const NativeObject = globalThis.Object;
const NativePromise = globalThis.Promise;
const NativeReflect = globalThis.Reflect;
const NativeWeakMap = globalThis.WeakMap;
const nativeArrayPush = globalThis.Array.prototype.push;
const nativeObjectFreeze = NativeObject.freeze;
const nativeObjectGetOwnPropertyDescriptor = NativeObject.getOwnPropertyDescriptor;
const nativeObjectGetPrototypeOf = NativeObject.getPrototypeOf;
const nativePromiseCatch = NativePromise.prototype.catch;
const nativePromiseReject = NativePromise.reject.bind(NativePromise);
const nativePromiseResolve = NativePromise.resolve.bind(NativePromise);
const nativePromiseThen = NativePromise.prototype.then;
const nativeReflectApply = NativeReflect.apply;
const nativeReflectGet = NativeReflect.get;
const nativeWeakMapGet = NativeWeakMap.prototype.get;
const nativeWeakMapSet = NativeWeakMap.prototype.set;

interface ViteRunner {
  clearCache(): void;
  close(): Promise<void>;
  import<T = Record<string, unknown>>(id: string): Promise<T>;
}

interface ViteModuleGraph {
  invalidateAll(): void;
}

interface ViteRunnableEnvironment {
  readonly moduleGraph: ViteModuleGraph;
  readonly runner: ViteRunner;
}

type ViteRunnerFactory = (
  environment: ViteRunnableEnvironment,
  options: { readonly hmr: false },
) => ViteRunner;

interface ViteRunnerModule {
  readonly createServerModuleRunner: ViteRunnerFactory;
}

interface MethodWitness {
  readonly key: PropertyKey;
  readonly owner: object;
  readonly value: (...args: never[]) => unknown;
}

interface GetterWitness {
  readonly get: () => unknown;
  readonly key: PropertyKey;
  readonly owner: object;
}

/**
 * Exact Vite identities first observed through the bootstrap server, before authored config.
 *
 * @internal Supported `kovo dev` trust root (SPEC §6.6 rule 6).
 */
export interface KovoDevRunnerBootstrapAuthority {
  readonly createBroker: () => KovoDevRunnerGenerationBroker;
}

/** @internal Runner-local module carrier; never accepts Vite's compatibility `ssrLoadModule`. */
export interface KovoDevRunnerModuleServer {
  ssrLoadModule<T = Record<string, unknown>>(id: string): Promise<T>;
}

/** @internal Graph-local preparation and closed-app validation registered by trusted server code. */
export interface KovoDevRunnerGenerationHooks {
  prepare(server: KovoDevRunnerModuleServer): Promise<(origin: string) => void>;
  validate(server: KovoDevRunnerModuleServer): Promise<void>;
}

/**
 * One trusted broker shared by startup, devtool, compiler HMR, and request dispatch.
 *
 * @internal The object is carried only through the bootstrap-created plugin closure.
 */
export interface KovoDevRunnerGenerationBroker {
  activateInitial(): Promise<void>;
  bindOrigin(origin: string): void;
  close(): Promise<void>;
  configure(server: unknown, hooks: KovoDevRunnerGenerationHooks): void;
  prepareInitial(): Promise<void>;
  stage(token?: object): Promise<void>;
  withLease<T>(operation: (server: KovoDevRunnerModuleServer) => Promise<T>): Promise<T>;
}

interface RunnerGeneration {
  closePromise: Promise<void> | undefined;
  drainResolve: (() => void) | undefined;
  drainPromise: Promise<void> | undefined;
  readonly moduleServer: KovoDevRunnerModuleServer;
  refs: number;
  retired: boolean;
  readonly runner: ViteRunner;
}

/**
 * Capture Vite's factory, environment getter, runner methods, and module-graph invalidator from
 * the config-free bootstrap server. Function text and behavioral probes are deliberately not
 * provenance (SPEC §6.6 rule 6).
 */
export function captureKovoDevRunnerBootstrapAuthority(
  viteModule: unknown,
  bootstrapServer: unknown,
): KovoDevRunnerBootstrapAuthority {
  const createServerModuleRunner = ownFunction(
    viteModule,
    'createServerModuleRunner',
    'Vite createServerModuleRunner',
  ) as ViteRunnerFactory;
  const bootstrapEnvironment = ssrEnvironment(bootstrapServer, 'Kovo bootstrap Vite server');
  const runnerGetter = getterWitness(
    bootstrapEnvironment,
    'runner',
    'Vite RunnableDevEnvironment.runner',
  );
  const bootstrapRunner = nativeReflectApply(
    runnerGetter.get,
    bootstrapEnvironment,
    [],
  ) as ViteRunner;
  const runnerImport = methodWitness(bootstrapRunner, 'import', 'Vite ModuleRunner.import');
  const runnerClearCache = methodWitness(
    bootstrapRunner,
    'clearCache',
    'Vite ModuleRunner.clearCache',
  );
  const runnerClose = methodWitness(bootstrapRunner, 'close', 'Vite ModuleRunner.close');
  const bootstrapModuleGraph = ownObject(
    bootstrapEnvironment,
    'moduleGraph',
    'Vite RunnableDevEnvironment.moduleGraph',
  ) as unknown as ViteModuleGraph;
  const moduleGraphInvalidateAll = methodWitness(
    bootstrapModuleGraph,
    'invalidateAll',
    'Vite EnvironmentModuleGraph.invalidateAll',
  );

  const createBroker = (): KovoDevRunnerGenerationBroker =>
    createKovoDevRunnerGenerationBroker({
      createServerModuleRunner,
      moduleGraphInvalidateAll,
      runnerClearCache,
      runnerClose,
      runnerGetter,
      runnerImport,
      viteModule: viteModule as ViteRunnerModule,
    });

  return nativeObjectFreeze({ createBroker });
}

function createKovoDevRunnerGenerationBroker(authority: {
  readonly createServerModuleRunner: ViteRunnerFactory;
  readonly moduleGraphInvalidateAll: MethodWitness;
  readonly runnerClearCache: MethodWitness;
  readonly runnerClose: MethodWitness;
  readonly runnerGetter: GetterWitness;
  readonly runnerImport: MethodWitness;
  readonly viteModule: ViteRunnerModule;
}): KovoDevRunnerGenerationBroker {
  let active: RunnerGeneration | undefined;
  let closed = false;
  let configured = false;
  let hooks: KovoDevRunnerGenerationHooks | undefined;
  let initialActivation: Promise<void> | undefined;
  let initialBinder: ((origin: string) => void) | undefined;
  let liveEnvironment: ViteRunnableEnvironment | undefined;
  let liveModuleGraph: ViteModuleGraph | undefined;
  let origin: string | undefined;
  let pendingInitial: RunnerGeneration | undefined;
  let requestedRevision = 0;
  let stageTail: Promise<void> = nativePromiseResolve();
  const stagesByToken = new NativeWeakMap<object, Promise<void>>();
  const generations: RunnerGeneration[] = [];
  const closeFailures: unknown[] = [];

  const assertFactoryCurrent = (): void => {
    if (
      nativeReflectGet(authority.viteModule, 'createServerModuleRunner') !==
      authority.createServerModuleRunner
    ) {
      throw new TypeError('Vite createServerModuleRunner changed after Kovo bootstrap.');
    }
  };

  const assertEnvironmentCurrent = (): ViteRunnableEnvironment => {
    const environment = liveEnvironment;
    const moduleGraph = liveModuleGraph;
    if (environment === undefined || moduleGraph === undefined) {
      throw new TypeError('Kovo dev runner generations are not configured.');
    }
    assertFactoryCurrent();
    assertGetter(environment, authority.runnerGetter, 'Vite RunnableDevEnvironment.runner');
    if (
      ownObject(environment, 'moduleGraph', 'Vite RunnableDevEnvironment.moduleGraph') !==
      moduleGraph
    ) {
      throw new TypeError('Vite SSR module graph changed after Kovo configuration.');
    }
    assertMethod(
      moduleGraph,
      authority.moduleGraphInvalidateAll,
      'Vite EnvironmentModuleGraph.invalidateAll',
    );
    return environment;
  };

  const closeGeneration = (generation: RunnerGeneration): Promise<void> => {
    if (generation.closePromise !== undefined) return generation.closePromise;
    let closeResult: unknown;
    try {
      // The runner was minted by the boot-pinned factory and attested before publication. Cleanup
      // deliberately invokes the captured close implementation directly: if authored evaluation
      // poisons the shared prototype, Kovo must still be able to discard that candidate.
      closeResult = nativeReflectApply(authority.runnerClose.value, generation.runner, []);
    } catch (cause) {
      nativeReflectApply(nativeArrayPush, closeFailures, [cause]);
      const closePromise = nativePromiseResolve();
      generation.closePromise = closePromise;
      return closePromise;
    }
    const closePromise = nativeReflectApply(nativePromiseThen, nativePromiseResolve(closeResult), [
      () => undefined,
      (cause: unknown) => {
        nativeReflectApply(nativeArrayPush, closeFailures, [cause]);
      },
    ]) as Promise<void>;
    generation.closePromise = closePromise;
    return closePromise;
  };

  const retireGeneration = (generation: RunnerGeneration): void => {
    generation.retired = true;
    if (generation.refs === 0) void closeGeneration(generation);
  };

  const assertGenerationCurrent = (generation: RunnerGeneration): void => {
    assertEnvironmentCurrent();
    assertMethod(generation.runner, authority.runnerImport, 'Vite ModuleRunner.import');
    assertMethod(generation.runner, authority.runnerClearCache, 'Vite ModuleRunner.clearCache');
    assertMethod(generation.runner, authority.runnerClose, 'Vite ModuleRunner.close');
  };

  const createGeneration = (): RunnerGeneration => {
    if (closed) throw new Error('Kovo dev runner generation broker is closed.');
    const environment = assertEnvironmentCurrent();
    const runner = authority.createServerModuleRunner(environment, { hmr: false });
    assertMethod(runner, authority.runnerImport, 'Vite ModuleRunner.import');
    assertMethod(runner, authority.runnerClearCache, 'Vite ModuleRunner.clearCache');
    assertMethod(runner, authority.runnerClose, 'Vite ModuleRunner.close');
    const moduleServer = nativeObjectFreeze({
      ssrLoadModule<T = Record<string, unknown>>(id: string): Promise<T> {
        assertMethod(runner, authority.runnerImport, 'Vite ModuleRunner.import');
        const imported = nativePromiseResolve(
          nativeReflectApply(authority.runnerImport.value, runner, [id]),
        );
        return nativeReflectApply(nativePromiseThen, imported, [
          (value: T) => {
            assertGenerationCurrent(generation);
            return value;
          },
          (cause: unknown) => {
            assertGenerationCurrent(generation);
            throw cause;
          },
        ]) as Promise<T>;
      },
    });
    const generation: RunnerGeneration = {
      closePromise: undefined,
      drainPromise: undefined,
      drainResolve: undefined,
      moduleServer,
      refs: 0,
      retired: false,
      runner,
    };
    nativeReflectApply(nativeArrayPush, generations, [generation]);
    return generation;
  };

  const validateGeneration = async (generation: RunnerGeneration): Promise<void> => {
    const generationHooks = hooks;
    const generationOrigin = origin;
    if (generationHooks === undefined || generationOrigin === undefined) {
      throw new TypeError('Kovo dev runner generation is missing trusted hooks or bound origin.');
    }
    const bind = await generationHooks.prepare(generation.moduleServer);
    if (typeof bind !== 'function') {
      throw new TypeError('Kovo dev runner generation prepare hook must return an origin binder.');
    }
    bind(generationOrigin);
    await generationHooks.validate(generation.moduleServer);
  };

  const swapGeneration = (generation: RunnerGeneration): void => {
    const previous = active;
    active = generation;
    if (previous !== undefined) retireGeneration(previous);
  };

  const configure = (server: unknown, nextHooks: KovoDevRunnerGenerationHooks): void => {
    if (configured) throw new Error('Kovo dev runner generation broker was already configured.');
    if (typeof nextHooks !== 'object' || nextHooks === null) {
      throw new TypeError('Kovo dev runner generation hooks are incomplete.');
    }
    const prepare = ownDataFunction(
      nextHooks,
      'prepare',
      'Kovo dev runner generation prepare hook',
    ) as KovoDevRunnerGenerationHooks['prepare'];
    const validate = ownDataFunction(
      nextHooks,
      'validate',
      'Kovo dev runner generation validate hook',
    ) as KovoDevRunnerGenerationHooks['validate'];
    const environment = ssrEnvironment(server, 'Kovo live Vite server');
    assertGetter(environment, authority.runnerGetter, 'Vite RunnableDevEnvironment.runner');
    // Read the live runner only after its exact bootstrap getter has been attested.
    const liveRunner = nativeReflectApply(
      authority.runnerGetter.get,
      environment,
      [],
    ) as ViteRunner;
    assertMethod(liveRunner, authority.runnerImport, 'Vite ModuleRunner.import');
    assertMethod(liveRunner, authority.runnerClearCache, 'Vite ModuleRunner.clearCache');
    assertMethod(liveRunner, authority.runnerClose, 'Vite ModuleRunner.close');
    const moduleGraph = ownObject(
      environment,
      'moduleGraph',
      'Vite RunnableDevEnvironment.moduleGraph',
    ) as unknown as ViteModuleGraph;
    assertMethod(
      moduleGraph,
      authority.moduleGraphInvalidateAll,
      'Vite EnvironmentModuleGraph.invalidateAll',
    );
    assertFactoryCurrent();
    hooks = nativeObjectFreeze({
      prepare,
      validate,
    });
    liveEnvironment = environment;
    liveModuleGraph = moduleGraph;
    configured = true;
  };

  const prepareInitial = async (): Promise<void> => {
    if (!configured || hooks === undefined) {
      throw new TypeError('Kovo dev runner generation broker is not configured.');
    }
    if (pendingInitial !== undefined || active !== undefined) {
      throw new Error('Kovo dev initial runner generation was already prepared.');
    }
    const generation = createGeneration();
    pendingInitial = generation;
    try {
      const bind = await hooks.prepare(generation.moduleServer);
      if (typeof bind !== 'function') {
        throw new TypeError(
          'Kovo dev runner generation prepare hook must return an origin binder.',
        );
      }
      assertGenerationCurrent(generation);
      initialBinder = bind;
    } catch (cause) {
      pendingInitial = undefined;
      await closeGeneration(generation);
      throw cause;
    }
  };

  const bindOrigin = (nextOrigin: string): void => {
    if (closed) throw new Error('Kovo dev runner generation broker is closed.');
    if (origin !== undefined || initialBinder === undefined || pendingInitial === undefined) {
      throw new Error('Kovo dev runner generation origin cannot be bound in its current state.');
    }
    initialBinder(nextOrigin);
    assertGenerationCurrent(pendingInitial);
    origin = nextOrigin;
    const generation = pendingInitial;
    initialActivation = (async () => {
      try {
        await hooks!.validate(generation.moduleServer);
        assertGenerationCurrent(generation);
        if (closed) {
          await closeGeneration(generation);
          return;
        }
        pendingInitial = undefined;
        initialBinder = undefined;
        swapGeneration(generation);
      } catch (cause) {
        pendingInitial = undefined;
        initialBinder = undefined;
        await closeGeneration(generation);
        throw cause;
      }
    })();
  };

  const activateInitial = async (): Promise<void> => {
    const activation = initialActivation;
    if (activation === undefined) {
      throw new Error('Kovo dev runner generation origin is not bound.');
    }
    await activation;
    if (active === undefined) {
      throw new Error('Kovo dev initial runner generation did not become active.');
    }
  };

  const stage = (token?: object): Promise<void> => {
    if (closed) {
      return nativePromiseReject(new Error('Kovo dev runner generation broker is closed.'));
    }
    if (token !== undefined) {
      const prior = nativeReflectApply(nativeWeakMapGet, stagesByToken, [token]) as
        | Promise<void>
        | undefined;
      if (prior !== undefined) return prior;
    }
    requestedRevision += 1;
    const revision = requestedRevision;
    const run = async (): Promise<void> => {
      await activateInitial();
      if (closed) throw new Error('Kovo dev runner generation broker is closed.');
      // Vite invalidates the shared transform graph before invoking handleHotUpdate. Repeating a
      // global invalidation here would widen the race for a draining old runner that performs a
      // late dynamic import. Exact graph identity is still attested at configure/stage boundaries;
      // the fresh evaluated cache consumes Vite's already-current transforms.
      assertEnvironmentCurrent();
      const generation = createGeneration();
      try {
        await validateGeneration(generation);
        // Candidate code is attacker-capable. Re-attest every authority after its last async
        // evaluation boundary and before the single active-pointer swap.
        assertGenerationCurrent(generation);
        if (closed || revision !== requestedRevision) {
          await closeGeneration(generation);
          return;
        }
        swapGeneration(generation);
      } catch (cause) {
        await closeGeneration(generation);
        if (closed || revision !== requestedRevision) return;
        throw cause;
      }
    };
    const pending = nativeReflectApply(nativePromiseThen, stageTail, [run, run]) as Promise<void>;
    stageTail = nativeReflectApply(nativePromiseCatch, pending, [() => undefined]) as Promise<void>;
    if (token !== undefined) nativeReflectApply(nativeWeakMapSet, stagesByToken, [token, pending]);
    return pending;
  };

  const withLease = async <T>(
    operation: (server: KovoDevRunnerModuleServer) => Promise<T>,
  ): Promise<T> => {
    if (typeof operation !== 'function') {
      throw new TypeError('Kovo dev runner lease requires an operation.');
    }
    if (closed) throw new Error('Kovo dev runner generation broker is closed.');
    await activateInitial();
    if (closed) throw new Error('Kovo dev runner generation broker is closed.');
    const generation = active;
    if (generation === undefined || generation.retired) {
      throw new Error('Kovo dev runner generation is unavailable.');
    }
    generation.refs += 1;
    try {
      return await operation(generation.moduleServer);
    } finally {
      try {
        // The request/devtool callback may execute arbitrary app code after its last import.
        // Never let a poisoned Vite authority survive the lease boundary unnoticed.
        assertGenerationCurrent(generation);
      } finally {
        generation.refs -= 1;
        if (generation.refs === 0 && generation.drainResolve !== undefined) {
          generation.drainResolve();
          generation.drainResolve = undefined;
        }
        if (generation.refs === 0 && generation.retired) await closeGeneration(generation);
      }
    }
  };

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    requestedRevision += 1;
    await stageTail;
    const activation = initialActivation;
    if (activation !== undefined) {
      await (nativeReflectApply(nativePromiseCatch, activation, [
        () => undefined,
      ]) as Promise<void>);
    }
    if (pendingInitial !== undefined) {
      retireGeneration(pendingInitial);
      pendingInitial = undefined;
    }
    if (active !== undefined) {
      retireGeneration(active);
      active = undefined;
    }
    for (let index = 0; index < generations.length; index += 1) {
      const generation = generations[index]!;
      generation.retired = true;
      if (generation.refs > 0 && generation.drainPromise === undefined) {
        generation.drainPromise = new NativePromise<void>((resolve) => {
          generation.drainResolve = resolve;
        });
      }
    }
    for (let index = 0; index < generations.length; index += 1) {
      const generation = generations[index]!;
      if (generation.drainPromise !== undefined) await generation.drainPromise;
      await closeGeneration(generation);
    }
    if (closeFailures.length > 0) {
      throw new Error('Kovo dev runner generation close failed.', {
        cause: closeFailures[0],
      });
    }
  };

  return nativeObjectFreeze({
    activateInitial,
    bindOrigin,
    close,
    configure,
    prepareInitial,
    stage,
    withLease,
  });
}

function ssrEnvironment(server: unknown, label: string): ViteRunnableEnvironment {
  const environments = ownObject(server, 'environments', `${label}.environments`);
  const environment = ownObject(
    environments,
    'ssr',
    `${label}.environments.ssr`,
  ) as unknown as ViteRunnableEnvironment;
  return environment;
}

function ownObject(source: unknown, key: PropertyKey, label: string): object {
  if (typeof source !== 'object' || source === null) {
    throw new TypeError(`${label} must be an object.`);
  }
  const descriptor = nativeObjectGetOwnPropertyDescriptor(source, key);
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'object' ||
    descriptor.value === null
  ) {
    throw new TypeError(`${label} must be an own data object.`);
  }
  return descriptor.value;
}

function ownFunction(source: unknown, key: PropertyKey, label: string): Function {
  if ((typeof source !== 'object' || source === null) && typeof source !== 'function') {
    throw new TypeError(`${label} owner must be an object.`);
  }
  const descriptor = nativeObjectGetOwnPropertyDescriptor(source, key);
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'function'
  ) {
    // ESM namespace bindings may be exposed as accessors; the namespace itself was imported at
    // bootstrap, so a fixed-name read is the authority while later identity is still attested.
    const value = nativeReflectGet(source, key);
    if (typeof value === 'function') return value;
    throw new TypeError(`${label} must be a function.`);
  }
  return descriptor.value;
}

function ownDataFunction(source: object, key: PropertyKey, label: string): Function {
  const descriptor = nativeObjectGetOwnPropertyDescriptor(source, key);
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'function'
  ) {
    throw new TypeError(`${label} must be an own data function.`);
  }
  return descriptor.value;
}

function descriptorOwner(source: object, key: PropertyKey, label: string): object {
  let current: object | null = source;
  while (current !== null) {
    if (nativeObjectGetOwnPropertyDescriptor(current, key) !== undefined) return current;
    current = nativeObjectGetPrototypeOf(current);
  }
  throw new TypeError(`${label} is missing.`);
}

function getterWitness(source: object, key: PropertyKey, label: string): GetterWitness {
  const owner = descriptorOwner(source, key, label);
  const descriptor = nativeObjectGetOwnPropertyDescriptor(owner, key);
  if (descriptor === undefined || typeof descriptor.get !== 'function') {
    throw new TypeError(`${label} must be an accessor getter.`);
  }
  return nativeObjectFreeze({ get: descriptor.get, key, owner });
}

function methodWitness(source: object, key: PropertyKey, label: string): MethodWitness {
  const owner = descriptorOwner(source, key, label);
  const descriptor = nativeObjectGetOwnPropertyDescriptor(owner, key);
  if (
    descriptor === undefined ||
    !('value' in descriptor) ||
    typeof descriptor.value !== 'function'
  ) {
    throw new TypeError(`${label} must be a prototype method.`);
  }
  return nativeObjectFreeze({ key, owner, value: descriptor.value });
}

function assertGetter(source: object, witness: GetterWitness, label: string): void {
  const owner = descriptorOwner(source, witness.key, label);
  const descriptor = nativeObjectGetOwnPropertyDescriptor(owner, witness.key);
  if (owner !== witness.owner || descriptor === undefined || descriptor.get !== witness.get) {
    throw new TypeError(`${label} identity does not match the Kovo bootstrap authority.`);
  }
}

function assertMethod(source: object, witness: MethodWitness, label: string): void {
  const owner = descriptorOwner(source, witness.key, label);
  const descriptor = nativeObjectGetOwnPropertyDescriptor(owner, witness.key);
  if (
    owner !== witness.owner ||
    descriptor === undefined ||
    !('value' in descriptor) ||
    descriptor.value !== witness.value
  ) {
    throw new TypeError(`${label} identity does not match the Kovo bootstrap authority.`);
  }
}
