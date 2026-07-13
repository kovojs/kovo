import {
  compilerArrayAppend,
  compilerArrayIsArray,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateRegExp,
  compilerFreeze,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerRegExpReplace,
  compilerSnapshotJsonValue,
  compilerStringReplaceAll,
} from './compiler-security-intrinsics.js';
import { escapeAttribute } from './shared.js';
import type { CompileResult, ComponentGraphFact, EmittedFile } from './types.js';

const PAGE_RESULT_ARRAY_PROPERTIES = ['componentGraphFacts', 'cssAssets', 'files'] as const;

/**
 * Compose the compiled component artifacts that co-exist on one rendered page, rewriting duplicate
 * DOM leaves to stable registry-key `kovo-c` values. This is the page-composition half of SPEC
 * §4.2's DOM-leaf collision rule; per-component compilation keeps the short leaf until this pass
 * proves a page actually contains a collision.
 */
export function composePageComponentArtifacts(results: readonly CompileResult[]): CompileResult[] {
  const snapshot = snapshotPageCompileResults(results);
  const facts: ComponentGraphFact[] = [];
  const resultCount = compilerArrayLength(snapshot, 'Page composition compile results');
  for (let resultIndex = 0; resultIndex < resultCount; resultIndex += 1) {
    const result = compilerOwnDataValue(
      snapshot,
      resultIndex,
      'Page composition compile results',
    ) as CompileResult;
    appendPageComponentFacts(facts, result.componentGraphFacts);
  }
  const effectiveNames = effectiveDomNamesForPage(facts);
  const composed: CompileResult[] = [];

  for (let resultIndex = 0; resultIndex < resultCount; resultIndex += 1) {
    const result = compilerOwnDataValue(
      snapshot,
      resultIndex,
      'Page composition compile results',
    ) as CompileResult;
    const fact = compilerOwnDataValue(
      result.componentGraphFacts,
      0,
      `Page composition compile results[${resultIndex}].componentGraphFacts`,
    ) as ComponentGraphFact | undefined;
    if (fact === undefined || fact.domName === undefined) {
      compilerArrayAppend(composed, result, 'Page composition output');
      continue;
    }

    const domName = fact.domName;
    const effectiveName = compilerMapGet(effectiveNames, fact.name);
    if (effectiveName === undefined || effectiveName === domName) {
      compilerArrayAppend(composed, result, 'Page composition output');
      continue;
    }

    const rewritten = {
      ...result,
      componentGraphFacts: rewriteComponentGraphFacts(
        result.componentGraphFacts,
        fact.name,
        effectiveName,
      ),
      cssAssets: rewriteComponentCssAssets(result.cssAssets, domName, effectiveName),
      files: rewriteEmittedFiles(result.files, domName, effectiveName),
      loweredSource:
        result.loweredSource === null
          ? null
          : rewriteHostIdentity(result.loweredSource, domName, effectiveName),
    };
    compilerArrayAppend(
      composed,
      compilerSnapshotJsonValue(
        rewritten,
        `Page composition output[${resultIndex}]`,
      ) as CompileResult,
      'Page composition output',
    );
  }

  return compilerFreeze(composed) as CompileResult[];
}

function snapshotPageCompileResults(results: readonly CompileResult[]): readonly CompileResult[] {
  const snapshot = compilerSnapshotJsonValue(
    results,
    'Page composition compile results',
  ) as unknown;
  if (!compilerArrayIsArray(snapshot)) {
    throw new TypeError('Page composition compile results must be an array.');
  }
  const resultCount = compilerArrayLength(snapshot, 'Page composition compile results');
  for (let resultIndex = 0; resultIndex < resultCount; resultIndex += 1) {
    const result = compilerOwnDataValue(snapshot, resultIndex, 'Page composition compile results');
    if (typeof result !== 'object' || result === null || compilerArrayIsArray(result)) {
      throw new TypeError(`Page composition compile results[${resultIndex}] must be an object.`);
    }
    const propertyCount = compilerArrayLength(
      PAGE_RESULT_ARRAY_PROPERTIES,
      'Page composition required array properties',
    );
    for (let propertyIndex = 0; propertyIndex < propertyCount; propertyIndex += 1) {
      const property = compilerOwnDataValue(
        PAGE_RESULT_ARRAY_PROPERTIES,
        propertyIndex,
        'Page composition required array properties',
      ) as (typeof PAGE_RESULT_ARRAY_PROPERTIES)[number];
      if (
        !compilerArrayIsArray(
          compilerOwnDataValue(
            result,
            property,
            `Page composition compile results[${resultIndex}]`,
          ),
        )
      ) {
        throw new TypeError(
          `Page composition compile results[${resultIndex}].${property} must be an array.`,
        );
      }
    }
    const loweredSource = compilerOwnDataValue(
      result,
      'loweredSource',
      `Page composition compile results[${resultIndex}]`,
    );
    if (loweredSource !== null && typeof loweredSource !== 'string') {
      throw new TypeError(
        `Page composition compile results[${resultIndex}].loweredSource must be a string or null.`,
      );
    }
  }
  return snapshot as unknown as readonly CompileResult[];
}

function appendPageComponentFacts(
  target: ComponentGraphFact[],
  facts: readonly ComponentGraphFact[],
): void {
  const count = compilerArrayLength(facts, 'Page composition component facts');
  for (let index = 0; index < count; index += 1) {
    const fact = compilerOwnDataValue(
      facts,
      index,
      'Page composition component facts',
    ) as ComponentGraphFact;
    if (
      typeof fact !== 'object' ||
      fact === null ||
      typeof fact.name !== 'string' ||
      (fact.domName !== undefined && typeof fact.domName !== 'string')
    ) {
      throw new TypeError(`Page composition component facts[${index}] is malformed.`);
    }
    compilerArrayAppend(target, fact, 'Page composition component facts');
  }
}

function effectiveDomNamesForPage(
  facts: readonly ComponentGraphFact[],
): ReadonlyMap<string, string> {
  const counts = compilerCreateMap<string, number>();
  const count = compilerArrayLength(facts, 'Page composition component facts');
  for (let index = 0; index < count; index += 1) {
    const fact = compilerOwnDataValue(
      facts,
      index,
      'Page composition component facts',
    ) as ComponentGraphFact;
    if (fact.domName === undefined) continue;
    compilerMapSet(counts, fact.domName, (compilerMapGet(counts, fact.domName) ?? 0) + 1);
  }

  const names = compilerCreateMap<string, string>();
  for (let index = 0; index < count; index += 1) {
    const fact = compilerOwnDataValue(
      facts,
      index,
      'Page composition component facts',
    ) as ComponentGraphFact;
    if (fact.domName === undefined) continue;
    compilerMapSet(
      names,
      fact.name,
      (compilerMapGet(counts, fact.domName) ?? 0) > 1 ? fact.name : fact.domName,
    );
  }
  return names;
}

function rewriteComponentGraphFacts(
  facts: readonly ComponentGraphFact[],
  componentName: string,
  effectiveName: string,
): ComponentGraphFact[] {
  const rewritten: ComponentGraphFact[] = [];
  const count = compilerArrayLength(facts, 'Page composition component facts');
  for (let index = 0; index < count; index += 1) {
    const fact = compilerOwnDataValue(
      facts,
      index,
      'Page composition component facts',
    ) as ComponentGraphFact;
    compilerArrayAppend(
      rewritten,
      fact.name === componentName ? { ...fact, disambiguatedDomName: effectiveName } : fact,
      'Page composition rewritten component facts',
    );
  }
  return rewritten;
}

function rewriteEmittedFiles(
  files: readonly EmittedFile[],
  domName: string,
  effectiveName: string,
): EmittedFile[] {
  const rewritten: EmittedFile[] = [];
  const count = compilerArrayLength(files, 'Page composition emitted files');
  for (let index = 0; index < count; index += 1) {
    const file = compilerOwnDataValue(
      files,
      index,
      'Page composition emitted files',
    ) as EmittedFile;
    if (
      typeof file !== 'object' ||
      file === null ||
      typeof file.fileName !== 'string' ||
      typeof file.kind !== 'string' ||
      typeof file.source !== 'string'
    ) {
      throw new TypeError(`Page composition emitted files[${index}] is malformed.`);
    }
    compilerArrayAppend(
      rewritten,
      rewriteEmittedFile(file, domName, effectiveName),
      'Page composition rewritten emitted files',
    );
  }
  return rewritten;
}

function rewriteComponentCssAssets(
  assets: CompileResult['cssAssets'],
  domName: string,
  effectiveName: string,
): CompileResult['cssAssets'] {
  const rewritten: CompileResult['cssAssets'][number][] = [];
  const count = compilerArrayLength(assets, 'Page composition CSS assets');
  for (let index = 0; index < count; index += 1) {
    const asset = compilerOwnDataValue(
      assets,
      index,
      'Page composition CSS assets',
    ) as CompileResult['cssAssets'][number];
    if (
      typeof asset !== 'object' ||
      asset === null ||
      typeof asset.componentName !== 'string' ||
      (asset.criticalCss !== undefined && typeof asset.criticalCss !== 'string')
    ) {
      throw new TypeError(`Page composition CSS assets[${index}] is malformed.`);
    }
    compilerArrayAppend(
      rewritten,
      {
        ...asset,
        componentName: effectiveName,
        ...(asset.criticalCss === undefined
          ? {}
          : { criticalCss: rewriteCssHostIdentity(asset.criticalCss, domName, effectiveName) }),
      },
      'Page composition rewritten CSS assets',
    );
  }
  return rewritten;
}

function rewriteEmittedFile(
  file: EmittedFile,
  domName: string,
  effectiveName: string,
): EmittedFile {
  if (file.kind === 'server') {
    return { ...file, source: rewriteHostIdentity(file.source, domName, effectiveName) };
  }
  if (file.kind === 'css') {
    return { ...file, source: rewriteCssHostIdentity(file.source, domName, effectiveName) };
  }
  return file;
}

function rewriteHostIdentity(source: string, domName: string, effectiveName: string): string {
  const existingStamp = compilerCreateRegExp(`(\\s+kovo-c=)(["'])${escapeRegExp(domName)}\\2`, 'g');
  const escapedEffectiveName = escapeAttribute(effectiveName);
  const rewritten = compilerRegExpReplace(
    existingStamp,
    source,
    (_match, prefix) => `${prefix}"${escapedEffectiveName}"`,
  );
  if (rewritten !== source) return rewritten;

  const hostOpening = compilerCreateRegExp(
    `<${escapeRegExp(domName)}(?=[\\s>/])(?!(?:(?!>).)*\\skovo-c=)`,
  );
  return compilerRegExpReplace(hostOpening, source, `<${domName} kovo-c="${escapedEffectiveName}"`);
}

function rewriteCssHostIdentity(source: string, domName: string, effectiveName: string): string {
  const oldAttributeSelector = `[kovo-c="${escapeAttribute(domName)}"]`;
  const newAttributeSelector = `[kovo-c="${escapeAttribute(effectiveName)}"]`;
  const attributeRewritten = compilerStringReplaceAll(
    source,
    oldAttributeSelector,
    newAttributeSelector,
  );

  const hostSelector = compilerCreateRegExp(
    `(^|[\\n{,(]\\s*)${escapeRegExp(domName)}(?=[\\s.#:[>),])`,
    'g',
  );
  return compilerRegExpReplace(
    hostSelector,
    attributeRewritten,
    (_match, prefix) => `${prefix}${newAttributeSelector}`,
  );
}

function escapeRegExp(value: string): string {
  return compilerRegExpReplace(/[.*+?^${}()|[\]\\]/g, value, (character) => `\\${character}`);
}
