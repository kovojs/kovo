import type { KovoAppShellBuiltClientModule } from './vite-build.js';
import { buildOwnDataProperty, snapshotBuildArray } from './build-security-intrinsics.js';
import { viteDistSourcePath } from './vite-build-assets.js';
import { writeArtifactOutput } from './output-staging.js';
import {
  createSecuritySet,
  securitySetAdd,
  securitySetHas,
} from './response-security-intrinsics.js';
import { witnessArrayAppend, witnessFreeze } from './security-witness-intrinsics.js';

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Planned immutable
 * /c/ module output target.
 */
export interface KovoAppShellViteClientModuleOutputPlanItem {
  path: string;
  targetPath: string;
}

interface KovoAppShellViteClientModuleWrite extends KovoAppShellViteClientModuleOutputPlanItem {
  source: string;
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Atomically writes
 * built client modules into the Vite output directory.
 */
export async function writeKovoAppShellViteClientModuleOutput(
  root: string,
  modules: readonly KovoAppShellBuiltClientModule[],
): Promise<void> {
  const writes = kovoAppShellViteClientModuleWrites(root, modules);

  // SPEC §9.5: production app-shell builds publish immutable /c/ modules
  // through one validated output commit, so export rejection never leaves partial files.
  assertNoKovoAppShellViteClientModuleWriteConflicts(writes);
  if (writes.length === 0) return;

  await writeArtifactOutput(root, kovoAppShellViteArtifactOutputEntries(writes), {
    diagnostics: kovoAppShellViteArtifactOutputDiagnostics(),
    stagingPrefix: '.kovo-vite-app-shell-',
  });
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Validates client
 * module output targets before static export writes begin.
 */
export async function assertWritableKovoAppShellViteClientModuleOutput(
  root: string,
  modules: readonly KovoAppShellBuiltClientModule[],
): Promise<void> {
  const writes = kovoAppShellViteClientModuleWrites(root, modules);

  // SPEC §9.5: plugin-time static export must not publish static-host files
  // until the matching Vite /c/ module output has proved its target boundary.
  assertNoKovoAppShellViteClientModuleWriteConflicts(writes);
  await writeArtifactOutput(root, kovoAppShellViteArtifactOutputEntries(writes), {
    diagnostics: kovoAppShellViteArtifactOutputDiagnostics(),
    mode: 'dry-run',
    validateTargets: true,
  });
}

/**
 * @internal App-shell Vite build pipeline internal (SPEC.md §9.5). Returns the dry-run
 * client module output plan for build/export evidence.
 */
export function kovoAppShellViteClientModuleOutputPlan(
  root: string,
  modules: readonly KovoAppShellBuiltClientModule[],
): KovoAppShellViteClientModuleOutputPlanItem[] {
  // SPEC §9.5: build hooks and static export tasks inspect the same immutable
  // /c/ module targets that the Vite app-shell output commit will publish.
  const writes = kovoAppShellViteClientModuleWrites(root, modules);
  const plan: KovoAppShellViteClientModuleOutputPlanItem[] = [];
  for (let index = 0; index < writes.length; index += 1) {
    const write = writes[index]!;
    witnessArrayAppend(
      plan,
      { path: write.path, targetPath: write.targetPath },
      'Server packages/server/src/vite-client-module-output.ts collection',
    );
  }
  return plan;
}

function kovoAppShellViteClientModuleWrites(
  root: string,
  modules: readonly KovoAppShellBuiltClientModule[],
): KovoAppShellViteClientModuleWrite[] {
  // SPEC §6.6: module registry review and output staging consume one pinned snapshot. A live
  // Array.prototype.map or module getter cannot swap executable source after build registration.
  const sourceModules = snapshotBuildArray(modules, 'built client modules');
  const writes: KovoAppShellViteClientModuleWrite[] = [];
  for (let index = 0; index < sourceModules.length; index += 1) {
    const module = sourceModules[index];
    if (typeof module !== 'object' || module === null) {
      throw new TypeError(`Built client module ${index} must be an object.`);
    }
    const path = requiredBuiltClientModuleString(module, 'path', index);
    const source = requiredBuiltClientModuleString(module, 'source', index);
    const file = requiredBuiltClientModuleString(module, 'file', index);
    witnessArrayAppend(
      writes,
      witnessFreeze({
        path,
        source,
        targetPath: viteDistSourcePath(root, file),
      }),
      'Server packages/server/src/vite-client-module-output.ts collection',
    );
  }
  return writes;
}

function requiredBuiltClientModuleString(
  module: object,
  field: 'file' | 'path' | 'source',
  index: number,
): string {
  const property = buildOwnDataProperty(module, field, `built client module ${index}.${field}`);
  if (!property.present || typeof property.value !== 'string') {
    throw new TypeError(`Built client module ${index}.${field} must be a string.`);
  }
  return property.value;
}

function assertNoKovoAppShellViteClientModuleWriteConflicts(
  writes: readonly KovoAppShellViteClientModuleWrite[],
): void {
  const seen = createSecuritySet<string>();

  for (let index = 0; index < writes.length; index += 1) {
    const write = writes[index]!;
    if (securitySetHas(seen, write.targetPath)) {
      throw new Error(
        `App shell Vite build output cannot write duplicate client module target: ${write.targetPath}`,
      );
    }

    securitySetAdd(seen, write.targetPath);
  }
}

function kovoAppShellViteArtifactOutputEntry(write: KovoAppShellViteClientModuleWrite) {
  return {
    content: write.source,
    label: write.path,
    targetPath: write.targetPath,
  };
}

function kovoAppShellViteArtifactOutputEntries(
  writes: readonly KovoAppShellViteClientModuleWrite[],
) {
  const entries: ReturnType<typeof kovoAppShellViteArtifactOutputEntry>[] = [];
  for (let index = 0; index < writes.length; index += 1) {
    witnessArrayAppend(
      entries,
      kovoAppShellViteArtifactOutputEntry(writes[index]!),
      'Server packages/server/src/vite-client-module-output.ts collection',
    );
  }
  return entries;
}

function kovoAppShellViteArtifactOutputDiagnostics() {
  return {
    target(_entry: { label: string }, reason: string): Error {
      const message = reason.replace(/^output parent /, 'parent ');
      return new Error(
        `App shell Vite build output cannot write client module because ${message}.`,
      );
    },
  };
}
