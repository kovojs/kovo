import {
  callExpressions,
  jsxElements,
  parseComponentModule as parseComponentModuleModel,
  type ComponentModuleModel,
  type JsxElementModel,
} from '../scan/parse.js';
import { literalStringValue, parseLiteralObject, type StaticLiteralValue } from '../scan/object.js';
import { escapeAttribute, removeJsxAttributes } from '../shared.js';

export function lowerNavigationSugar(
  source: string,
  model: ComponentModuleModel,
  fileName: string,
): { source: string } {
  const linksLowered = lowerStaticLinks(source, model);
  const linksLoweredModel =
    linksLowered === source ? model : parseComponentModuleModel(fileName, linksLowered);

  return {
    source: lowerStaticHrefCallsAndAttributes(linksLowered, linksLoweredModel),
  };
}

function lowerStaticLinks(source: string, model: ComponentModuleModel): string {
  let output = source;

  for (const link of jsxElements(model)
    .filter((element) => element.tag === 'Link' && !element.selfClosing)
    .sort((left, right) => right.start - left.start)) {
    const target = jsxStaticAttributeValue(link, 'to');
    if (!target) continue;

    const params = navigationObjectAttributeValue(link, 'params');
    const search = navigationObjectAttributeValue(link, 'search');
    if (params === null || search === null) continue;

    const opening = output.slice(link.start, link.openingEnd);
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
    const children = output.slice(link.openingEnd, link.closingStart);

    output = `${output.slice(0, link.start)}<a${spacing} href="${escapeAttribute(href)}">${children}</a>${output.slice(link.end)}`;
  }

  return output;
}

interface SourceReplacement {
  end: number;
  replacement: string;
  start: number;
}

function lowerStaticHrefCallsAndAttributes(source: string, model: ComponentModuleModel): string {
  const replacements: SourceReplacement[] = [];
  const staticHrefCalls = callExpressions(model)
    .filter((item) => item.name === 'href')
    .map((call) => ({ call, lowered: lowerStaticHrefCall(call.arguments) }))
    .filter(
      (item): item is { call: (typeof item)['call']; lowered: string } => item.lowered !== null,
    );
  const wholeAttributeReplacements: SourceReplacement[] = [];

  for (const attribute of jsxElements(model)
    .flatMap((element) => [...element.attributes])
    .filter((item) => item.name === 'href' && item.expression !== undefined)
    .sort((left, right) => right.start - left.start)) {
    const target =
      literalStringValue(attribute.expression ?? '') ??
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

  let output = source;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    output = `${output.slice(0, replacement.start)}${replacement.replacement}${output.slice(replacement.end)}`;
  }

  return output;
}

function isWithinReplacement(call: { end: number; start: number }, replacement: SourceReplacement) {
  return call.start >= replacement.start && call.end <= replacement.end;
}

function lowerStaticHrefCall(args: readonly string[]): string | null {
  const [pathArg, optionsArg] = args.map((arg) => arg.trim());
  const path = literalStringValue(pathArg ?? '');
  if (!path) return null;

  const options = parseLiteralObject(optionsArg ?? '{}');
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
  const expression = element.attributes.find((attribute) => attribute.name === name)?.expression;
  if (expression === undefined) return undefined;
  const value = parseLiteralObject(expression);
  return value ? navigationObjectValue(value) : null;
}

function objectRecordValue(
  value: StaticLiteralValue | undefined,
): StaticNavigationObject | null | undefined {
  if (value === undefined) return undefined;
  return navigationObjectValue(value);
}

function navigationObjectValue(value: StaticLiteralValue | null): StaticNavigationObject | null {
  if (typeof value !== 'object' || value === null) return null;
  return Object.values(value).every((entry) => typeof entry !== 'object' || entry === null)
    ? (value as StaticNavigationObject)
    : null;
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
