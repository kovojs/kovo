import type {
  ComponentModuleModel,
  JsxAttributeModel,
  JsxElementModel,
  JsxExpressionModel,
  JsxSpreadAttributeModel,
  SourceSpan,
} from './scan/parse.js';
import { escapeAttribute, type SourceReplacement } from './shared.js';

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
  const elementsByStart = new Map<number, JsxIrElement>();
  const elements = [...model.jsxElements]
    .sort((left, right) => left.start - right.start || right.end - left.end)
    .map((element) => {
      const irElement: JsxIrElement = {
        attributes: [
          ...element.attributes.map((attribute) => jsxIrAttribute(attribute, options, 'author')),
          ...element.spreadAttributes.map((attribute) =>
            jsxIrSpreadAttribute(attribute, options, 'author'),
          ),
        ],
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
      };
      elementsByStart.set(element.start, irElement);
      return irElement;
    });

  const roots: JsxIrElement[] = [];
  for (const element of elements) {
    const parent = [...elements]
      .filter(
        (candidate) =>
          candidate !== element &&
          candidate.element.start < element.element.start &&
          candidate.element.end > element.element.end,
      )
      .sort(
        (left, right) =>
          left.element.end - left.element.start - (right.element.end - right.element.start),
      )[0];
    if (parent) {
      element.parent = parent;
    } else {
      roots.push(element);
    }
  }

  const expressionsByContainer = new Map(
    model.jsxExpressions.map((expression) => [
      `${expression.containerStart}:${expression.containerEnd}`,
      expression,
    ]),
  );

  for (const element of elements) {
    element.children = childrenForElement(
      element,
      elementsByStart,
      expressionsByContainer,
      options,
    );
  }

  return { elements, roots, source: options.source };
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
  const attributes = [...element.attributes, ...element.generatedAttributes]
    .filter((attribute) => attribute.value.kind !== 'boolean' || attribute.value.value)
    .map(printJsxIrAttribute);
  const open =
    attributes.length > 0 ? `<${element.tag} ${attributes.join(' ')}` : `<${element.tag}`;

  if (element.selfClosing) return `${open} />`;

  return `${open}>${element.children.map(printJsxIrChild).join('')}</${element.closingName ?? element.tag}>`;
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
  const changedRoots = tree.elements
    .filter((element) => elementOwnChanged(element))
    .filter((element, _, all) => !all.some((candidate) => contains(candidate, element)));

  for (const root of changedRoots) {
    replacements.push({
      end: root.element.end,
      replacement: root.removed ? '' : printJsxIrElement(root),
      start: root.element.start,
    });
  }

  for (const expression of expressionReplacements(tree.roots)) {
    if (changedRoots.some((root) => containsExpression(root, expression))) continue;
    replacements.push({
      end: expression.expression.containerEnd,
      replacement:
        typeof expression.replacement === 'string'
          ? expression.replacement
          : expression.replacement
            ? printJsxIrChild(expression.replacement)
            : '',
      start: expression.expression.containerStart,
    });
  }

  return replacements;
}

export function markJsxIrChanged(element: JsxIrElement): void {
  element.attributesChanged = true;
}

export function setJsxIrAttribute(element: JsxIrElement, attribute: JsxIrAttribute): void {
  const existing = element.attributes.find((item) => item.name === attribute.name);
  if (existing) {
    Object.assign(existing, attribute);
    markJsxIrChanged(element);
    return;
  }
  element.attributes.push(attribute);
  markJsxIrChanged(element);
}

export function removeJsxIrAttribute(element: JsxIrElement, name: string): void {
  const next = element.attributes.filter((attribute) => attribute.name !== name);
  if (next.length !== element.attributes.length) {
    element.attributes = next;
    markJsxIrChanged(element);
  }
}

export function jsxIrAttributeValue(attribute: JsxIrAttribute): string | undefined {
  if (attribute.value.kind === 'string') return attribute.value.value;
  if (attribute.value.kind === 'number') return String(attribute.value.value);
  if (attribute.value.kind === 'boolean') return attribute.value.value ? '' : undefined;
  return undefined;
}

function childrenForElement(
  element: JsxIrElement,
  elementsByStart: ReadonlyMap<number, JsxIrElement>,
  expressionsByContainer: ReadonlyMap<string, JsxExpressionModel>,
  options: { fileName: string; source: string },
): JsxIrChild[] {
  if (element.selfClosing || !element.childBody) return [];

  const directElements = [...elementsByStart.values()]
    .filter((candidate) => candidate.parent === element)
    .sort((left, right) => left.element.start - right.element.start);
  const directExpressions = element.element.childExpressionContainers
    .map((span) => ({ expression: expressionsByContainer.get(`${span.start}:${span.end}`), span }))
    .filter(
      (item): item is { expression: JsxExpressionModel; span: SourceSpan } =>
        item.expression !== undefined &&
        !directElements.some(
          (child) => child.element.start >= item.span.start && child.element.end <= item.span.end,
        ),
    );
  const children = [
    ...directElements.map((child) => ({
      end: child.element.end,
      kind: 'element' as const,
      node: child,
      start: child.element.start,
    })),
    ...directExpressions.map(({ expression, span }) => ({
      end: span.end,
      kind: 'expression' as const,
      node: jsxIrExpression(expression, options),
      start: span.start,
    })),
  ].sort((left, right) => left.start - right.start);

  const result: JsxIrChild[] = [];
  let cursor = element.childBody.start;
  for (const child of children) {
    if (child.start > cursor) {
      result.push({
        end: child.start,
        kind: 'text',
        source: options.source.slice(cursor, child.start),
        start: cursor,
      });
    }
    result.push(child.node);
    cursor = child.end;
  }
  if (cursor < element.childBody.end) {
    result.push({
      end: element.childBody.end,
      kind: 'text',
      source: options.source.slice(cursor, element.childBody.end),
      start: cursor,
    });
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
    if (attribute.name.startsWith('...')) return `{${attribute.value.source}}`;
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
    if (child.kind === 'expression' && child.replacement !== undefined) expressions.push(child);
    if (child.kind === 'element') child.children.forEach(visit);
  };
  elements.forEach((element) => element.children.forEach(visit));
  return expressions;
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
