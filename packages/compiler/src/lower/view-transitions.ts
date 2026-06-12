import {
  jsxElements,
  type ComponentModuleModel,
  type JsxAttributeModel,
  type JsxElementModel,
} from '../scan/parse.js';
import { escapeAttribute, removeJsxAttribute } from '../shared.js';

interface ViewTransitionStamp {
  name: string;
}

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
  let nextSource = source;

  for (const match of matches.sort((left, right) => right.element.start - left.element.start)) {
    const opening = nextSource.slice(match.element.start, match.element.openingEnd);
    const tagPrefix = `<${match.element.tag}`;
    const attributes = opening.slice(tagPrefix.length, -1);
    const withoutViewTransition = removeJsxAttribute(
      attributes,
      match.attribute.start - match.element.start - tagPrefix.length,
      match.attribute.end - match.element.start - tagPrefix.length,
    );
    const replacement = `<${match.element.tag}${appendViewTransitionStyle(withoutViewTransition, match.attribute.value)}>`;
    nextSource = `${nextSource.slice(0, match.element.start)}${replacement}${nextSource.slice(match.element.openingEnd)}`;
  }

  return {
    source: nextSource,
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
