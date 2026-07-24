import { securityClassifier } from '@kovojs/core/internal/security-markers';

import {
  compilerArrayLength,
  compilerCreateMap,
  compilerFailClosed,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
} from './compiler-security-intrinsics.js';
import { headlessUiClientExecutableImports } from './generated/headless-ui-client-executables.js';

export type ClientHandlerImportKind =
  | 'commonjs'
  | 'default'
  | 'dynamic'
  | 'import-equals'
  | 'named'
  | 'namespace'
  | 'type-only';

export interface ReviewedClientHandlerCallSummary {
  readonly eventArgument?: number;
  readonly maxArguments: number;
  readonly minArguments: number;
  readonly returnKind: 'plain-data';
}

const GENERATED_HEADLESS_HANDLER_MODULE = '@kovojs/headless-ui/generated';
const reviewedClientHandlerImportTargets = compilerCreateMap<string, string>();
const reviewedCanonicalClientHandlerImportTargets = compilerCreateMap<string, string>();
const reviewedCanonicalClientHandlerCallSummaries = compilerCreateMap<
  string,
  ReviewedClientHandlerCallSummary
>();

registerReviewedClientHandlerImport('@kovojs/core', 'publishToClient', '@kovojs/core');
registerReviewedCanonicalClientHandlerImport('@kovojs/core', 'publishToClient', '@kovojs/core');

const headlessEntryLength = compilerArrayLength(
  headlessUiClientExecutableImports,
  'Generated Headless UI client-handler imports',
);
for (let entryIndex = 0; entryIndex < headlessEntryLength; entryIndex += 1) {
  const entry = compilerOwnDataValue(
    headlessUiClientExecutableImports,
    entryIndex,
    'Generated Headless UI client-handler imports',
  ) as (typeof headlessUiClientExecutableImports)[number] | undefined;
  if (!entry || typeof entry !== 'object' || typeof entry.moduleSpecifier !== 'string') {
    compilerFailClosed(
      `Generated Headless UI client-handler imports[${entryIndex}] must be an own entry.`,
    );
  }
  const importedNameLength = compilerArrayLength(
    entry.importedNames,
    `Generated Headless UI client-handler imports[${entryIndex}] names`,
  );
  for (let nameIndex = 0; nameIndex < importedNameLength; nameIndex += 1) {
    const importedName = compilerOwnDataValue(
      entry.importedNames,
      nameIndex,
      `Generated Headless UI client-handler imports[${entryIndex}] names`,
    );
    if (typeof importedName !== 'string') {
      compilerFailClosed(
        `Generated Headless UI client-handler imports[${entryIndex}] names[${nameIndex}] must be a string.`,
      );
    }
    registerReviewedClientHandlerImport(
      entry.moduleSpecifier,
      importedName,
      GENERATED_HEADLESS_HANDLER_MODULE,
    );
    registerReviewedCanonicalClientHandlerImport(
      '@kovojs/headless-ui',
      importedName,
      GENERATED_HEADLESS_HANDLER_MODULE,
    );
  }
  const summaries = entry.summaries;
  const summaryLength = compilerArrayLength(
    summaries,
    `Generated Headless UI client-handler imports[${entryIndex}] summaries`,
  );
  if (summaryLength !== importedNameLength) {
    compilerFailClosed(
      `Generated Headless UI client-handler imports[${entryIndex}] summary count must match its names.`,
    );
  }
  for (let summaryIndex = 0; summaryIndex < summaryLength; summaryIndex += 1) {
    const summary = compilerOwnDataValue(
      summaries,
      summaryIndex,
      `Generated Headless UI client-handler imports[${entryIndex}] summaries`,
    );
    const exportName = compilerOwnDataValue(summary, 'exportName', 'Reviewed call summary');
    const eventArgument = compilerOwnDataValue(summary, 'eventArgument', 'Reviewed call summary');
    const maxArguments = compilerOwnDataValue(summary, 'maxArguments', 'Reviewed call summary');
    const minArguments = compilerOwnDataValue(summary, 'minArguments', 'Reviewed call summary');
    const returnKind = compilerOwnDataValue(summary, 'returnKind', 'Reviewed call summary');
    if (
      typeof exportName !== 'string' ||
      typeof maxArguments !== 'number' ||
      maxArguments < 0 ||
      maxArguments % 1 !== 0 ||
      (eventArgument !== undefined &&
        (typeof eventArgument !== 'number' ||
          eventArgument < 0 ||
          eventArgument % 1 !== 0 ||
          eventArgument >= maxArguments)) ||
      typeof minArguments !== 'number' ||
      minArguments < 0 ||
      minArguments % 1 !== 0 ||
      minArguments > maxArguments ||
      returnKind !== 'plain-data'
    ) {
      compilerFailClosed('Generated Headless UI call summary must be exact finite data.');
    }
    const expectedName = compilerOwnDataValue(
      entry.importedNames,
      summaryIndex,
      `Generated Headless UI client-handler imports[${entryIndex}] names`,
    );
    if (exportName !== expectedName) {
      compilerFailClosed(
        `Generated Headless UI client-handler imports[${entryIndex}] summary ordering is stale.`,
      );
    }
    const key = clientHandlerImportKey('@kovojs/headless-ui', exportName);
    if (compilerMapGet(reviewedCanonicalClientHandlerCallSummaries, key) !== undefined) {
      compilerFailClosed(`Duplicate canonical client-handler call summary ${exportName}.`);
    }
    compilerMapSet(reviewedCanonicalClientHandlerCallSummaries, key, {
      ...(eventArgument === undefined ? {} : { eventArgument }),
      maxArguments,
      minArguments,
      returnKind,
    });
  }
}

function registerReviewedCanonicalClientHandlerImport(
  moduleName: string,
  importedName: string,
  emittedModuleSpecifier: string,
): void {
  const key = clientHandlerImportKey(moduleName, importedName);
  if (compilerMapGet(reviewedCanonicalClientHandlerImportTargets, key) !== undefined) {
    compilerFailClosed(
      `Duplicate canonical client-handler import identity ${moduleName}#${importedName}.`,
    );
  }
  compilerMapSet(reviewedCanonicalClientHandlerImportTargets, key, emittedModuleSpecifier);
}

function registerReviewedClientHandlerImport(
  moduleSpecifier: string,
  importedName: string,
  emittedModuleSpecifier: string,
): void {
  const key = clientHandlerImportKey(moduleSpecifier, importedName);
  if (compilerMapGet(reviewedClientHandlerImportTargets, key) !== undefined) {
    compilerFailClosed(
      `Duplicate reviewed client-handler import identity ${moduleSpecifier}#${importedName}.`,
    );
  }
  compilerMapSet(reviewedClientHandlerImportTargets, key, emittedModuleSpecifier);
}

function clientHandlerImportKey(moduleSpecifier: string, importedName: string): string {
  return `${moduleSpecifier}\0${importedName}`;
}

/**
 * Return the compiler-owned browser target for one exact authored import identity.
 *
 * SPEC §5.2: generated handlers never treat a relative module, bare package, package prefix,
 * default/namespace binding, or dynamic loader as browser-safe merely because it is called. An
 * `publishToClient(value, { reason })` cannot authorize any import: its separate literal-data
 * channel accepts only pristine same-file const primitives and never widens this registry.
 */
export const reviewedClientHandlerImportTarget = securityClassifier(
  'compiler.client-handler-import.reviewed-target',
  function (
    moduleSpecifier: string,
    importedName: string,
    kind: ClientHandlerImportKind,
  ): string | undefined {
    if (kind !== 'named') return undefined;
    return compilerMapGet(
      reviewedClientHandlerImportTargets,
      clientHandlerImportKey(moduleSpecifier, importedName),
    );
  },
);

/** Resolve a provenance-traced framework identity, including a reviewed local re-export chain. */
export const reviewedCanonicalClientHandlerImportTarget = securityClassifier(
  'compiler.client-handler-import.reviewed-canonical-target',
  function (moduleName: string, importedName: string): string | undefined {
    return compilerMapGet(
      reviewedCanonicalClientHandlerImportTargets,
      clientHandlerImportKey(moduleName, importedName),
    );
  },
);

/** Resolve the generated, positional finite-call contract for one exact framework export. */
export const reviewedCanonicalClientHandlerCallSummary = securityClassifier(
  'compiler.client-handler-import.reviewed-call-summary',
  function (
    moduleName: string,
    importedName: string,
  ): ReviewedClientHandlerCallSummary | undefined {
    return compilerMapGet(
      reviewedCanonicalClientHandlerCallSummaries,
      clientHandlerImportKey(moduleName, importedName),
    );
  },
);
