import {
  jsxElements,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
} from '../scan/parse.js';
import { applySourceReplacements, escapeAttribute, type SourceReplacement } from '../shared.js';
import type { ViewTransitionStamp } from '../types.js';

export interface ViewTransitionLowering {
  replacements: SourceReplacement[];
  stamps: ViewTransitionStamp[];
}

export function viewTransitionLowering(
  source: string,
  model: ComponentModuleModel,
): ViewTransitionLowering {
  const matches = jsxElements(model)
    .map((item) => ({
      attribute: item.attributes.find(
        (attribute) => attribute.name === 'viewTransitionName' && attribute.value !== undefined,
      ),
      element: item,
    }))
    .filter(
      (
        item,
      ): item is {
        attribute: JsxAttributeModel & { value: string };
        element: JsxElementModel;
      } => item.attribute !== undefined,
    );
  const stamps = matches.map((item) => ({ name: item.attribute.value }));
  const replacements: SourceReplacement[] = matches.map((match) => {
    const opening = source.slice(match.element.start, match.element.openingEnd);
    const replacement = appendViewTransitionStyle(opening, match.element, match.attribute);
    return { end: match.element.openingEnd, replacement, start: match.element.start };
  });

  return {
    replacements,
    stamps,
  };
}

function appendViewTransitionStyle(
  opening: string,
  element: JsxElementModel,
  transitionAttribute: JsxAttributeModel & { value: string },
): string {
  const tagPrefix = `<${element.tag}`;
  const attributesEnd = opening.length - (element.selfClosing ? 2 : 1);
  const attributes = opening.slice(tagPrefix.length, attributesEnd).trimEnd();
  const styleAttribute = element.attributes.find(
    (attribute): attribute is JsxAttributeModel & { value: string } =>
      attribute.name === 'style' && attribute.value !== undefined,
  );
  const transition = `view-transition-name: ${escapeAttribute(transitionAttribute.value)}`;
  const removeTransition = attributeRangeInOpeningTag(
    element,
    transitionAttribute,
    tagPrefix.length,
    attributes,
  );
  const replacements: SourceReplacement[] = [
    {
      end: removeTransition.end,
      replacement: '',
      start: removeTransition.start,
    },
  ];

  if (styleAttribute) {
    const style = mergedStyle(styleAttribute.value, transition);
    replacements.push({
      ...attributeRangeInOpeningTag(element, styleAttribute, tagPrefix.length, attributes),
      replacement: ` style="${style}"`,
    });
  }

  const nextAttributes = applySourceReplacements(attributes, replacements);
  const suffix = element.selfClosing ? ' />' : '>';

  if (!styleAttribute) {
    return `${tagPrefix}${nextAttributes} style="${transition}"${suffix}`;
  }

  return `${tagPrefix}${nextAttributes}${suffix}`;
}

function mergedStyle(current: string, transition: string): string {
  const existing = current.trim();
  const separator = existing === '' || existing.endsWith(';') ? '' : ';';
  return existing === '' ? transition : `${existing}${separator} ${transition}`;
}

function attributeRangeInOpeningTag(
  element: JsxElementModel,
  attribute: JsxAttributeModel,
  tagPrefixLength: number,
  attributes: string,
): { end: number; start: number } {
  let start = attribute.start - element.start - tagPrefixLength;
  while (start > 0 && /\s/.test(attributes[start - 1] ?? '')) start -= 1;

  return {
    end: attribute.end - element.start - tagPrefixLength,
    start,
  };
}
