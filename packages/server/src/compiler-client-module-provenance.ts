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

/**
 * @internal Server-owned mirror of the finite compiler role vocabulary.
 *
 * Keep this runtime leaf independent of `@kovojs/compiler`: emitted handlers consume only
 * generated, role-specific registrations, while the build-only bridge authenticates genuine
 * compiler records before pinning their defensive server snapshots.
 */
export type CompilerOwnedViteClientModuleRole =
  | 'app-bootstrap'
  | 'component-client'
  | 'deferred-app-runtime'
  | 'optimistic-plan';

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

/** @internal Pin a role already authenticated by the build bridge or generated-entry protocol. */
export function pinCompilerOwnedClientModuleRole<Value extends object>(
  pinned: Value,
  role: CompilerOwnedViteClientModuleRole,
): Value {
  witnessWeakMapSet(pinnedCompilerClientModuleRoles, pinned, role);
  return pinned;
}

/** @internal Verify an exact server-pinned compiler or generated-entry record. */
export function compilerOwnedClientModuleRole(
  value: unknown,
): CompilerOwnedViteClientModuleRole | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return witnessWeakMapGet(pinnedCompilerClientModuleRoles, value);
}

function pinGeneratedBuildClientModule<Value extends object>(
  module: Value,
  role: CompilerOwnedViteClientModuleRole,
): Value {
  return pinCompilerOwnedClientModuleRole(module, role);
}
