import type {
  ComponentModuleModel,
  JsxAttributeModel,
  JsxElementModel,
  JsxExpressionModel,
  JsxSpreadAttributeModel,
  SourceSpan,
} from './scan/parse.js';
import { escapeAttribute, type SourceReplacement } from './shared.js';
import {
  compilerArrayJoin,
  compilerArrayLength,
  compilerCreateMap,
  compilerCreateSet,
  compilerFailClosed,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetHas,
  compilerSetOwnDataProperty,
  compilerStringSlice,
  compilerStringStartsWith,
} from './compiler-security-intrinsics.js';

export type JsxIrOwnership = 'author' | 'generated' | 'primitive';

export interface JsxIrDiagnosticAnchor {
  end: number;
  fileName: string;
  start: number;
}

export interface JsxIrProvenance {
  anchor?: JsxIrDiagnosticAnchor;
  description: string;
  ownership: JsxIrOwnership;
  writer: string;
}

export type JsxIrAttributeValue =
  | { kind: 'boolean'; value: boolean }
  | { kind: 'expression'; source: string }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string };

export interface JsxIrAttribute {
  anchor?: JsxIrDiagnosticAnchor;
  name: string;
  ownership: JsxIrOwnership;
  provenance: JsxIrProvenance;
  source?: JsxAttributeModel | JsxSpreadAttributeModel;
  value: JsxIrAttributeValue;
}

export interface JsxIrBindingMetadata {
  path: string;
  slot: 'attribute' | 'text';
}

export interface JsxIrUpdateMetadata {
  input: 'query' | 'state';
  name: string;
}

export type JsxIrChild = JsxIrElement | JsxIrExpression | JsxIrText;

export interface JsxIrElement {
  attributes: JsxIrAttribute[];
  attributesChanged?: boolean;
  binding?: JsxIrBindingMetadata;
  childBody: SourceSpan | null;
  children: JsxIrChild[];
  closingName?: string;
  element: JsxElementModel;
  generatedAttributes: JsxIrAttribute[];
  kind: 'element';
  ownership: JsxIrOwnership;
  parent?: JsxIrElement;
  provenance: JsxIrProvenance;
  removed: boolean;
  selfClosing: boolean;
  tag: string;
  update?: JsxIrUpdateMetadata;
}

export interface JsxIrExpression {
  anchor: JsxIrDiagnosticAnchor;
  expression: JsxExpressionModel;
  kind: 'expression';
  ownership: JsxIrOwnership;
  provenance: JsxIrProvenance;
  replacement?: JsxIrChild | string;
}

export interface JsxIrText {
  end: number;
  kind: 'text';
  source: string;
  start: number;
}

export interface JsxIrTree {
  elements: JsxIrElement[];
  roots: JsxIrElement[];
  source: string;
}

export function createJsxIrTree(
  model: ComponentModuleModel,
  options: { fileName: string; source: string },
): JsxIrTree {
  const sourceElements = compilerSortedDenseArray(
    model.jsxElements,
    (left, right) => left.start - right.start || right.end - left.end,
    'JSX IR source elements',
  );
  const elements: JsxIrElement[] = [];
  const sourceElementLength = compilerArrayLength(sourceElements, 'JSX IR source elements');
  for (let elementIndex = 0; elementIndex < sourceElementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      sourceElements,
      elementIndex,
      'JSX IR source elements',
    ) as JsxElementModel;
    const attributes: JsxIrAttribute[] = [];
    const attributeLength = compilerArrayLength(element.attributes, 'JSX IR source attributes');
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const attribute = compilerOwnDataValue(
        element.attributes,
        attributeIndex,
        'JSX IR source attributes',
      ) as JsxAttributeModel;
      appendMutableFact(
        attributes,
        jsxIrAttribute(attribute, options, 'author'),
        'JSX IR attributes',
      );
    }
    const spreadLength = compilerArrayLength(
      element.spreadAttributes,
      'JSX IR source spread attributes',
    );
    for (let spreadIndex = 0; spreadIndex < spreadLength; spreadIndex += 1) {
      const spread = compilerOwnDataValue(
        element.spreadAttributes,
        spreadIndex,
        'JSX IR source spread attributes',
      ) as JsxSpreadAttributeModel;
      appendMutableFact(
        attributes,
        jsxIrSpreadAttribute(spread, options, 'author'),
        'JSX IR attributes',
      );
    }
    appendMutableFact(
      elements,
      {
        attributes,
        childBody:
          element.selfClosing || element.closingStart <= element.openingEnd
            ? null
            : { start: element.openingEnd, end: element.closingStart },
        children: [],
        element,
        generatedAttributes: [],
        kind: 'element',
        ownership: 'author',
        provenance: provenance('author', 'author JSX', 'source element', options, {
          end: element.end,
          start: element.start,
        }),
        removed: false,
        selfClosing: element.selfClosing,
        tag: element.tag,
      },
      'JSX IR elements',
    );
  }

  const { childrenByParent, roots } = assignElementParents(elements);

  const expressionsByContainer = compilerCreateMap<string, JsxExpressionModel>();
  const expressionLength = compilerArrayLength(model.jsxExpressions, 'JSX IR source expressions');
  for (let expressionIndex = 0; expressionIndex < expressionLength; expressionIndex += 1) {
    const expression = compilerOwnDataValue(
      model.jsxExpressions,
      expressionIndex,
      'JSX IR source expressions',
    ) as JsxExpressionModel;
    compilerMapSet(
      expressionsByContainer,
      `${expression.containerStart}:${expression.containerEnd}`,
      expression,
    );
  }

  const elementLength = compilerArrayLength(elements, 'JSX IR elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(elements, elementIndex, 'JSX IR elements') as JsxIrElement;
    element.children = childrenForElement(
      element,
      compilerMapGet(childrenByParent, element) ?? [],
      expressionsByContainer,
      options,
    );
  }

  return { elements, roots, source: options.source };
}

interface JsxIrParentFrame {
  element: JsxIrElement;
  previous: JsxIrParentFrame | null;
}

function assignElementParents(elements: readonly JsxIrElement[]): {
  childrenByParent: Map<JsxIrElement, JsxIrElement[]>;
  roots: JsxIrElement[];
} {
  const childrenByParent = compilerCreateMap<JsxIrElement, JsxIrElement[]>();
  const roots: JsxIrElement[] = [];
  let top: JsxIrParentFrame | null = null;
  const length = compilerArrayLength(elements, 'JSX IR parent elements');
  for (let index = 0; index < length; index += 1) {
    const element = compilerOwnDataValue(elements, index, 'JSX IR parent elements') as JsxIrElement;
    while (top !== null && top.element.element.end <= element.element.start) {
      top = top.previous;
    }

    const parent = top?.element;
    if (parent && contains(parent, element)) {
      element.parent = parent;
      const children = compilerMapGet(childrenByParent, parent);
      if (children) {
        appendMutableFact(children, element, 'JSX IR parent children');
      } else {
        const firstChild: JsxIrElement[] = [];
        appendMutableFact(firstChild, element, 'JSX IR parent children');
        compilerMapSet(childrenByParent, parent, firstChild);
      }
    } else {
      appendMutableFact(roots, element, 'JSX IR roots');
    }

    top = { element, previous: top };
  }

  return { childrenByParent, roots };
}

export function jsxIrText(source: string, start = 0): JsxIrText {
  return { end: start + source.length, kind: 'text', source, start };
}

export function generatedJsxIrAttribute(
  name: string,
  value: JsxIrAttributeValue,
  writer: string,
  options: { fileName: string; source: string },
): JsxIrAttribute {
  return {
    name,
    ownership: 'generated',
    provenance: provenance('generated', writer, 'generated attribute', options),
    value,
  };
}

export function primitiveJsxIrAttribute(
  name: string,
  value: JsxIrAttributeValue,
  writer: string,
  options: { fileName: string; source: string },
): JsxIrAttribute {
  return {
    name,
    ownership: 'primitive',
    provenance: provenance('primitive', writer, 'primitive attribute', options),
    value,
  };
}

export function printJsxIrElement(element: JsxIrElement): string {
  const attributes: string[] = [];
  appendPrintedAttributes(attributes, element.attributes, 'JSX IR attributes');
  appendPrintedAttributes(attributes, element.generatedAttributes, 'JSX IR generated attributes');
  const attributeLength = compilerArrayLength(attributes, 'Printed JSX IR attributes');
  const open =
    attributeLength > 0
      ? `<${element.tag} ${compilerArrayJoin(attributes, ' ')}`
      : `<${element.tag}`;

  if (element.selfClosing) return `${open} />`;

  const children: string[] = [];
  const childLength = compilerArrayLength(element.children, 'JSX IR children');
  for (let childIndex = 0; childIndex < childLength; childIndex += 1) {
    const child = compilerOwnDataValue(
      element.children,
      childIndex,
      'JSX IR children',
    ) as JsxIrChild;
    appendMutableFact(children, printJsxIrChild(child), 'Printed JSX IR children');
  }
  return `${open}>${compilerArrayJoin(children, '')}</${element.closingName ?? element.tag}>`;
}

function appendPrintedAttributes(
  target: string[],
  source: readonly JsxIrAttribute[],
  label: string,
): void {
  const length = compilerArrayLength(source, label);
  for (let index = 0; index < length; index += 1) {
    const attribute = compilerOwnDataValue(source, index, label) as JsxIrAttribute;
    if (attribute.value.kind === 'boolean' && !attribute.value.value) continue;
    appendMutableFact(target, printJsxIrAttribute(attribute), 'Printed JSX IR attributes');
  }
}

export function printJsxIrChild(child: JsxIrChild): string {
  if (child.kind === 'text') return child.source;
  if (child.kind === 'expression') {
    if (typeof child.replacement === 'string') return child.replacement;
    if (child.replacement) return printJsxIrChild(child.replacement);
    return `{${child.expression.expression}}`;
  }
  return printJsxIrElement(child);
}

export function jsxIrReplacements(tree: JsxIrTree): SourceReplacement[] {
  const replacements: SourceReplacement[] = [];
  const changedElements: JsxIrElement[] = [];
  const treeElementLength = compilerArrayLength(tree.elements, 'JSX IR replacement elements');
  for (let elementIndex = 0; elementIndex < treeElementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      tree.elements,
      elementIndex,
      'JSX IR replacement elements',
    ) as JsxIrElement;
    if (elementOwnChanged(element)) {
      appendMutableFact(changedElements, element, 'Changed JSX IR elements');
    }
  }
  const changedRoots: JsxIrElement[] = [];
  const changedLength = compilerArrayLength(changedElements, 'Changed JSX IR elements');
  for (let elementIndex = 0; elementIndex < changedLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      changedElements,
      elementIndex,
      'Changed JSX IR elements',
    ) as JsxIrElement;
    let contained = false;
    for (let candidateIndex = 0; candidateIndex < changedLength; candidateIndex += 1) {
      const candidate = compilerOwnDataValue(
        changedElements,
        candidateIndex,
        'Changed JSX IR elements',
      ) as JsxIrElement;
      if (contains(candidate, element)) {
        contained = true;
        break;
      }
    }
    if (!contained) appendMutableFact(changedRoots, element, 'Changed JSX IR roots');
  }

  const changedRootLength = compilerArrayLength(changedRoots, 'Changed JSX IR roots');
  for (let rootIndex = 0; rootIndex < changedRootLength; rootIndex += 1) {
    const root = compilerOwnDataValue(
      changedRoots,
      rootIndex,
      'Changed JSX IR roots',
    ) as JsxIrElement;
    appendMutableFact(
      replacements,
      {
        end: root.element.end,
        replacement: root.removed ? '' : printJsxIrElement(root),
        start: root.element.start,
      },
      'JSX IR replacements',
    );
  }

  const expressions = expressionReplacements(tree.roots);
  const expressionLength = compilerArrayLength(expressions, 'JSX IR expression replacements');
  for (let expressionIndex = 0; expressionIndex < expressionLength; expressionIndex += 1) {
    const expression = compilerOwnDataValue(
      expressions,
      expressionIndex,
      'JSX IR expression replacements',
    ) as JsxIrExpression;
    let contained = false;
    for (let rootIndex = 0; rootIndex < changedRootLength; rootIndex += 1) {
      const root = compilerOwnDataValue(
        changedRoots,
        rootIndex,
        'Changed JSX IR roots',
      ) as JsxIrElement;
      if (containsExpression(root, expression)) {
        contained = true;
        break;
      }
    }
    if (contained) continue;
    appendMutableFact(
      replacements,
      {
        end: expression.expression.containerEnd,
        replacement:
          typeof expression.replacement === 'string'
            ? expression.replacement
            : expression.replacement
              ? printJsxIrChild(expression.replacement)
              : '',
        start: expression.expression.containerStart,
      },
      'JSX IR replacements',
    );
  }

  return replacements;
}

export function markJsxIrChanged(element: JsxIrElement): void {
  element.attributesChanged = true;
}

export function setJsxIrAttribute(element: JsxIrElement, attribute: JsxIrAttribute): void {
  const existing = findJsxIrAttribute(element.attributes, attribute.name);
  if (existing) {
    existing.name = attribute.name;
    existing.ownership = attribute.ownership;
    existing.provenance = attribute.provenance;
    existing.value = attribute.value;
    if (attribute.anchor !== undefined) existing.anchor = attribute.anchor;
    if (attribute.source !== undefined) existing.source = attribute.source;
    markJsxIrChanged(element);
    return;
  }
  appendMutableFact(element.attributes, attribute, 'JSX IR attributes');
  markJsxIrChanged(element);
}

export function removeJsxIrAttribute(element: JsxIrElement, name: string): void {
  const next: JsxIrAttribute[] = [];
  const length = compilerArrayLength(element.attributes, 'JSX IR attributes');
  for (let index = 0; index < length; index += 1) {
    const attribute = compilerOwnDataValue(
      element.attributes,
      index,
      'JSX IR attributes',
    ) as JsxIrAttribute;
    if (attribute.name !== name) appendMutableFact(next, attribute, 'JSX IR attributes');
  }
  if (compilerArrayLength(next, 'JSX IR attributes') !== length) {
    element.attributes = next;
    markJsxIrChanged(element);
  }
}

export function jsxIrAttributeValue(attribute: JsxIrAttribute): string | undefined {
  if (attribute.value.kind === 'string') return attribute.value.value;
  if (attribute.value.kind === 'number') return `${attribute.value.value}`;
  if (attribute.value.kind === 'boolean') return attribute.value.value ? '' : undefined;
  return undefined;
}

function childrenForElement(
  element: JsxIrElement,
  directElements: readonly JsxIrElement[],
  expressionsByContainer: ReadonlyMap<string, JsxExpressionModel>,
  options: { fileName: string; source: string },
): JsxIrChild[] {
  if (element.selfClosing || !element.childBody) return [];

  type PositionedChild = {
    end: number;
    kind: 'element' | 'expression';
    node: JsxIrElement | JsxIrExpression;
    start: number;
  };
  const positioned: PositionedChild[] = [];
  const directElementLength = compilerArrayLength(directElements, 'Direct JSX IR elements');
  for (let childIndex = 0; childIndex < directElementLength; childIndex += 1) {
    const child = compilerOwnDataValue(
      directElements,
      childIndex,
      'Direct JSX IR elements',
    ) as JsxIrElement;
    appendMutableFact(
      positioned,
      {
        end: child.element.end,
        kind: 'element',
        node: child,
        start: child.element.start,
      },
      'Positioned JSX IR children',
    );
  }
  const containerLength = compilerArrayLength(
    element.element.childExpressionContainers,
    'JSX IR expression containers',
  );
  for (let containerIndex = 0; containerIndex < containerLength; containerIndex += 1) {
    const span = compilerOwnDataValue(
      element.element.childExpressionContainers,
      containerIndex,
      'JSX IR expression containers',
    ) as SourceSpan;
    const expression = compilerMapGet(expressionsByContainer, `${span.start}:${span.end}`);
    if (expression === undefined) continue;
    let nestedInDirectElement = false;
    for (let childIndex = 0; childIndex < directElementLength; childIndex += 1) {
      const child = compilerOwnDataValue(
        directElements,
        childIndex,
        'Direct JSX IR elements',
      ) as JsxIrElement;
      if (child.element.start >= span.start && child.element.end <= span.end) {
        nestedInDirectElement = true;
        break;
      }
    }
    if (nestedInDirectElement) continue;
    appendMutableFact(
      positioned,
      {
        end: span.end,
        kind: 'expression',
        node: jsxIrExpression(expression, options),
        start: span.start,
      },
      'Positioned JSX IR children',
    );
  }
  const children = compilerSortedDenseArray(
    positioned,
    (left, right) => left.start - right.start,
    'Positioned JSX IR children',
  );

  const result: JsxIrChild[] = [];
  let cursor = element.childBody.start;
  const childLength = compilerArrayLength(children, 'Positioned JSX IR children');
  for (let childIndex = 0; childIndex < childLength; childIndex += 1) {
    const child = compilerOwnDataValue(
      children,
      childIndex,
      'Positioned JSX IR children',
    ) as PositionedChild;
    if (child.start > cursor) {
      appendMutableFact(
        result,
        {
          end: child.start,
          kind: 'text',
          source: compilerStringSlice(options.source, cursor, child.start),
          start: cursor,
        },
        'JSX IR children',
      );
    }
    appendMutableFact(result, child.node, 'JSX IR children');
    cursor = child.end;
  }
  if (cursor < element.childBody.end) {
    appendMutableFact(
      result,
      {
        end: element.childBody.end,
        kind: 'text',
        source: compilerStringSlice(options.source, cursor, element.childBody.end),
        start: cursor,
      },
      'JSX IR children',
    );
  }
  return result;
}

function jsxIrExpression(
  expression: JsxExpressionModel,
  options: { fileName: string; source: string },
): JsxIrExpression {
  return {
    anchor: {
      end: expression.containerEnd,
      fileName: options.fileName,
      start: expression.containerStart,
    },
    expression,
    kind: 'expression',
    ownership: 'author',
    provenance: provenance('author', 'author JSX', 'source expression', options, {
      end: expression.containerEnd,
      start: expression.containerStart,
    }),
  };
}

function jsxIrAttribute(
  attribute: JsxAttributeModel,
  options: { fileName: string; source: string },
  ownership: JsxIrOwnership,
): JsxIrAttribute {
  return {
    anchor: { end: attribute.end, fileName: options.fileName, start: attribute.start },
    name: attribute.name,
    ownership,
    provenance: provenance(ownership, 'author JSX', 'source attribute', options, attribute),
    source: attribute,
    value: attributeValue(attribute),
  };
}

function jsxIrSpreadAttribute(
  attribute: JsxSpreadAttributeModel,
  options: { fileName: string; source: string },
  ownership: JsxIrOwnership,
): JsxIrAttribute {
  return {
    anchor: { end: attribute.end, fileName: options.fileName, start: attribute.start },
    name: `...${attribute.expressionBareIdentifierName ?? attribute.expression}`,
    ownership,
    provenance: provenance(ownership, 'author JSX', 'source spread attribute', options, attribute),
    source: attribute,
    value: { kind: 'expression', source: `...${attribute.expression}` },
  };
}

function attributeValue(attribute: JsxAttributeModel): JsxIrAttributeValue {
  if (attribute.value !== undefined) return { kind: 'string', value: attribute.value };
  if (attribute.expression !== undefined)
    return { kind: 'expression', source: attribute.expression };
  return { kind: 'boolean', value: true };
}

function printJsxIrAttribute(attribute: JsxIrAttribute): string {
  if (attribute.value.kind === 'boolean') return attribute.name;
  if (attribute.value.kind === 'expression') {
    if (compilerStringStartsWith(attribute.name, '...')) return `{${attribute.value.source}}`;
    return `${attribute.name}={${attribute.value.source}}`;
  }
  if (attribute.value.kind === 'number') return `${attribute.name}="${attribute.value.value}"`;
  return `${attribute.name}="${escapeAttribute(attribute.value.value)}"`;
}

function elementOwnChanged(element: JsxIrElement): boolean {
  return (
    element.removed ||
    element.tag !== element.element.tag ||
    element.selfClosing !== element.element.selfClosing ||
    element.attributesChanged === true
  );
}

function contains(parent: JsxIrElement, child: JsxIrElement): boolean {
  return (
    parent !== child &&
    parent.element.start < child.element.start &&
    parent.element.end > child.element.end
  );
}

function containsExpression(parent: JsxIrElement, child: JsxIrExpression): boolean {
  return (
    child.expression.containerStart >= parent.element.start &&
    child.expression.containerEnd <= parent.element.end
  );
}

function expressionReplacements(elements: readonly JsxIrElement[]): JsxIrExpression[] {
  const expressions: JsxIrExpression[] = [];
  const visit = (child: JsxIrChild): void => {
    if (child.kind === 'expression' && child.replacement !== undefined) {
      appendMutableFact(expressions, child, 'JSX IR expression replacements');
    }
    if (child.kind === 'element') {
      const childLength = compilerArrayLength(child.children, 'JSX IR nested children');
      for (let childIndex = 0; childIndex < childLength; childIndex += 1) {
        visit(
          compilerOwnDataValue(child.children, childIndex, 'JSX IR nested children') as JsxIrChild,
        );
      }
    }
  };
  const elementLength = compilerArrayLength(elements, 'JSX IR replacement roots');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      elements,
      elementIndex,
      'JSX IR replacement roots',
    ) as JsxIrElement;
    const childLength = compilerArrayLength(element.children, 'JSX IR root children');
    for (let childIndex = 0; childIndex < childLength; childIndex += 1) {
      visit(
        compilerOwnDataValue(element.children, childIndex, 'JSX IR root children') as JsxIrChild,
      );
    }
  }
  return expressions;
}

function findJsxIrAttribute(
  attributes: readonly JsxIrAttribute[],
  name: string,
): JsxIrAttribute | undefined {
  const length = compilerArrayLength(attributes, 'JSX IR attributes');
  for (let index = 0; index < length; index += 1) {
    const attribute = compilerOwnDataValue(
      attributes,
      index,
      'JSX IR attributes',
    ) as JsxIrAttribute;
    if (attribute.name === name) return attribute;
  }
  return undefined;
}

function appendMutableFact<Value>(target: Value[], value: Value, label: string): void {
  compilerSetOwnDataProperty(target, compilerArrayLength(target, label), value);
}

function compilerSortedDenseArray<Value>(
  values: readonly Value[],
  compare: (left: Value, right: Value) => number,
  label: string,
): Value[] {
  const length = compilerArrayLength(values, label);
  const selected = compilerCreateSet<number>();
  const result: Value[] = [];
  for (let outputIndex = 0; outputIndex < length; outputIndex += 1) {
    let bestIndex = -1;
    let best: Value | undefined;
    for (let inputIndex = 0; inputIndex < length; inputIndex += 1) {
      if (compilerSetHas(selected, inputIndex)) continue;
      const candidate = compilerOwnDataValue(values, inputIndex, label) as Value;
      if (bestIndex === -1 || compare(candidate, best as Value) < 0) {
        bestIndex = inputIndex;
        best = candidate;
      }
    }
    if (bestIndex === -1 || best === undefined) {
      compilerFailClosed(`${label} must be a dense array.`);
    }
    compilerSetAdd(selected, bestIndex);
    appendMutableFact(result, best, label);
  }
  return result;
}

function provenance(
  ownership: JsxIrOwnership,
  writer: string,
  description: string,
  options: { fileName: string; source: string },
  span?: SourceSpan,
): JsxIrProvenance {
  return {
    ...(span ? { anchor: { end: span.end, fileName: options.fileName, start: span.start } } : {}),
    description,
    ownership,
    writer,
  };
}
