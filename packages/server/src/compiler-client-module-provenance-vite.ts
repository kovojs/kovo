import type { CompilerOwnedViteClientModuleRole as CompilerGraphClientModuleRole } from '@kovojs/compiler/internal';
import { clientModuleRepresentationDigest } from '@kovojs/core/internal/client-module-url';

import { buildOwnDataProperty, snapshotBuildArray } from './build-security-intrinsics.js';
import {
  type CompilerOwnedViteClientModuleRole,
  pinCompilerOwnedClientModuleRole,
} from './compiler-client-module-provenance.js';
import {
  createWitnessMap,
  createWitnessWeakMap,
  witnessArrayAppend,
  witnessFreeze,
  witnessGetOwnPropertyDescriptor,
  witnessMapGet,
  witnessMapSet,
  witnessReflectApply,
  witnessReflectGet,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

type CompilerRoleVocabularyMatchesServer = [CompilerGraphClientModuleRole] extends [
  CompilerOwnedViteClientModuleRole,
]
  ? [CompilerOwnedViteClientModuleRole] extends [CompilerGraphClientModuleRole]
    ? true
    : false
  : false;
const compilerRoleVocabularyMatchesServer: CompilerRoleVocabularyMatchesServer = true;

type CompilerClientModuleRoleVerifier = (
  value: unknown,
) => CompilerOwnedViteClientModuleRole | undefined;
type CompilerDiagnosticVerifier = (value: unknown) => boolean;

interface CompilerClientModuleViteHandoffState {
  failed: boolean;
  readonly verifyDiagnostic: CompilerDiagnosticVerifier;
  readonly verifyRole: CompilerClientModuleRoleVerifier;
}

/** @internal Live-SSR-owned snapshot returned only to the bootstrap-side handoff. */
export interface CompilerClientModuleViteRecord {
  readonly path: string;
  readonly renderPlanFingerprint: string;
  readonly source: string;
}

/** @internal One synchronous snapshot transaction in the live SSR graph. */
export interface CompilerClientModuleViteSnapshotInstaller {
  adoptAppBootstrap(module: object): CompilerClientModuleViteRecord;
  adoptComponentClient(module: object): CompilerClientModuleViteRecord;
  adoptDeferredAppRuntime(module: object): CompilerClientModuleViteRecord;
  adoptOptimisticPlan(module: object): CompilerClientModuleViteRecord;
  seal(): readonly CompilerClientModuleViteRecord[];
}

/** @internal One-shot live-graph capability claimed before any authored app module is evaluated. */
export interface CompilerClientModuleViteInstaller {
  begin(): CompilerClientModuleViteSnapshotInstaller;
}

interface CompilerClientModuleViteInstallerState {
  active: boolean;
  failed: boolean;
  readonly roleByIdentity: Map<string, CompilerOwnedViteClientModuleRole>;
  readonly roleBySource: WeakMap<object, CompilerOwnedViteClientModuleRole>;
}

const compilerClientModuleViteHandoffs = createWitnessWeakMap<
  object,
  CompilerClientModuleViteHandoffState
>();
let compilerClientModuleViteInstallerClaimed = false;
/** @internal Exact protocol shared with the isolated compiler role vocabulary. */
export const compilerClientModuleViteProtocol = 'kovo.compiler-client-module-role/v1' as const;
/** @internal Fresh identity for one live SSR module epoch. */
export const compilerClientModuleViteEpoch = witnessFreeze({});

/**
 * @internal Create a bootstrap-private adapter around the standalone compiler `/vite` verifiers.
 *
 * The returned frozen identity has no methods or structural authority. It remains in the trusted
 * Vite security profile captured before authored config evaluation (SPEC §2 / §5.2 / §6.6).
 */
export function createCompilerClientModuleViteHandoff(
  verifyRole: CompilerClientModuleRoleVerifier,
  verifyDiagnostic: CompilerDiagnosticVerifier,
): object {
  if (
    !compilerRoleVocabularyMatchesServer ||
    typeof verifyRole !== 'function' ||
    typeof verifyDiagnostic !== 'function'
  ) {
    throw new TypeError('Kovo Vite compiler provenance handoff requires its pinned verifiers.');
  }
  const handoff = witnessFreeze({});
  witnessWeakMapSet(compilerClientModuleViteHandoffs, handoff, {
    failed: false,
    verifyDiagnostic,
    verifyRole,
  });
  return handoff;
}

/**
 * @internal Claim the live SSR graph's role-specific installer before dispatch loads the app.
 *
 * The holder is one-shot per live graph, but it can begin multiple synchronous snapshots as Vite
 * publishes new compiler generations. Any failed transaction permanently closes the holder.
 */
export function claimCompilerClientModuleViteInstaller(
  protocol: string,
): CompilerClientModuleViteInstaller {
  if (protocol !== compilerClientModuleViteProtocol) {
    throw new TypeError(
      `Kovo Vite compiler client-module protocol must be ${compilerClientModuleViteProtocol}.`,
    );
  }
  if (compilerClientModuleViteInstallerClaimed) {
    throw new Error('Kovo Vite compiler client-module installer was already claimed.');
  }
  compilerClientModuleViteInstallerClaimed = true;
  const state: CompilerClientModuleViteInstallerState = {
    active: false,
    failed: false,
    roleByIdentity: createWitnessMap<string, CompilerOwnedViteClientModuleRole>(),
    roleBySource: createWitnessWeakMap<object, CompilerOwnedViteClientModuleRole>(),
  };
  return witnessFreeze({
    begin(): CompilerClientModuleViteSnapshotInstaller {
      if (state.failed) {
        throw new Error('Kovo Vite compiler client-module installer is permanently closed.');
      }
      if (state.active) {
        state.failed = true;
        throw new Error(
          'Kovo Vite compiler client-module installer already has an active snapshot.',
        );
      }
      state.active = true;
      return createLiveCompilerClientModuleSnapshotInstaller(state);
    },
  });
}

/**
 * @internal Bootstrap-side transfer into the already-claimed live SSR installer.
 *
 * Every exact raw record is first authenticated against the one genuine standalone plugin. Only
 * then is the matching role method invoked; the returned values are live-graph-owned frozen
 * snapshots and the native records never cross into app dispatch.
 */
export function installCompilerClientModulesFromViteHandoff(
  handoff: unknown,
  installer: CompilerClientModuleViteInstaller,
  source: unknown,
): readonly CompilerClientModuleViteRecord[] {
  const handoffState = compilerClientModuleViteHandoffState(handoff);
  if (handoffState.failed) {
    throw new Error('Kovo Vite compiler provenance handoff is permanently closed.');
  }
  try {
    const modules = requiredDenseCompilerClientModuleArray(source);
    const roles: CompilerOwnedViteClientModuleRole[] = [];
    const roleByIdentity = createWitnessMap<
      string,
      { readonly fingerprint: string; readonly role: CompilerOwnedViteClientModuleRole }
    >();
    const roleBySource = createWitnessWeakMap<object, CompilerOwnedViteClientModuleRole>();
    for (let index = 0; index < modules.length; index += 1) {
      const module = modules[index]!;
      const role = handoffState.verifyRole(module);
      if (role === undefined) {
        throw new TypeError(
          'Kovo Vite compiler client module was not minted by its bound genuine plugin.',
        );
      }
      const priorSourceRole = witnessWeakMapGet(roleBySource, module);
      if (priorSourceRole !== undefined) {
        throw new TypeError(
          priorSourceRole === role
            ? 'Kovo Vite compiler client-module handoff repeated one exact record.'
            : 'Kovo Vite compiler client-module handoff observed conflicting roles.',
        );
      }
      const path = requiredCompilerClientModuleString(module, 'path');
      const moduleSource = requiredCompilerClientModuleString(module, 'source');
      const fingerprint = requiredCompilerClientModuleString(module, 'renderPlanFingerprint');
      const identity = `${path}\u0000${clientModuleRepresentationDigest(moduleSource)}`;
      const priorIdentity = witnessMapGet(roleByIdentity, identity);
      if (priorIdentity !== undefined) {
        throw new TypeError(
          priorIdentity.role === role && priorIdentity.fingerprint === fingerprint
            ? 'Kovo Vite compiler client-module handoff repeated one representation.'
            : 'Kovo Vite compiler client-module handoff observed role or fingerprint drift.',
        );
      }
      witnessWeakMapSet(roleBySource, module, role);
      witnessMapSet(roleByIdentity, identity, { fingerprint, role });
      witnessArrayAppend(roles, role, 'Vite compiler client-module handoff roles');
    }

    const begin = requiredInstallerMethod(installer, 'begin');
    const transaction = witnessReflectApply<CompilerClientModuleViteSnapshotInstaller>(
      begin,
      installer,
      [],
    );
    for (let index = 0; index < modules.length; index += 1) {
      adoptCompilerClientModuleByRole(transaction, modules[index]!, roles[index]!);
    }
    const seal = requiredInstallerMethod(transaction, 'seal');
    return witnessReflectApply<readonly CompilerClientModuleViteRecord[]>(seal, transaction, []);
  } catch (cause) {
    handoffState.failed = true;
    throw cause;
  }
}

/**
 * @internal Build the bootstrap-only callback invoked immediately after the live app-shell module
 * loads and before its dispatcher can load authored app code. One installer is claimed per exact
 * live-module claim function and then reused for later HMR snapshots in that graph.
 */
export function createCompilerClientModuleViteSnapshotPreparer(
  handoff: object,
  clientModules: () => unknown,
): (serverModule: object) => () => readonly CompilerClientModuleViteRecord[] {
  const handoffState = compilerClientModuleViteHandoffState(handoff);
  if (typeof clientModules !== 'function') {
    throw new TypeError('Kovo Vite compiler client-module getter must be a function.');
  }
  const bindings = createWitnessWeakMap<
    object,
    {
      readonly claim: (...args: never[]) => unknown;
      readonly getter: () => readonly CompilerClientModuleViteRecord[];
    }
  >();
  const prepare = (serverModule: object): (() => readonly CompilerClientModuleViteRecord[]) => {
    if (handoffState.failed) {
      throw new Error('Kovo Vite compiler provenance handoff is permanently closed.');
    }
    try {
      const claim = viteModuleExportValue(
        serverModule,
        'claimCompilerClientModuleViteInstaller',
        'Kovo Vite live compiler module claim',
      );
      if (typeof claim !== 'function') {
        throw new TypeError('Kovo Vite live compiler module claim must be a function.');
      }
      const epoch = viteModuleExportValue(
        serverModule,
        'compilerClientModuleViteEpoch',
        'Kovo Vite live compiler module epoch',
      );
      if (typeof epoch !== 'object' || epoch === null) {
        throw new TypeError('Kovo Vite live compiler module epoch must be an object.');
      }
      const prior = witnessWeakMapGet(bindings, epoch);
      if (prior !== undefined) {
        if (prior.claim !== claim) {
          throw new TypeError('Kovo Vite live compiler module claim identity drifted.');
        }
        return prior.getter;
      }
      const installer = witnessReflectApply<CompilerClientModuleViteInstaller>(
        claim,
        serverModule,
        [compilerClientModuleViteProtocol],
      );
      const rawGetter = () =>
        installCompilerClientModulesFromViteHandoff(
          handoff,
          installer,
          witnessReflectApply<unknown>(clientModules, undefined, []),
        );
      const getter = witnessFreeze(rawGetter) as typeof rawGetter;
      witnessWeakMapSet(bindings, epoch, { claim, getter });
      return getter;
    } catch (cause) {
      handoffState.failed = true;
      throw cause;
    }
  };
  return witnessFreeze(prepare) as typeof prepare;
}

/** @internal True only for an exact diagnostic emitted by the handoff's bound `/vite` plugin. */
export function compilerDiagnosticBelongsToViteHandoff(
  handoff: unknown,
  diagnostic: unknown,
): boolean {
  const state = compilerClientModuleViteHandoffState(handoff);
  if (state.failed) {
    throw new Error('Kovo Vite compiler provenance handoff is permanently closed.');
  }
  try {
    if (!state.verifyDiagnostic(diagnostic)) {
      throw new TypeError(
        'Kovo Vite compiler diagnostic was not emitted by its bound genuine plugin.',
      );
    }
    return true;
  } catch (cause) {
    state.failed = true;
    throw cause;
  }
}

function viteModuleExportValue(source: object, property: PropertyKey, label: string): unknown {
  // Vite owns SSR namespace proxies and exposes their live bindings as accessors. The supported
  // CLI loads this fixed framework module outside authored resolve/load/transform hooks, so the
  // same fixed-name read used by vite-dev is the honest namespace boundary (SPEC §6.6 rule 6).
  if (witnessGetOwnPropertyDescriptor(source, property) === undefined) {
    throw new TypeError(`${label} must be an own module export.`);
  }
  return witnessReflectGet(source, property);
}

function createLiveCompilerClientModuleSnapshotInstaller(
  installerState: CompilerClientModuleViteInstallerState,
): CompilerClientModuleViteSnapshotInstaller {
  const adopted: CompilerClientModuleViteRecord[] = [];
  let sealed = false;
  const adopt = (
    module: object,
    role: CompilerOwnedViteClientModuleRole,
  ): CompilerClientModuleViteRecord => {
    if (installerState.failed) {
      throw new Error('Kovo Vite compiler client-module installer is permanently closed.');
    }
    if (sealed || !installerState.active) {
      installerState.failed = true;
      throw new Error('Kovo Vite compiler client-module snapshot is already sealed.');
    }
    try {
      const priorSourceRole = witnessWeakMapGet(installerState.roleBySource, module);
      if (priorSourceRole !== undefined && priorSourceRole !== role) {
        throw new TypeError('Kovo Vite compiler client-module record has conflicting roles.');
      }
      const path = requiredCompilerClientModuleString(module, 'path');
      const renderPlanFingerprint = requiredCompilerClientModuleString(
        module,
        'renderPlanFingerprint',
      );
      const source = requiredCompilerClientModuleString(module, 'source');
      const identity = `${path}\u0000${clientModuleRepresentationDigest(source)}\u0000${renderPlanFingerprint}`;
      const priorIdentityRole = witnessMapGet(installerState.roleByIdentity, identity);
      if (priorIdentityRole !== undefined && priorIdentityRole !== role) {
        throw new TypeError('Kovo Vite compiler client-module identity has conflicting roles.');
      }
      const pinned = witnessFreeze({ path, renderPlanFingerprint, source });
      pinCompilerOwnedClientModuleRole(pinned, role);
      witnessWeakMapSet(installerState.roleBySource, module, role);
      witnessMapSet(installerState.roleByIdentity, identity, role);
      witnessArrayAppend(adopted, pinned, 'Vite live compiler client-module snapshots');
      return pinned;
    } catch (cause) {
      installerState.failed = true;
      installerState.active = false;
      throw cause;
    }
  };
  return witnessFreeze({
    adoptAppBootstrap(module: object) {
      return adopt(module, 'app-bootstrap');
    },
    adoptComponentClient(module: object) {
      return adopt(module, 'component-client');
    },
    adoptDeferredAppRuntime(module: object) {
      return adopt(module, 'deferred-app-runtime');
    },
    adoptOptimisticPlan(module: object) {
      return adopt(module, 'optimistic-plan');
    },
    seal(): readonly CompilerClientModuleViteRecord[] {
      if (installerState.failed) {
        throw new Error('Kovo Vite compiler client-module installer is permanently closed.');
      }
      if (sealed || !installerState.active) {
        installerState.failed = true;
        throw new Error('Kovo Vite compiler client-module snapshot is already sealed.');
      }
      sealed = true;
      installerState.active = false;
      return witnessFreeze(adopted);
    },
  });
}

function adoptCompilerClientModuleByRole(
  installer: CompilerClientModuleViteSnapshotInstaller,
  module: object,
  role: CompilerOwnedViteClientModuleRole,
): CompilerClientModuleViteRecord {
  switch (role) {
    case 'app-bootstrap':
      return invokeAdopter(installer, 'adoptAppBootstrap', module);
    case 'component-client':
      return invokeAdopter(installer, 'adoptComponentClient', module);
    case 'deferred-app-runtime':
      return invokeAdopter(installer, 'adoptDeferredAppRuntime', module);
    case 'optimistic-plan':
      return invokeAdopter(installer, 'adoptOptimisticPlan', module);
    default:
      return assertUnknownCompilerClientModuleRole(role);
  }
}

function invokeAdopter(
  installer: CompilerClientModuleViteSnapshotInstaller,
  method:
    | 'adoptAppBootstrap'
    | 'adoptComponentClient'
    | 'adoptDeferredAppRuntime'
    | 'adoptOptimisticPlan',
  module: object,
): CompilerClientModuleViteRecord {
  return witnessReflectApply<CompilerClientModuleViteRecord>(
    requiredInstallerMethod(installer, method),
    installer,
    [module],
  );
}

function requiredDenseCompilerClientModuleArray(value: unknown): object[] {
  const source = snapshotBuildArray(value as readonly unknown[], 'Vite compiler client modules');
  const modules: object[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const module = source[index];
    if (typeof module !== 'object' || module === null) {
      throw new TypeError(`Kovo Vite compiler client modules[${index}] must be an own object.`);
    }
    witnessArrayAppend(modules, module, 'Vite compiler client-module handoff records');
  }
  return modules;
}

function requiredInstallerMethod<Installer extends object, Method extends keyof Installer>(
  installer: Installer,
  method: Method,
): Extract<Installer[Method], (...args: never[]) => unknown> {
  const property = buildOwnDataProperty(installer, method, 'Kovo Vite compiler installer');
  if (!property.present || typeof property.value !== 'function') {
    throw new TypeError(`Kovo Vite compiler installer.${String(method)} must be a function.`);
  }
  return property.value as Extract<Installer[Method], (...args: never[]) => unknown>;
}

function requiredCompilerClientModuleString(
  module: object,
  field: 'path' | 'renderPlanFingerprint' | 'source',
): string {
  const property = buildOwnDataProperty(module, field, `compiler client-module record.${field}`);
  if (!property.present || typeof property.value !== 'string') {
    throw new TypeError(`Kovo Vite compiler client-module record.${field} must be a string.`);
  }
  return property.value;
}

function compilerClientModuleViteHandoffState(
  handoff: unknown,
): CompilerClientModuleViteHandoffState {
  if (typeof handoff !== 'object' || handoff === null) {
    throw new TypeError('Kovo Vite compiler provenance handoff is not authentic.');
  }
  const state = witnessWeakMapGet(compilerClientModuleViteHandoffs, handoff);
  if (state === undefined) {
    throw new TypeError('Kovo Vite compiler provenance handoff is not authentic.');
  }
  return state;
}

function assertUnknownCompilerClientModuleRole(role: never): never {
  throw new TypeError(`Kovo Vite compiler client module has unknown role ${String(role)}.`);
}
