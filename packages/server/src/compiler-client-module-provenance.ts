import {
  compilerOwnedViteClientModuleRole,
  type CompilerOwnedViteClientModuleRole,
} from '@kovojs/compiler/internal';

import {
  createFrameworkAsyncContextCell,
  currentFrameworkAsyncContextValue,
  runWithFrameworkAsyncContext,
} from './async-context.js';
import {
  witnessArrayAppend,
  createWitnessWeakMap,
  createWitnessWeakSet,
  witnessFreeze,
  witnessWeakMapGet,
  witnessWeakMapSet,
  witnessWeakSetAdd,
  witnessWeakSetHas,
} from './security-witness-intrinsics.js';

const pinnedCompilerClientModuleRoles = createWitnessWeakMap<
  object,
  CompilerOwnedViteClientModuleRole
>();
let generatedBuildInstallerClaimed = false;
interface GeneratedBuildClientModuleScope {
  modules: readonly object[];
  renderPlanFingerprint: string;
}
const generatedBuildClientModuleContext =
  createFrameworkAsyncContextCell<GeneratedBuildClientModuleScope>(
    'server.generated-build-client-modules',
  );
const consumedGeneratedBuildClientModuleScopes =
  createWitnessWeakSet<GeneratedBuildClientModuleScope>();

/** @internal One-shot role-specific mint available only to the generated handler before app load. */
export interface GeneratedBuildClientModuleInstaller {
  appBootstrap(module: object): void;
  componentClient(module: object): void;
  deferredAppRuntime(module: object): void;
  load<Value>(renderPlanFingerprint: string, load: () => Value): Value;
  manual(module: object): void;
  optimisticPlan(module: object): void;
}

/**
 * @internal Claim the generated-handler installer before any authored app module is evaluated.
 *
 * The generated entry claims this once at the top of its boot sequence. Authored modules load
 * afterward and therefore cannot open another role-minting window.
 */
export function claimGeneratedBuildClientModuleInstaller(): GeneratedBuildClientModuleInstaller {
  if (generatedBuildInstallerClaimed) {
    throw new Error('Kovo generated build client-module installer was already claimed.');
  }
  generatedBuildInstallerClaimed = true;
  const modules: object[] = [];
  let sealed = false;
  const stage = (module: object, role: CompilerOwnedViteClientModuleRole): void => {
    if (sealed) {
      throw new Error('Kovo generated build client-module registration is already sealed.');
    }
    pinGeneratedBuildClientModule(module, role);
    witnessArrayAppend(modules, module, 'Generated build client modules');
  };
  const stageManual = (module: object): void => {
    if (sealed) {
      throw new Error('Kovo generated build client-module registration is already sealed.');
    }
    witnessArrayAppend(modules, module, 'Generated build manual client modules');
  };
  return witnessFreeze({
    appBootstrap(module: object): void {
      stage(module, 'app-bootstrap');
    },
    componentClient(module: object): void {
      stage(module, 'component-client');
    },
    deferredAppRuntime(module: object): void {
      stage(module, 'deferred-app-runtime');
    },
    load<Value>(renderPlanFingerprint: string, load: () => Value): Value {
      if (sealed) {
        throw new Error('Kovo generated build client-module registration is already sealed.');
      }
      if (typeof renderPlanFingerprint !== 'string' || typeof load !== 'function') {
        throw new TypeError('Kovo generated build client-module load requires pinned inputs.');
      }
      sealed = true;
      const scope = witnessFreeze({
        modules: witnessFreeze(modules),
        renderPlanFingerprint,
      });
      return runWithFrameworkAsyncContext(generatedBuildClientModuleContext, scope, load);
    },
    manual(module: object): void {
      stageManual(module);
    },
    optimisticPlan(module: object): void {
      stage(module, 'optimistic-plan');
    },
  });
}

/**
 * @internal Consume the sealed generated snapshot once while the authored app graph is importing.
 */
export function takeGeneratedBuildClientModuleSnapshot():
  | GeneratedBuildClientModuleScope
  | undefined {
  const scope = currentFrameworkAsyncContextValue(generatedBuildClientModuleContext);
  if (scope === undefined || witnessWeakSetHas(consumedGeneratedBuildClientModuleScopes, scope)) {
    return undefined;
  }
  witnessWeakSetAdd(consumedGeneratedBuildClientModuleScopes, scope);
  return scope;
}

/**
 * @internal Carry genuine compiler identity through server-owned defensive snapshots.
 *
 * The role remains out-of-band: spreading, serializing, proxying, or reconstructing `pinned`
 * cannot copy this WeakMap membership.
 */
export function pinCompilerOwnedClientModule<Value extends object>(
  source: unknown,
  pinned: Value,
): Value {
  const role = compilerOwnedClientModuleRole(source);
  if (role !== undefined) witnessWeakMapSet(pinnedCompilerClientModuleRoles, pinned, role);
  return pinned;
}

/** @internal Verify either an exact compiler record or a server-pinned copy of one. */
export function compilerOwnedClientModuleRole(
  value: unknown,
): CompilerOwnedViteClientModuleRole | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return (
    compilerOwnedViteClientModuleRole(value) ??
    witnessWeakMapGet(pinnedCompilerClientModuleRoles, value)
  );
}

function pinGeneratedBuildClientModule<Value extends object>(
  module: Value,
  role: CompilerOwnedViteClientModuleRole,
): Value {
  witnessWeakMapSet(pinnedCompilerClientModuleRoles, module, role);
  return module;
}

export type { CompilerOwnedViteClientModuleRole };
