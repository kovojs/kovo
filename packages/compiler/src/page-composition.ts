import { escapeAttribute } from './shared.js';
import type { CompileResult, ComponentGraphFact, EmittedFile } from './types.js';

/**
 * Compose the compiled component artifacts that co-exist on one rendered page, rewriting duplicate
 * DOM leaves to stable registry-key `kovo-c` values. This is the page-composition half of SPEC
 * §4.2's DOM-leaf collision rule; per-component compilation keeps the short leaf until this pass
 * proves a page actually contains a collision.
 */
export function composePageComponentArtifacts(results: readonly CompileResult[]): CompileResult[] {
  const effectiveNames = effectiveDomNamesForPage(
    results.flatMap((result) => result.componentGraphFacts),
  );

  return results.map((result) => {
    const fact = result.componentGraphFacts[0];
    if (!fact?.domName) return result;

    const domName = fact.domName;
    const effectiveName = effectiveNames.get(fact.name);
    if (!effectiveName || effectiveName === domName) return result;

    const rewrittenFiles = result.files.map((file) =>
      rewriteEmittedFile(file, domName, effectiveName),
    );
    const rewrittenCssAssets = result.cssAssets.map((asset) => ({
      ...asset,
      componentName: effectiveName,
      ...(asset.criticalCss
        ? {
            criticalCss: rewriteCssHostIdentity(
              asset.criticalCss,
              domName,
              effectiveName,
            ),
          }
        : {}),
    }));

    return {
      ...result,
      componentGraphFacts: result.componentGraphFacts.map((componentFact) =>
        componentFact.name === fact.name
          ? { ...componentFact, disambiguatedDomName: effectiveName }
          : componentFact,
      ),
      cssAssets: rewrittenCssAssets,
      files: rewrittenFiles,
      loweredSource:
        result.loweredSource === null
          ? null
          : rewriteHostIdentity(result.loweredSource, domName, effectiveName),
    };
  });
}

function effectiveDomNamesForPage(facts: readonly ComponentGraphFact[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const fact of facts) {
    if (!fact.domName) continue;
    counts.set(fact.domName, (counts.get(fact.domName) ?? 0) + 1);
  }

  const names = new Map<string, string>();
  for (const fact of facts) {
    if (!fact.domName) continue;
    names.set(fact.name, (counts.get(fact.domName) ?? 0) > 1 ? fact.name : fact.domName);
  }
  return names;
}

function rewriteEmittedFile(file: EmittedFile, domName: string, effectiveName: string): EmittedFile {
  if (file.kind === 'server') {
    return { ...file, source: rewriteHostIdentity(file.source, domName, effectiveName) };
  }
  if (file.kind === 'css') {
    return { ...file, source: rewriteCssHostIdentity(file.source, domName, effectiveName) };
  }
  return file;
}

function rewriteHostIdentity(source: string, domName: string, effectiveName: string): string {
  const existingStamp = new RegExp(
    `(\\s+kovo-c=)(["'])${escapeRegExp(domName)}\\2`,
    'g',
  );
  const rewritten = source.replace(
    existingStamp,
    `$1"${escapeAttribute(effectiveName)}"`,
  );
  if (rewritten !== source) return rewritten;

  const hostOpening = new RegExp(
    `<${escapeRegExp(domName)}(?=[\\s>/])(?!(?:(?!>).)*\\skovo-c=)`,
  );
  return source.replace(hostOpening, `<${domName} kovo-c="${escapeAttribute(effectiveName)}"`);
}

function rewriteCssHostIdentity(source: string, domName: string, effectiveName: string): string {
  const oldAttributeSelector = `[kovo-c="${escapeAttribute(domName)}"]`;
  const newAttributeSelector = `[kovo-c="${escapeAttribute(effectiveName)}"]`;
  const attributeRewritten = source.replaceAll(oldAttributeSelector, newAttributeSelector);

  const hostSelector = new RegExp(
    `(^|[\\n{,(]\\s*)${escapeRegExp(domName)}(?=[\\s.#:[>),])`,
    'g',
  );
  return attributeRewritten.replace(hostSelector, `$1${newAttributeSelector}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
