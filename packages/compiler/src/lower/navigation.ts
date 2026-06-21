import {
  callExpressions,
  jsxElements,
  type ComponentModuleModel,
  type JsxAttributeModel,
} from '../scan/parse.js';
import type { StaticLiteralValue } from '../scan/object.js';
import { escapeAttribute, type SourceReplacement } from '../shared.js';

export function navigationStandaloneHrefLowering(model: ComponentModuleModel): SourceReplacement[] {
  const wholeAttributeReplacements = navigationHrefAttributeReplacements(model);
  return staticHrefCalls(model)
    .filter(
      ({ call }) =>
        !wholeAttributeReplacements.some((replacement) => isWithinReplacement(call, replacement)),
    )
    .map(({ call, lowered }) => ({
      end: call.end,
      replacement: JSON.stringify(lowered),
      start: call.start,
    }));
}

export function staticHrefAttributeValue(
  model: ComponentModuleModel,
  attribute: JsxAttributeModel,
): string | null {
  if (attribute.name !== 'href' || attribute.expression === undefined) return null;
  return (
    staticStringValue(attribute.expressionStaticValue) ??
    staticHrefCalls(model).find(
      ({ call }) =>
        call.start === attribute.expressionStart && call.end === attribute.expressionEnd,
    )?.lowered ??
    null
  );
}

function navigationHrefAttributeReplacements(model: ComponentModuleModel): SourceReplacement[] {
  return jsxElements(model)
    .flatMap((element) => [...element.attributes])
    .filter((item) => item.name === 'href' && item.expression !== undefined)
    .map((attribute) => ({ attribute, target: staticHrefAttributeValue(model, attribute) }))
    .filter(
      (item): item is { attribute: JsxAttributeModel; target: string } => item.target !== null,
    )
    .sort((left, right) => right.attribute.start - left.attribute.start)
    .map(({ attribute, target }) => ({
      end: attribute.end,
      replacement: `href="${escapeAttribute(target)}"`,
      start: attribute.start,
    }));
}

function staticHrefCalls(
  model: ComponentModuleModel,
): { call: ReturnType<typeof callExpressions>[number]; lowered: string }[] {
  return callExpressions(model)
    .filter((item) => item.name === 'href')
    .map((call) => ({ call, lowered: lowerStaticHrefCall(call.argumentStaticValues) }))
    .filter(
      (item): item is { call: (typeof item)['call']; lowered: string } => item.lowered !== null,
    );
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

function objectRecordValue(
  value: StaticLiteralValue | undefined,
): StaticNavigationObject | null | undefined {
  if (value === undefined) return undefined;
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

export function buildStaticHref(
  path: string,
  params: Record<string, string | number | boolean | null>,
  searchValues: Record<string, string | number | boolean | null>,
): string {
  const pathname = substituteStaticRouteParams(path, params);
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(searchValues)) {
    if (value === null || value === undefined) continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function substituteStaticRouteParams(
  path: string,
  params: Record<string, string | number | boolean | null>,
): string {
  let output = '';
  let index = 0;

  while (index < path.length) {
    const char = path[index];
    const next = path[index + 1];
    if (char !== ':' || next === undefined || !isRouteParamNameStart(next)) {
      output += char;
      index += 1;
      continue;
    }

    let end = index + 2;
    while (end < path.length && isRouteParamNamePart(path[end] ?? '')) end += 1;

    const key = path.slice(index + 1, end);
    output += encodeURIComponent(String(params[key] ?? ''));
    index = end;
  }

  return output;
}

function isRouteParamNameStart(char: string): boolean {
  return (
    char === '_' || char === '$' || (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z')
  );
}

function isRouteParamNamePart(char: string): boolean {
  return isRouteParamNameStart(char) || (char >= '0' && char <= '9');
}
