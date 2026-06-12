import {
  jsxElements,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
} from '../scan/parse.js';
import { applySourceReplacements, escapeAttribute, removeJsxAttribute } from '../shared.js';
import type { ViewTransitionStamp } from '../types.js';

export function lowerViewTransitions(
  source: string,
  model: ComponentModuleModel,
): {
  source: string;
  stamps: ViewTransitionStamp[];
} {
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
  const replacements = matches.map((match) => {
    const opening = source.slice(match.element.start, match.element.openingEnd);
    const tagPrefix = `<${match.element.tag}`;
    const attributes = opening.slice(tagPrefix.length, -1);
    const withoutViewTransition = removeJsxAttribute(
      attributes,
      match.attribute.start - match.element.start - tagPrefix.length,
      match.attribute.end - match.element.start - tagPrefix.length,
    );
    const replacement = `<${match.element.tag}${appendViewTransitionStyle(withoutViewTransition, match.attribute.value)}>`;
    return { end: match.element.openingEnd, replacement, start: match.element.start };
  });

  return {
    source: applySourceReplacements(source, replacements),
    stamps,
  };
}

function appendViewTransitionStyle(attributes: string, name: string): string {
  const transition = `view-transition-name: ${escapeAttribute(name)}`;
  const selfClosing = /\s*\/\s*$/.test(attributes);
  const baseAttributes = selfClosing ? attributes.replace(/\s*\/\s*$/, '') : attributes;
  const styleMatch = /(\sstyle=)(["'])(?<style>[^"']*)\2/.exec(baseAttributes);
  const suffix = selfClosing ? ' /' : '';

  if (!styleMatch?.groups) {
    return `${baseAttributes} style="${transition}"${suffix}`;
  }

  const existing = (styleMatch.groups.style ?? '').trim();
  const separator = existing === '' || existing.endsWith(';') ? '' : ';';
  const style = existing === '' ? transition : `${existing}${separator} ${transition}`;

  return `${baseAttributes.replace(
    styleMatch[0],
    `${styleMatch[1]}${styleMatch[2]}${style}${styleMatch[2]}`,
  )}${suffix}`;
}
