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
import {
  compilerArrayLength,
  compilerCreateMap,
  compilerDefineOwnDataProperty,
  compilerMapSet,
  compilerOwnDataValue,
  compilerRegExpTest,
  compilerStringIncludes,
} from '../compiler-security-intrinsics.js';

export function lowerPrimitiveComposition(
  elements: readonly JsxIrElement[],
  options: { fileName: string; source: string },
): CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const candidates = primitiveCompositionCandidates(elements);
  const rewrites = primitiveIdRewrites(candidates);

  const candidateLength = compilerArrayLength(candidates, 'Primitive composition candidates');
  for (let candidateIndex = 0; candidateIndex < candidateLength; candidateIndex += 1) {
    const candidate = compilerOwnDataValue(
      candidates,
      candidateIndex,
      'Primitive composition candidates',
    ) as PrimitiveCompositionCandidate;
    const merge = mergePrimitiveAndAuthorAttributes(
      rewritePrimitiveIdrefAttributes(candidate.primitiveAttributes, rewrites),
      candidate.authorAttributes,
      options,
    );
    appendCompositionFacts(
      diagnostics,
      withMergeWriterNames(merge.diagnostics),
      'Primitive composition diagnostics',
    );
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

  const elementLength = compilerArrayLength(elements, 'Primitive composition elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const wrapper = compilerOwnDataValue(
      elements,
      elementIndex,
      'Primitive composition elements',
    ) as JsxIrElement;
    if (!isComponentTag(wrapper.tag)) continue;
    const attrsAttribute = sourceAttributeByName(wrapper, 'attrs');
    const attrs = attrsAttribute?.expressionObjectEntries;
    if (!attrs) continue;

    const primitiveAttributes = primitiveObjectEntryAttributes(attrs);
    if (primitiveAttributes === null) continue;

    const child =
      sourceAttributeByName(wrapper, 'asChild') !== undefined
        ? singleImmediateElementChild(wrapper)
        : singleAttrsFunctionElementChild(wrapper);
    if (!child || childHasUnsupportedSpreads(child)) continue;

    appendCompositionFact(
      candidates,
      {
        authorAttributes: authorJsxAttributes(child.element.attributes),
        child,
        primitiveAttributes,
        wrapper,
      },
      'Primitive composition candidates',
    );
  }

  return candidates;
}

function primitiveIdRewrites(
  candidates: readonly PrimitiveCompositionCandidate[],
): ReadonlyMap<string, string> {
  const rewrites = compilerCreateMap<string, string>();
  const length = compilerArrayLength(candidates, 'Primitive composition candidates');
  for (let index = 0; index < length; index += 1) {
    const candidate = compilerOwnDataValue(
      candidates,
      index,
      'Primitive composition candidates',
    ) as PrimitiveCompositionCandidate;
    const rewrite = primitiveIdRewrite(candidate.primitiveAttributes, candidate.authorAttributes);
    if (rewrite) compilerMapSet(rewrites, rewrite[0], rewrite[1]);
  }
  return rewrites;
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
  const irAttributes: JsxIrAttribute[] = [];
  const attributeLength = compilerArrayLength(attributes, 'Primitive merged attributes');
  for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
    const attribute = compilerOwnDataValue(
      attributes,
      attributeIndex,
      'Primitive merged attributes',
    ) as MergeableAttribute;
    appendCompositionFact(
      irAttributes,
      mergeableToIrAttribute(attribute, options),
      'Primitive composed IR attributes',
    );
  }
  wrapper.attributes = irAttributes;
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
  if (wrapper.element.childNonWhitespaceCount !== 1) return null;
  let child: JsxIrElement | null = null;
  let count = 0;
  const length = compilerArrayLength(wrapper.children, 'Primitive wrapper children');
  for (let index = 0; index < length; index += 1) {
    const item = compilerOwnDataValue(
      wrapper.children,
      index,
      'Primitive wrapper children',
    ) as JsxIrElement['children'][number];
    if (item.kind !== 'element') continue;
    child = item;
    count += 1;
  }
  return count === 1 ? child : null;
}

function singleAttrsFunctionElementChild(wrapper: JsxIrElement): JsxIrElement | null {
  const childLength = compilerArrayLength(wrapper.children, 'Primitive wrapper children');
  for (let childIndex = 0; childIndex < childLength; childIndex += 1) {
    const child = compilerOwnDataValue(
      wrapper.children,
      childIndex,
      'Primitive wrapper children',
    ) as JsxIrElement['children'][number];
    if (child.kind !== 'element') continue;
    const spreadLength = compilerArrayLength(
      child.element.spreadAttributes,
      'Primitive child spreads',
    );
    for (let spreadIndex = 0; spreadIndex < spreadLength; spreadIndex += 1) {
      const spread = compilerOwnDataValue(
        child.element.spreadAttributes,
        spreadIndex,
        'Primitive child spreads',
      ) as (typeof child.element.spreadAttributes)[number];
      if (spread.expressionBareIdentifierName === 'attrs') return child;
    }
  }

  if (
    compilerArrayLength(
      wrapper.element.childExpressionContainers,
      'Primitive child expression containers',
    ) !== 1
  ) {
    return null;
  }
  for (let childIndex = 0; childIndex < childLength; childIndex += 1) {
    const child = compilerOwnDataValue(
      wrapper.children,
      childIndex,
      'Primitive wrapper children',
    ) as JsxIrElement['children'][number];
    if (child.kind === 'element') return child;
  }
  return null;
}

function childHasUnsupportedSpreads(element: JsxIrElement): boolean {
  const length = compilerArrayLength(element.element.spreadAttributes, 'Primitive child spreads');
  for (let index = 0; index < length; index += 1) {
    const spread = compilerOwnDataValue(
      element.element.spreadAttributes,
      index,
      'Primitive child spreads',
    ) as (typeof element.element.spreadAttributes)[number];
    if (spread.expressionBareIdentifierName !== 'attrs') return true;
  }
  return false;
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
  const result: CompilerDiagnostic[] = [];
  const length = compilerArrayLength(diagnostics, 'Primitive merge diagnostics');
  for (let index = 0; index < length; index += 1) {
    const diagnostic = compilerOwnDataValue(
      diagnostics,
      index,
      'Primitive merge diagnostics',
    ) as CompilerDiagnostic;
    appendCompositionFact(
      result,
      {
        ...diagnostic,
        message: `${diagnostic.message} (writers: primitive attrs, author JSX)`,
      },
      'Primitive merge diagnostics',
    );
  }
  return result;
}

function sourceAttributeByName(
  element: JsxIrElement,
  name: string,
): (typeof element.element.attributes)[number] | undefined {
  const length = compilerArrayLength(element.element.attributes, 'Primitive source attributes');
  for (let index = 0; index < length; index += 1) {
    const attribute = compilerOwnDataValue(
      element.element.attributes,
      index,
      'Primitive source attributes',
    ) as (typeof element.element.attributes)[number];
    if (attribute.name === name) return attribute;
  }
  return undefined;
}

function appendCompositionFact<Value>(target: Value[], value: Value, label: string): void {
  compilerDefineOwnDataProperty(target, compilerArrayLength(target, label), value);
}

function appendCompositionFacts<Value>(
  target: Value[],
  values: readonly Value[],
  label: string,
): void {
  const length = compilerArrayLength(values, label);
  for (let index = 0; index < length; index += 1) {
    appendCompositionFact(target, compilerOwnDataValue(values, index, label) as Value, label);
  }
}

function isComponentTag(tag: string): boolean {
  return compilerStringIncludes(tag, '.') || compilerRegExpTest(/^[A-Z]/, tag);
}
