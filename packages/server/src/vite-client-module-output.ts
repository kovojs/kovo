import type { KovoAppShellBuiltClientModule } from './vite-build.js';
import { viteDistSourcePath } from './vite-build-assets.js';
import { writeArtifactOutput } from './output-staging.js';

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

  await writeArtifactOutput(root, writes.map(kovoAppShellViteArtifactOutputEntry), {
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
  await writeArtifactOutput(root, writes.map(kovoAppShellViteArtifactOutputEntry), {
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
  return kovoAppShellViteClientModuleWrites(root, modules).map((write) => ({
    path: write.path,
    targetPath: write.targetPath,
  }));
}

function kovoAppShellViteClientModuleWrites(
  root: string,
  modules: readonly KovoAppShellBuiltClientModule[],
): KovoAppShellViteClientModuleWrite[] {
  return modules.map((module) => ({
    path: module.path,
    source: module.source,
    targetPath: viteDistSourcePath(root, module.file),
  }));
}

function assertNoKovoAppShellViteClientModuleWriteConflicts(
  writes: readonly KovoAppShellViteClientModuleWrite[],
): void {
  const seen = new Set<string>();

  for (const write of writes) {
    if (seen.has(write.targetPath)) {
      throw new Error(
        `App shell Vite build output cannot write duplicate client module target: ${write.targetPath}`,
      );
    }

    seen.add(write.targetPath);
  }
}

function kovoAppShellViteArtifactOutputEntry(write: KovoAppShellViteClientModuleWrite) {
  return {
    content: write.source,
    label: write.path,
    targetPath: write.targetPath,
  };
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
