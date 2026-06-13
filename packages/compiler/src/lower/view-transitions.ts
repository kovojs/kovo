import {
  jsxElements,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
} from '../scan/parse.js';
import {
  applySourceReplacements,
  escapeAttribute,
  insertOpeningTagAttribute,
  openingTagAttributeRange,
  type SourceReplacement,
} from '../shared.js';
import type { ViewTransitionStamp } from '../types.js';

export interface ViewTransitionLowering {
  replacements: SourceReplacement[];
  stamps: ViewTransitionStamp[];
}

export function viewTransitionLowering(model: ComponentModuleModel): ViewTransitionLowering {
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
    const replacement = appendViewTransitionStyle(match.element, match.attribute);
    return { end: match.element.openingEnd, replacement, start: match.element.start };
  });

  return {
    replacements,
    stamps,
  };
}

function appendViewTransitionStyle(
  element: JsxElementModel,
  transitionAttribute: JsxAttributeModel & { value: string },
): string {
  const opening = element.openingSource;
  const styleAttribute = element.attributes.find(
    (attribute): attribute is JsxAttributeModel & { value: string } =>
      attribute.name === 'style' && attribute.value !== undefined,
  );
  const transition = `view-transition-name: ${escapeAttribute(transitionAttribute.value)}`;
  const replacements: SourceReplacement[] = [
    {
      ...openingTagAttributeRange(opening, element, transitionAttribute, {
        includeLeadingWhitespace: true,
      }),
      replacement: '',
    },
  ];

  if (styleAttribute) {
    const style = mergedStyle(styleAttribute.value, transition);
    replacements.push({
      ...openingTagAttributeRange(opening, element, styleAttribute),
      replacement: `style="${style}"`,
    });
  }

  const nextOpening = applySourceReplacements(opening, replacements);

  if (!styleAttribute) {
    return insertOpeningTagAttribute(nextOpening, element, 'style', transition);
  }

  return nextOpening;
}

function mergedStyle(current: string, transition: string): string {
  const existing = current.trim();
  const separator = existing === '' || existing.endsWith(';') ? '' : ';';
  return existing === '' ? transition : `${existing}${separator} ${transition}`;
}
