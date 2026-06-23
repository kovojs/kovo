import type { CompilerDiagnostic } from '../diagnostics.js';
import {
  generatedJsxIrAttribute,
  markJsxIrChanged,
  primitiveJsxIrAttribute,
  type JsxIrAttribute,
  type JsxIrAttributeValue,
  type JsxIrElement,
} from '../jsx-ir.js';
import {
  authorJsxAttributes,
  mergePrimitiveAndAuthorAttributes,
  primitiveIdRewrite,
  primitiveObjectEntryAttributes,
  rewritePrimitiveIdrefAttributes,
  type MergeableAttribute,
  type MergeableAttributeValue,
} from './attribute-merge.js';

export function lowerPrimitiveComposition(
  elements: readonly JsxIrElement[],
  options: { fileName: string; source: string },
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const candidates = primitiveCompositionCandidates(elements);
  const rewrites = primitiveIdRewrites(candidates);

  for (const candidate of candidates) {
    const merge = mergePrimitiveAndAuthorAttributes(
      rewritePrimitiveIdrefAttributes(candidate.primitiveAttributes, rewrites),
      candidate.authorAttributes,
      options,
    );
    diagnostics.push(...withMergeWriterNames(merge.diagnostics));
    unwrapPrimitiveWrapper(candidate.wrapper, candidate.child, merge.attributes, options);
  }

  return diagnostics;
}

interface PrimitiveCompositionCandidate {
  authorAttributes: readonly MergeableAttribute[];
  child: JsxIrElement;
  primitiveAttributes: readonly MergeableAttribute[];
  wrapper: JsxIrElement;
}

function primitiveCompositionCandidates(
  elements: readonly JsxIrElement[],
): PrimitiveCompositionCandidate[] {
  const candidates: PrimitiveCompositionCandidate[] = [];

  for (const wrapper of elements) {
    if (!isComponentTag(wrapper.tag)) continue;
    const attrsAttribute = wrapper.element.attributes.find(
      (attribute) => attribute.name === 'attrs',
    );
    const attrs = attrsAttribute?.expressionObjectEntries;
    if (!attrs) continue;

    const primitiveAttributes = primitiveObjectEntryAttributes(attrs);
    if (primitiveAttributes === null) continue;

    const child = wrapper.element.attributes.some((attribute) => attribute.name === 'asChild')
      ? singleImmediateElementChild(wrapper)
      : singleAttrsFunctionElementChild(wrapper);
    if (!child || childHasUnsupportedSpreads(child)) continue;

    candidates.push({
      authorAttributes: authorJsxAttributes(child.element.attributes),
      child,
      primitiveAttributes,
      wrapper,
    });
  }

  return candidates;
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
  wrapper: JsxIrElement,
  child: JsxIrElement,
  attributes: readonly MergeableAttribute[],
  options: { fileName: string; source: string },
): void {
  wrapper.tag = child.tag;
  wrapper.closingName = child.tag;
  wrapper.selfClosing = child.selfClosing;
  wrapper.attributes = attributes.map((attribute) => mergeableToIrAttribute(attribute, options));
  wrapper.children = child.children;
  wrapper.generatedAttributes = [];
  wrapper.ownership = 'generated';
  wrapper.provenance = {
    ...(wrapper.provenance.anchor ? { anchor: wrapper.provenance.anchor } : {}),
    description: 'primitive wrapper lowered to child element',
    ownership: 'generated',
    writer: 'primitive composition',
  };
  markJsxIrChanged(wrapper);
}

function singleImmediateElementChild(wrapper: JsxIrElement): JsxIrElement | null {
  const children = wrapper.children.filter(
    (child): child is JsxIrElement => child.kind === 'element',
  );
  if (wrapper.element.childNonWhitespaceCount !== 1 || children.length !== 1) return null;
  return children[0] ?? null;
}

function singleAttrsFunctionElementChild(wrapper: JsxIrElement): JsxIrElement | null {
  const child = wrapper.children
    .filter((item): item is JsxIrElement => item.kind === 'element')
    .find((item) =>
      item.element.spreadAttributes.some(
        (spread) => spread.expressionBareIdentifierName === 'attrs',
      ),
    );
  if (child) return child;

  const nested =
    wrapper.element.childExpressionContainers.length === 1
      ? wrapper.children.flatMap((item) => (item.kind === 'element' ? [item] : []))
      : [];
  return nested[0] ?? null;
}

function childHasUnsupportedSpreads(element: JsxIrElement): boolean {
  return element.element.spreadAttributes.some(
    (spread) => spread.expressionBareIdentifierName !== 'attrs',
  );
}

function mergeableToIrAttribute(
  attribute: MergeableAttribute,
  options: { fileName: string; source: string },
): JsxIrAttribute {
  const value = mergeableValueToIr(attribute.value);
  const base =
    attribute.origin === 'primitive'
      ? primitiveJsxIrAttribute(attribute.name, value, 'primitive attrs', options)
      : generatedJsxIrAttribute(attribute.name, value, 'author merged attrs', options);
  if (attribute.attribute) {
    base.anchor = {
      end: attribute.attribute.end,
      fileName: options.fileName,
      start: attribute.attribute.start,
    };
    base.source = attribute.attribute;
  }
  return base;
}

function mergeableValueToIr(value: MergeableAttributeValue): JsxIrAttributeValue {
  if (value.kind === 'boolean') return value;
  if (value.kind === 'expression') return value;
  if (value.kind === 'number') return value;
  return value;
}

function withMergeWriterNames(diagnostics: readonly CompilerDiagnostic[]): CompilerDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    message: `${diagnostic.message} (writers: primitive attrs, author JSX)`,
  }));
}

function isComponentTag(tag: string): boolean {
  return tag.includes('.') || /^[A-Z]/.test(tag);
}
