import {
  browserPostureManifestSchema,
  browserSecurityOperationKinds,
  type BrowserPostureExternalOrigin,
  type BrowserPostureIsolationBlocker,
  type BrowserPostureManifest,
  type BrowserPostureOpaqueExternalUrl,
  type BrowserSecurityOperationKind,
} from '@kovojs/core/internal/security-operation-ir';

import { canonicalJson } from './canonical-json.js';
import { compileComponentModule } from './compile.js';
import {
  compilerArrayAppend,
  compilerArrayLength,
  compilerCreateSet,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetHas,
  compilerSnapshotDenseArray,
  compilerStringEndsWith,
  compilerStringLocaleCompare,
  compilerStringToLowerCase,
} from './compiler-security-intrinsics.js';
import type { CompileComponentOptions } from './types.js';

/** @internal Immutable source carrier used by supported build/dev posture derivation. */
export interface BrowserPostureSourceFile {
  readonly fileName: string;
  readonly source: string;
}

/**
 * Compile every project source through the ordinary component pipeline and merge its browser
 * posture. Supported runners call this before app evaluation and serialize the result into the
 * generated runtime registry (SPEC §2/§4.8/§6.6).
 *
 * @internal
 */
export function deriveBrowserPostureManifestFromSourceFiles(
  files: readonly BrowserPostureSourceFile[],
): BrowserPostureManifest {
  const sourceFiles = compilerSnapshotDenseArray(files, 'Browser posture project files');
  const manifests: BrowserPostureManifest[] = [];
  for (let index = 0; index < sourceFiles.length; index += 1) {
    const file = sourceFiles[index]!;
    const normalizedFileName = compilerStringToLowerCase(file.fileName);
    if (
      !compilerStringEndsWith(normalizedFileName, '.tsx') &&
      !compilerStringEndsWith(normalizedFileName, '.jsx')
    ) {
      continue;
    }
    const extraFiles: BrowserPostureSourceFile[] = [];
    for (let candidateIndex = 0; candidateIndex < sourceFiles.length; candidateIndex += 1) {
      if (candidateIndex === index) continue;
      compilerArrayAppend(
        extraFiles,
        sourceFiles[candidateIndex]!,
        'Browser posture project identity files',
      );
    }
    const result = compileComponentModule({
      extraFiles,
      fileName: file.fileName,
      source: file.source,
      sourceProvenance: 'app',
    } as CompileComponentOptions);
    let blocking: (typeof result.diagnostics)[number] | undefined;
    const diagnosticSnapshot = compilerSnapshotDenseArray(
      result.diagnostics,
      'Browser posture compiler diagnostics',
    );
    for (
      let diagnosticIndex = 0;
      diagnosticIndex < diagnosticSnapshot.length;
      diagnosticIndex += 1
    ) {
      const diagnostic = diagnosticSnapshot[diagnosticIndex]!;
      // A browser-posture manifest is a positive build proof, so it must never be assembled from
      // a component whose output-context verdict is already closed. Some execution/isolation
      // positions are owned by the shared finite KV236 classifier rather than duplicating a second
      // browser-posture diagnostic; both owners block manifest generation (SPEC §2/§4.8).
      if (diagnostic.code === 'KV236') {
        blocking = diagnostic;
        break;
      }
    }
    if (blocking !== undefined) {
      throw new TypeError(
        `Browser posture derivation failed closed: ${blocking.fileName ?? file.fileName} ${blocking.code} ${blocking.message}`,
      );
    }
    compilerArrayAppend(
      manifests,
      result.browserPostureManifest,
      'Browser posture project manifests',
    );
  }
  return mergeBrowserPostureManifests(manifests);
}

/** @internal Deterministically merge per-module posture carriers without dropping source spans. */
export function mergeBrowserPostureManifests(
  manifests: readonly BrowserPostureManifest[],
): BrowserPostureManifest {
  const externalOrigins: BrowserPostureExternalOrigin[] = [];
  const isolationBlockers: BrowserPostureIsolationBlocker[] = [];
  const opaqueExternalUrls: BrowserPostureOpaqueExternalUrl[] = [];
  const operations = compilerCreateSet<BrowserSecurityOperationKind>();
  const seenExternal = compilerCreateSet<string>();
  const seenOpaque = compilerCreateSet<string>();
  const seenBlockers = compilerCreateSet<string>();
  const snapshot = compilerSnapshotDenseArray(manifests, 'Browser posture manifests');
  for (let index = 0; index < snapshot.length; index += 1) {
    const manifest = snapshot[index]!;
    if (manifest.schema !== browserPostureManifestSchema) {
      throw new TypeError('Browser posture manifest schema mismatch.');
    }
    appendUniqueFacts(externalOrigins, seenExternal, manifest.externalOrigins);
    appendUniqueFacts(opaqueExternalUrls, seenOpaque, manifest.opaqueExternalUrls);
    appendUniqueFacts(isolationBlockers, seenBlockers, manifest.isolationBlockers);
    const operationSnapshot = compilerSnapshotDenseArray(
      manifest.operations,
      'Browser posture manifest operations',
    );
    for (let operationIndex = 0; operationIndex < operationSnapshot.length; operationIndex += 1) {
      compilerSetAdd(operations, operationSnapshot[operationIndex]!);
    }
  }
  const orderedOperations: BrowserSecurityOperationKind[] = [];
  const kindsLength = compilerArrayLength(
    browserSecurityOperationKinds,
    'Browser security operation kinds',
  );
  for (let index = 0; index < kindsLength; index += 1) {
    const kind = compilerOwnDataValue(
      browserSecurityOperationKinds,
      index,
      'Browser security operation kinds',
    ) as BrowserSecurityOperationKind;
    if (compilerSetHas(operations, kind)) {
      compilerArrayAppend(orderedOperations, kind, 'Browser posture merged operations');
    }
  }
  return {
    externalOrigins: sortBrowserPostureFacts(externalOrigins),
    isolationBlockers: sortBrowserPostureFacts(isolationBlockers),
    opaqueExternalUrls: sortBrowserPostureFacts(opaqueExternalUrls),
    operations: orderedOperations,
    schema: browserPostureManifestSchema,
  };
}

function sortBrowserPostureFacts<Value>(values: readonly Value[]): Value[] {
  const sorted = compilerSnapshotDenseArray(values, 'Browser posture sorted merged facts');
  for (let index = 1; index < sorted.length; index += 1) {
    const value = sorted[index]!;
    const identity = canonicalJson(value);
    let insertion = index;
    while (
      insertion > 0 &&
      compilerStringLocaleCompare(canonicalJson(sorted[insertion - 1]!), identity) > 0
    ) {
      sorted[insertion] = sorted[insertion - 1]!;
      insertion -= 1;
    }
    sorted[insertion] = value;
  }
  return sorted;
}

function appendUniqueFacts<Value>(
  target: Value[],
  seen: Set<string>,
  values: readonly Value[],
): void {
  const snapshot = compilerSnapshotDenseArray(values, 'Browser posture merge facts');
  for (let index = 0; index < snapshot.length; index += 1) {
    const value = snapshot[index]!;
    const key = canonicalJson(value);
    if (compilerSetHas(seen, key)) continue;
    compilerSetAdd(seen, key);
    compilerArrayAppend(target, value, 'Browser posture merged facts');
  }
}
