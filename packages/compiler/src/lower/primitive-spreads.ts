import { literalStringValue } from '../scan/object.js';
import type { ComponentModuleModel, JsxElementModel, ObjectLiteralEntry } from '../scan/parse.js';
import { escapeAttribute, type SourceReplacement } from '../shared.js';
import type { CompilerDiagnostic } from '../diagnostics.js';
import {
  authorJsxAttributes,
  mergePrimitiveAndAuthorAttributes,
  primitiveIdRewrite,
  primitiveObjectEntryAttributes,
  renderMergedAttributes,
  rewritePrimitiveIdrefAttributes,
  type MergeableAttribute,
} from './attribute-merge.js';

export interface PrimitiveSpreadLowering {
  diagnostics: readonly CompilerDiagnostic[];
  replacements: readonly SourceReplacement[];
}

export function lowerPrimitiveAttributeSpreads(
  model: ComponentModuleModel,
  options: { fileName: string; source: string },
): PrimitiveSpreadLowering {
  const diagnostics: CompilerDiagnostic[] = [];
  const replacements: SourceReplacement[] = [];
  const compositions = primitiveCompositionPatches(model, options);
  const compositionByWrapper = new Map(
    compositions.map((composition) => [composition.wrapper, composition] as const),
  );

  for (const element of model.jsxElements) {
    const composition = compositionByWrapper.get(element);
    if (composition) {
      replacements.push(...composition.replacements);
      diagnostics.push(...composition.diagnostics);
      continue;
    }

    for (const spread of element.spreadAttributes) {
      if (!spread.objectEntries) continue;

      const attributes = spreadObjectAttributes(spread.objectEntries);
      if (attributes === null) continue;

      replacements.push({
        end: spread.end,
        replacement: attributes,
        start: spread.start,
      });
    }
  }

  return { diagnostics, replacements };
}

interface PrimitiveCompositionPatch {
  diagnostics: readonly CompilerDiagnostic[];
  replacements: readonly SourceReplacement[];
  wrapper: JsxElementModel;
}

function primitiveCompositionPatches(
  model: ComponentModuleModel,
  options: { fileName: string; source: string },
): PrimitiveCompositionPatch[] {
  const candidates = primitiveCompositionCandidates(model);
  const rewrites = primitiveIdRewrites(candidates);
  return candidates.map((candidate) =>
    unwrapPrimitiveWrapper(
      candidate.wrapper,
      candidate.child,
      rewritePrimitiveIdrefAttributes(candidate.primitiveAttributes, rewrites),
      candidate.authorAttributes,
      options,
    ),
  );
}

interface PrimitiveCompositionCandidate {
  authorAttributes: readonly MergeableAttribute[];
  child: JsxElementModel;
  primitiveAttributes: readonly MergeableAttribute[];
  wrapper: JsxElementModel;
}

function primitiveCompositionCandidates(
  model: ComponentModuleModel,
): PrimitiveCompositionCandidate[] {
  const candidates: PrimitiveCompositionCandidate[] = [];

  for (const element of model.jsxElements) {
    const candidate = primitiveCompositionCandidate(model, element);
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

function primitiveCompositionCandidate(
  model: ComponentModuleModel,
  element: JsxElementModel,
): PrimitiveCompositionCandidate | null {
  if (!isComponentTag(element.tag)) return null;

  const attrs = element.attributes.find(
    (attribute) => attribute.name === 'attrs',
  )?.expressionObjectEntries;
  if (!attrs) return null;

  const primitiveAttributes = primitiveObjectEntryAttributes(attrs);
  if (primitiveAttributes === null) return null;

  const child = element.attributes.some((attribute) => attribute.name === 'asChild')
    ? singleImmediateChildElement(model, element)
    : singleAttrsFunctionChildElement(model, element);
  if (!child || childHasUnsupportedSpreads(child)) return null;

  return {
    authorAttributes: authorJsxAttributes(child.attributes),
    child,
    primitiveAttributes,
    wrapper: element,
  };
}

function primitiveIdRewrites(
  candidates: readonly PrimitiveCompositionCandidate[],
): ReadonlyMap<string, string> {
  return new Map(
    candidates.flatMap((candidate) => {
      const rewrite = primitiveIdRewrite(candidate.primitiveAttributes, candidate.authorAttributes);
      return rewrite ? [rewrite] : [];
    }),
  );
}

function unwrapPrimitiveWrapper(
  wrapper: JsxElementModel,
  child: JsxElementModel,
  primitiveAttributes: readonly MergeableAttribute[],
  authorAttributes: readonly MergeableAttribute[],
  options: { fileName: string; source: string },
): PrimitiveCompositionPatch {
  const merge = mergePrimitiveAndAuthorAttributes(primitiveAttributes, authorAttributes, options);
  const attributes = renderMergedAttributes(merge.attributes);

  return {
    diagnostics: merge.diagnostics,
    replacements: [
      { end: wrapper.openingEnd, replacement: '', start: wrapper.start },
      { end: wrapper.end, replacement: '', start: wrapper.closingStart },
      childAttributeReplacement(child, attributes),
      ...wrapper.childExpressionContainers.flatMap((container) =>
        child.start > container.start && child.end < container.end
          ? [
              { end: child.start, replacement: '', start: container.start },
              { end: container.end, replacement: '', start: child.end },
            ]
          : [],
      ),
    ],
    wrapper,
  };
}

function singleImmediateChildElement(
  model: ComponentModuleModel,
  wrapper: JsxElementModel,
): JsxElementModel | null {
  if (wrapper.childNonWhitespaceCount !== 1) return null;

  const children = model.jsxElements.filter(
    (candidate) =>
      candidate !== wrapper &&
      candidate.ancestorTags[0] === wrapper.tag &&
      candidate.start >= wrapper.openingEnd &&
      candidate.end <= wrapper.closingStart,
  );
  return children.length === 1 ? (children[0] ?? null) : null;
}

function singleAttrsFunctionChildElement(
  model: ComponentModuleModel,
  wrapper: JsxElementModel,
): JsxElementModel | null {
  if (wrapper.childExpressionContainers.length !== 1) return null;

  const container = wrapper.childExpressionContainers[0];
  if (!container) return null;

  const children = model.jsxElements.filter(
    (candidate) =>
      candidate !== wrapper &&
      candidate.start > container.start &&
      candidate.end < container.end &&
      candidate.spreadAttributes.some((spread) => spread.expressionBareIdentifierName === 'attrs'),
  );
  return children.length === 1 ? (children[0] ?? null) : null;
}

function childHasUnsupportedSpreads(element: JsxElementModel): boolean {
  return element.spreadAttributes.some((spread) => spread.expressionBareIdentifierName !== 'attrs');
}

function childAttributeReplacement(
  element: JsxElementModel,
  attributes: string,
): SourceReplacement {
  const end = element.selfClosing ? element.openingEnd - 2 : element.openingEnd - 1;
  const replacement = attributes
    ? element.selfClosing
      ? ` ${attributes} `
      : ` ${attributes}`
    : element.selfClosing && element.selfClosingSlashHasLeadingWhitespace
      ? ' '
      : '';

  return {
    end,
    replacement,
    start: element.openingTagNameEnd,
  };
}

function isComponentTag(tag: string): boolean {
  return tag.includes('.') || /^[A-Z]/.test(tag);
}

export function spreadObjectAttributes(entries: readonly ObjectLiteralEntry[]): string | null {
  const attributes: string[] = [];

  for (const entry of entries) {
    const attribute = spreadObjectAttribute(entry);
    if (attribute === null) return null;
    if (attribute) attributes.push(attribute);
  }

  return attributes.join(' ');
}

function spreadObjectAttribute(entry: ObjectLiteralEntry): string | null {
  if (entry.value === undefined) return null;

  const value = entry.value.trim();
  if (value === 'false' || value === 'null' || value === 'undefined') return '';

  const stringValue = literalStringValue(value);
  if (stringValue !== null) return `${entry.key}="${escapeAttribute(stringValue)}"`;

  if (value === 'true') return entry.key;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return `${entry.key}="${value}"`;

  return `${entry.key}={${value}}`;
}
