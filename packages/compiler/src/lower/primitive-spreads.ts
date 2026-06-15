import { literalStringValue } from '../scan/object.js';
import type { ComponentModuleModel, JsxElementModel, ObjectLiteralEntry } from '../scan/parse.js';
import { escapeAttribute, type SourceReplacement } from '../shared.js';

export interface PrimitiveSpreadLowering {
  replacements: readonly SourceReplacement[];
}

export function lowerPrimitiveAttributeSpreads(
  model: ComponentModuleModel,
): PrimitiveSpreadLowering {
  const replacements: SourceReplacement[] = [];

  for (const element of model.jsxElements) {
    const composition = primitiveCompositionPatches(model, element);
    if (composition.length > 0) {
      replacements.push(...composition);
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

  return { replacements };
}

function primitiveCompositionPatches(
  model: ComponentModuleModel,
  element: JsxElementModel,
): SourceReplacement[] {
  if (!isComponentTag(element.tag)) return [];

  const attrs = element.attributes.find((attribute) => attribute.name === 'attrs')
    ?.expressionObjectEntries;
  if (!attrs) return [];

  const attributes = spreadObjectAttributes(attrs);
  if (attributes === null) return [];

  if (element.attributes.some((attribute) => attribute.name === 'asChild')) {
    const child = singleImmediateChildElement(model, element);
    return child ? unwrapPrimitiveWrapper(element, child, attributes) : [];
  }

  const child = singleAttrsFunctionChildElement(model, element);
  return child ? unwrapPrimitiveWrapper(element, child, attributes) : [];
}

function unwrapPrimitiveWrapper(
  wrapper: JsxElementModel,
  child: JsxElementModel,
  attributes: string,
): SourceReplacement[] {
  const insertion = childAttributeInsertion(child, attributes);
  return [
    { end: wrapper.openingEnd, replacement: '', start: wrapper.start },
    { end: wrapper.end, replacement: '', start: wrapper.closingStart },
    { end: insertion.position, replacement: insertion.replacement, start: insertion.position },
    ...child.spreadAttributes
      .filter((spread) => spread.expressionBareIdentifierName === 'attrs')
      .map((spread) => ({ end: spread.end, replacement: '', start: spread.start })),
    ...wrapper.childExpressionContainers.flatMap((container) =>
      child.start > container.start && child.end < container.end
        ? [
            { end: child.start, replacement: '', start: container.start },
            { end: container.end, replacement: '', start: child.end },
          ]
        : [],
    ),
  ];
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

function childAttributeInsertion(
  element: JsxElementModel,
  attributes: string,
): { position: number; replacement: string } {
  if (!attributes) return { position: element.openingEnd - 1, replacement: '' };
  if (!element.selfClosing) return { position: element.openingEnd - 1, replacement: ` ${attributes}` };

  return {
    position: element.openingEnd - 2,
    replacement: element.selfClosingSlashHasLeadingWhitespace ? `${attributes} ` : ` ${attributes} `,
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
