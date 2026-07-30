import {
  compilerOwnedViteClientModuleRole,
  compilerViteClientModuleRoleProtocol,
  type CompilerOwnedViteClientModuleRole as CompilerGraphClientModuleRole,
} from '@kovojs/compiler/internal';
import { clientModuleRepresentationDigest } from '@kovojs/core/internal/client-module-url';

import { buildOwnDataProperty } from './build-security-intrinsics.js';
import {
  compilerOwnedClientModuleRole,
  type CompilerOwnedViteClientModuleRole,
  pinCompilerOwnedClientModuleRole,
} from './compiler-client-module-provenance.js';
import {
  createWitnessMap,
  createWitnessWeakMap,
  witnessFreeze,
  witnessMapGet,
  witnessMapSet,
  witnessWeakMapGet,
  witnessWeakMapSet,
} from './security-witness-intrinsics.js';

let compilerClientModuleBuildInstallerClaimed = false;
type CompilerRoleVocabularyMatchesServer = [CompilerGraphClientModuleRole] extends [
  CompilerOwnedViteClientModuleRole,
]
  ? [CompilerOwnedViteClientModuleRole] extends [CompilerGraphClientModuleRole]
    ? true
    : false
  : false;
const compilerRoleVocabularyMatchesServer: CompilerRoleVocabularyMatchesServer = true;

/** @internal SSR-owned snapshot adopted from one native-CLI-authenticated compiler record. */
export interface CompilerClientModuleBuildRecord {
  readonly path: string;
  readonly renderPlanFingerprint: string;
  readonly source: string;
}

/** @internal One-shot role-specific adoption capability claimed before authored app load. */
export interface CompilerClientModuleBuildInstaller {
  adoptAppBootstrap(module: object): CompilerClientModuleBuildRecord;
  adoptComponentClient(module: object): CompilerClientModuleBuildRecord;
  adoptDeferredAppRuntime(module: object): CompilerClientModuleBuildRecord;
  adoptOptimisticPlan(module: object): CompilerClientModuleBuildRecord;
  seal(): void;
}

/**
 * @internal Claim the isolated-build adopter before any authored app module is evaluated.
 *
 * Compiler WeakMap identity cannot cross Vite's native-CLI/SSR module-graph boundary. The native
 * CLI authenticates each exact final record and invokes only the matching role method. This
 * capability synchronously snapshots it into an SSR-owned frozen record, pins that returned
 * identity in the server WeakMap, rejects duplicate/conflicting adoption, and seals before write.
 */
export function claimCompilerClientModuleBuildInstaller(
  protocol: string,
): CompilerClientModuleBuildInstaller {
  if (!compilerRoleVocabularyMatchesServer || protocol !== compilerViteClientModuleRoleProtocol) {
    throw new TypeError(
      `Kovo compiler client-module build protocol must be ${compilerViteClientModuleRoleProtocol}.`,
    );
  }
  if (compilerClientModuleBuildInstallerClaimed) {
    throw new Error('Kovo compiler client-module build installer was already claimed.');
  }
  compilerClientModuleBuildInstallerClaimed = true;
  const roleByIdentity = createWitnessMap<string, CompilerOwnedViteClientModuleRole>();
  const roleBySource = createWitnessWeakMap<object, CompilerOwnedViteClientModuleRole>();
  let failed = false;
  let sealed = false;
  const adopt = (
    module: object,
    role: CompilerOwnedViteClientModuleRole,
  ): CompilerClientModuleBuildRecord => {
    if (failed) {
      throw new Error('Kovo compiler client-module build installation is permanently closed.');
    }
    if (sealed) {
      throw new Error('Kovo compiler client-module build installation is already sealed.');
    }
    try {
      const priorSourceRole = witnessWeakMapGet(roleBySource, module);
      if (priorSourceRole !== undefined) {
        throw new TypeError(
          priorSourceRole === role
            ? 'Kovo compiler client-module build record was installed twice.'
            : 'Kovo compiler client-module build record has conflicting roles.',
        );
      }
      const path = requiredCompilerClientModuleBuildString(module, 'path');
      const renderPlanFingerprint = requiredCompilerClientModuleBuildString(
        module,
        'renderPlanFingerprint',
      );
      const source = requiredCompilerClientModuleBuildString(module, 'source');
      const identity = `${path}\u0000${clientModuleRepresentationDigest(source)}\u0000${renderPlanFingerprint}`;
      const priorIdentityRole = witnessMapGet(roleByIdentity, identity);
      if (priorIdentityRole !== undefined) {
        throw new TypeError(
          priorIdentityRole === role
            ? 'Kovo compiler client-module build identity was installed twice.'
            : 'Kovo compiler client-module build identity has conflicting roles.',
        );
      }
      const adopted = witnessFreeze({ path, renderPlanFingerprint, source });
      pinCompilerOwnedClientModuleRole(adopted, role);
      witnessWeakMapSet(roleBySource, module, role);
      witnessMapSet(roleByIdentity, identity, role);
      return adopted;
    } catch (cause) {
      failed = true;
      throw cause;
    }
  };
  return witnessFreeze({
    adoptAppBootstrap(module: object): CompilerClientModuleBuildRecord {
      return adopt(module, 'app-bootstrap');
    },
    adoptComponentClient(module: object): CompilerClientModuleBuildRecord {
      return adopt(module, 'component-client');
    },
    adoptDeferredAppRuntime(module: object): CompilerClientModuleBuildRecord {
      return adopt(module, 'deferred-app-runtime');
    },
    adoptOptimisticPlan(module: object): CompilerClientModuleBuildRecord {
      return adopt(module, 'optimistic-plan');
    },
    seal(): void {
      if (failed) {
        throw new Error('Kovo compiler client-module build installation is permanently closed.');
      }
      if (sealed) {
        throw new Error('Kovo compiler client-module build installation is already sealed.');
      }
      sealed = true;
    },
  });
}

/**
 * @internal Carry genuine compiler identity through a server-owned defensive snapshot.
 *
 * This is the only server module that imports the compiler verifier. Production app and generated
 * handler graphs consume the runtime-only provenance leaf instead, so TypeScript cannot become a
 * retained server dependency. The role remains out-of-band: spreading, serializing, proxying, or
 * reconstructing `pinned` cannot copy this WeakMap membership.
 */
export function pinCompilerOwnedClientModule<Value extends object>(
  source: unknown,
  pinned: Value,
): Value {
  const compilerRole = compilerOwnedViteClientModuleRole(source);
  const serverRole = compilerOwnedClientModuleRole(source);
  if (compilerRole !== undefined && serverRole !== undefined && compilerRole !== serverRole) {
    throw new TypeError('Kovo compiler client-module provenance has conflicting roles.');
  }
  const role = serverRole ?? compilerRole;
  return role === undefined ? pinned : pinCompilerOwnedClientModuleRole(pinned, role);
}

function requiredCompilerClientModuleBuildString(
  module: object,
  field: 'path' | 'renderPlanFingerprint' | 'source',
): string {
  const property = buildOwnDataProperty(
    module,
    field,
    `compiler client-module build record.${field}`,
  );
  if (!property.present || typeof property.value !== 'string') {
    throw new TypeError(`Kovo compiler client-module build record.${field} must be a string.`);
  }
  return property.value;
}
