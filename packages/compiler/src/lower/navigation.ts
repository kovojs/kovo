import {
  callExpressions,
  jsxElements,
  type ComponentModuleModel,
  type JsxElementModel,
} from '../scan/parse.js';
import type { StaticLiteralValue } from '../scan/object.js';
import { escapeAttribute, removeJsxAttributes, type SourceReplacement } from '../shared.js';

export interface NavigationLowering {
  replacements: SourceReplacement[];
}

export function navigationLinkLowering(
  source: string,
  model: ComponentModuleModel,
): NavigationLowering {
  const replacements: SourceReplacement[] = [];

  for (const link of jsxElements(model).filter(
    (element) => element.tag === 'Link' && !element.selfClosing,
  )) {
    const target = jsxStaticAttributeValue(link, 'to');
    if (!target) continue;

    const params = navigationObjectAttributeValue(link, 'params');
    const search = navigationObjectAttributeValue(link, 'search');
    if (params === null || search === null) continue;

    const opening = source.slice(link.start, link.openingEnd);
    const tagPrefix = '<Link';
    const attributes = opening.slice(tagPrefix.length, -1);
    const anchorAttributes = removeJsxAttributes(
      attributes,
      link.attributes
        .filter((attribute) => ['params', 'search', 'to'].includes(attribute.name))
        .map((attribute) => ({
          end: attribute.end - link.start - tagPrefix.length,
          start: attribute.start - link.start - tagPrefix.length,
        })),
    );
    const spacing = anchorAttributes.trim() === '' ? '' : anchorAttributes;
    const href = buildStaticHref(target, params ?? {}, search ?? {});
    const children = source.slice(link.openingEnd, link.closingStart);

    replacements.push({
      end: link.end,
      replacement: `<a${spacing} href="${escapeAttribute(href)}">${children}</a>`,
      start: link.start,
    });
  }

  return { replacements };
}

export function navigationHrefLowering(
  _source: string,
  model: ComponentModuleModel,
): NavigationLowering {
  const replacements: SourceReplacement[] = [];
  const staticHrefCalls = callExpressions(model)
    .filter((item) => item.name === 'href')
    .map((call) => ({ call, lowered: lowerStaticHrefCall(call.argumentStaticValues) }))
    .filter(
      (item): item is { call: (typeof item)['call']; lowered: string } => item.lowered !== null,
    );
  const wholeAttributeReplacements: SourceReplacement[] = [];

  for (const attribute of jsxElements(model)
    .flatMap((element) => [...element.attributes])
    .filter((item) => item.name === 'href' && item.expression !== undefined)
    .sort((left, right) => right.start - left.start)) {
    const target =
      staticStringValue(attribute.expressionStaticValue) ??
      staticHrefCalls.find(
        ({ call }) =>
          call.start === attribute.expressionStart && call.end === attribute.expressionEnd,
      )?.lowered;
    if (target == null) continue;

    wholeAttributeReplacements.push({
      end: attribute.end,
      replacement: `href="${escapeAttribute(target)}"`,
      start: attribute.start,
    });
  }

  replacements.push(...wholeAttributeReplacements);
  for (const { call, lowered } of staticHrefCalls) {
    if (wholeAttributeReplacements.some((replacement) => isWithinReplacement(call, replacement))) {
      continue;
    }
    replacements.push({ end: call.end, replacement: JSON.stringify(lowered), start: call.start });
  }

  return { replacements };
}

function isWithinReplacement(call: { end: number; start: number }, replacement: SourceReplacement) {
  return call.start >= replacement.start && call.end <= replacement.end;
}

function lowerStaticHrefCall(args: readonly (StaticLiteralValue | undefined)[]): string | null {
  const [pathArg, optionsArg] = args;
  const path = staticStringValue(pathArg);
  if (!path) return null;

  const options =
    optionsArg === undefined ? {} : staticNavigationObjectValue(optionsArg, { nested: true });
  if (options === null) return null;

  const params = objectRecordValue(options.params);
  const search = objectRecordValue(options.search);
  if (params === null || search === null) return null;

  return buildStaticHref(path, params ?? {}, search ?? {});
}

type StaticNavigationValue = string | number | boolean | null;
type StaticNavigationObject = Record<string, StaticNavigationValue>;

function navigationObjectAttributeValue(
  element: JsxElementModel,
  name: string,
): StaticNavigationObject | null | undefined {
  const attribute = element.attributes.find((item) => item.name === name);
  if (attribute?.expression === undefined) return undefined;
  return staticNavigationObjectValue(attribute.expressionStaticValue, { nested: false });
}

function objectRecordValue(
  value: StaticLiteralValue | undefined,
): StaticNavigationObject | null | undefined {
  if (value === undefined) return undefined;
  return navigationObjectValue(value);
}

function navigationObjectValue(value: StaticLiteralValue | null): StaticNavigationObject | null {
  return staticNavigationObjectValue(value, { nested: false });
}

function staticNavigationObjectValue(
  value: StaticLiteralValue | undefined | null,
  options: { nested: boolean },
): StaticNavigationObject | null {
  if (typeof value !== 'object' || value === null) return null;
  return Object.values(value).every(
    (entry) => options.nested || typeof entry !== 'object' || entry === null,
  )
    ? (value as StaticNavigationObject)
    : null;
}

function staticStringValue(value: StaticLiteralValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function buildStaticHref(
  path: string,
  params: Record<string, string | number | boolean | null>,
  searchValues: Record<string, string | number | boolean | null>,
): string {
  const pathname = path.replace(/:([A-Za-z_$][\w$]*)/g, (_match, key: string) =>
    encodeURIComponent(String(params[key] ?? '')),
  );
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(searchValues)) {
    if (value === null || value === undefined) continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function jsxStaticAttributeValue(element: JsxElementModel, name: string): string | undefined {
  return element.attributes.find((attribute) => attribute.name === name)?.value;
}
