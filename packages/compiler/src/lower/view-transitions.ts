import {
  jsxElements,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
} from '../scan/parse.js';
import { escapeAttribute, type SourceReplacement } from '../shared.js';
import type { ViewTransitionStamp } from '../types.js';

interface ViewTransitionLowering {
  replacements: SourceReplacement[];
  stamps: ViewTransitionStamp[];
}

export function viewTransitionLowering(model: ComponentModuleModel): ViewTransitionLowering {
  const matches = jsxElements(model)
    .map((item) => ({
      attribute: item.attributes.find(
        (attribute) =>
          attribute.name === 'viewTransitionName' &&
          (attribute.value !== undefined || attribute.expression !== undefined),
      ),
      element: item,
    }))
    .filter(
      (
        item,
      ): item is {
        attribute: JsxAttributeModel & ({ expression: string } | { value: string });
        element: JsxElementModel;
      } => item.attribute !== undefined,
    );
  const stamps = matches.flatMap((item) =>
    item.attribute.value === undefined ? [] : [{ name: item.attribute.value }],
  );
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
  transitionAttribute: JsxAttributeModel & ({ expression: string } | { value: string }),
): SourceReplacement[] {
  const styleAttribute = element.attributes.find((attribute) => attribute.name === 'style');
  const transition =
    transitionAttribute.value === undefined
      ? dynamicTransitionStyle(transitionAttribute.expression ?? '')
      : `view-transition-name: ${escapeAttribute(transitionAttribute.value)}`;
  const replacements: SourceReplacement[] = [
    {
      end: transitionAttribute.end,
      replacement: '',
      start: transitionAttribute.leadingStart,
    },
  ];

  if (styleAttribute) {
    const style = mergedStyle(styleAttribute, transition);
    replacements.push({
      end: styleAttribute.end,
      replacement: style,
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
  const attribute = transition.startsWith('{') ? `style=${transition}` : `style="${transition}"`;
  if (!element.selfClosing) {
    return { position: element.openingEnd - 1, replacement: ` ${attribute}` };
  }

  const position = element.openingEnd - 2;
  return {
    position,
    replacement: element.selfClosingSlashHasLeadingWhitespace ? `${attribute} ` : ` ${attribute} `,
  };
}

function mergedStyle(attribute: JsxAttributeModel, transition: string): string {
  if (transition.startsWith('{')) {
    return attribute.expression === undefined
      ? `style={\`${templateLiteralText(attribute.value ?? '')}; ${transition.slice(2, -2)}\`}`
      : `style={[${attribute.expression}, ${transition.slice(1, -1)}].filter(Boolean).join('; ')}`;
  }

  if (attribute.expression !== undefined) {
    return `style={[${attribute.expression}, ${JSON.stringify(transition)}].filter(Boolean).join('; ')}`;
  }

  const existing = (attribute.value ?? '').trim();
  const separator = existing === '' || existing.endsWith(';') ? '' : ';';
  const merged = existing === '' ? transition : `${existing}${separator} ${transition}`;
  return `style="${merged}"`;
}

function dynamicTransitionStyle(expression: string): string {
  return `{${JSON.stringify(`view-transition-name: \${${expression.trim()}}`).replace(/^"|"$/g, '`')}}`;
}

function templateLiteralText(value: string): string {
  return value.replace(/[`\\]/g, (char) => `\\${char}`).replace(/\$\{/g, '\\${');
}
