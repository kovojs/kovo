import {
  jsxElements,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
} from '../scan/parse.js';
import { escapeAttribute, type SourceReplacement } from '../shared.js';
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
  const replacements: SourceReplacement[] = matches.flatMap((match) =>
    viewTransitionStylePatches(match.element, match.attribute),
  );

  return {
    replacements,
    stamps,
  };
}

function viewTransitionStylePatches(
  element: JsxElementModel,
  transitionAttribute: JsxAttributeModel & { value: string },
): SourceReplacement[] {
  const styleAttribute = element.attributes.find(
    (attribute): attribute is JsxAttributeModel & { value: string } =>
      attribute.name === 'style' && attribute.value !== undefined,
  );
  const transition = `view-transition-name: ${escapeAttribute(transitionAttribute.value)}`;
  const replacements: SourceReplacement[] = [
    {
      end: transitionAttribute.end,
      replacement: '',
      start: transitionAttribute.leadingStart,
    },
  ];

  if (styleAttribute) {
    const style = mergedStyle(styleAttribute.value, transition);
    replacements.push({
      end: styleAttribute.end,
      replacement: `style="${style}"`,
      start: styleAttribute.start,
    });
    return replacements;
  }

  const insertion = openingTagStyleInsertion(element, transition);
  replacements.push({
    end: insertion.position,
    replacement: insertion.replacement,
    start: insertion.position,
  });
  return replacements;
}

function openingTagStyleInsertion(
  element: JsxElementModel,
  transition: string,
): { position: number; replacement: string } {
  const attribute = `style="${transition}"`;
  if (!element.selfClosing) {
    return { position: element.openingEnd - 1, replacement: ` ${attribute}` };
  }

  const position = element.openingEnd - 2;
  const hasSpaceBeforeSlash = /\s/.test(element.openingSource.at(-3) ?? '');
  return {
    position,
    replacement: hasSpaceBeforeSlash ? `${attribute} ` : ` ${attribute} `,
  };
}

function mergedStyle(current: string, transition: string): string {
  const existing = current.trim();
  const separator = existing === '' || existing.endsWith(';') ? '' : ';';
  return existing === '' ? transition : `${existing}${separator} ${transition}`;
}
