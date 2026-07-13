import { buildRoutePatternHref } from '@kovojs/core/internal/route-pattern';

import {
  callExpressions,
  jsxElements,
  type ComponentModuleModel,
  type JsxAttributeModel,
} from '../scan/parse.js';
import type { StaticLiteralValue } from '../scan/object.js';
import { escapeAttribute, type SourceReplacement } from '../shared.js';
import {
  compilerArrayLength,
  compilerCreateSet,
  compilerDefineOwnDataProperty,
  compilerFailClosed,
  compilerJsonStringify,
  compilerObjectKeys,
  compilerOwnDataValue,
  compilerSetAdd,
  compilerSetHas,
} from '../compiler-security-intrinsics.js';

export function navigationStandaloneHrefLowering(model: ComponentModuleModel): SourceReplacement[] {
  const wholeAttributeReplacements = navigationHrefAttributeReplacements(model);
  const replacements: SourceReplacement[] = [];
  const calls = staticHrefCalls(model);
  const callLength = compilerArrayLength(calls, 'Static href calls');
  const attributeLength = compilerArrayLength(
    wholeAttributeReplacements,
    'Navigation attribute replacements',
  );
  for (let callIndex = 0; callIndex < callLength; callIndex += 1) {
    const entry = compilerOwnDataValue(
      calls,
      callIndex,
      'Static href calls',
    ) as (typeof calls)[number];
    let withinAttribute = false;
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const replacement = compilerOwnDataValue(
        wholeAttributeReplacements,
        attributeIndex,
        'Navigation attribute replacements',
      ) as SourceReplacement;
      if (isWithinReplacement(entry.call, replacement)) {
        withinAttribute = true;
        break;
      }
    }
    if (withinAttribute) continue;
    const source = compilerJsonStringify(entry.lowered);
    if (source === undefined) compilerFailClosed('Static href must be JSON-serializable.');
    appendNavigationFact(
      replacements,
      { end: entry.call.end, replacement: source, start: entry.call.start },
      'Standalone navigation replacements',
    );
  }
  return replacements;
}

export function staticHrefAttributeValue(
  model: ComponentModuleModel,
  attribute: JsxAttributeModel,
): string | null {
  if (attribute.name !== 'href' || attribute.expression === undefined) return null;
  const staticValue = staticStringValue(attribute.expressionStaticValue);
  if (staticValue !== null) return staticValue;
  const calls = staticHrefCalls(model);
  const length = compilerArrayLength(calls, 'Static href calls');
  for (let index = 0; index < length; index += 1) {
    const entry = compilerOwnDataValue(calls, index, 'Static href calls') as (typeof calls)[number];
    if (
      entry.call.start === attribute.expressionStart &&
      entry.call.end === attribute.expressionEnd
    ) {
      return entry.lowered;
    }
  }
  return null;
}

function navigationHrefAttributeReplacements(model: ComponentModuleModel): SourceReplacement[] {
  const targets: { attribute: JsxAttributeModel; target: string }[] = [];
  const elements = jsxElements(model);
  const elementLength = compilerArrayLength(elements, 'Navigation JSX elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      elements,
      elementIndex,
      'Navigation JSX elements',
    ) as (typeof elements)[number];
    const attributeLength = compilerArrayLength(element.attributes, 'Navigation JSX attributes');
    for (let attributeIndex = 0; attributeIndex < attributeLength; attributeIndex += 1) {
      const attribute = compilerOwnDataValue(
        element.attributes,
        attributeIndex,
        'Navigation JSX attributes',
      ) as JsxAttributeModel;
      if (attribute.name !== 'href' || attribute.expression === undefined) continue;
      const target = staticHrefAttributeValue(model, attribute);
      if (target !== null) {
        appendNavigationFact(targets, { attribute, target }, 'Navigation href targets');
      }
    }
  }
  const sorted = sortNavigationTargetsDescending(targets);
  const replacements: SourceReplacement[] = [];
  const length = compilerArrayLength(sorted, 'Navigation href targets');
  for (let index = 0; index < length; index += 1) {
    const { attribute, target } = compilerOwnDataValue(
      sorted,
      index,
      'Navigation href targets',
    ) as (typeof sorted)[number];
    appendNavigationFact(
      replacements,
      {
        end: attribute.end,
        replacement: `href="${escapeAttribute(target)}"`,
        start: attribute.start,
      },
      'Navigation attribute replacements',
    );
  }
  return replacements;
}

function staticHrefCalls(
  model: ComponentModuleModel,
): { call: ReturnType<typeof callExpressions>[number]; lowered: string }[] {
  const result: { call: ReturnType<typeof callExpressions>[number]; lowered: string }[] = [];
  const calls = callExpressions(model);
  const length = compilerArrayLength(calls, 'Navigation call expressions');
  for (let index = 0; index < length; index += 1) {
    const call = compilerOwnDataValue(
      calls,
      index,
      'Navigation call expressions',
    ) as (typeof calls)[number];
    if (call.name !== 'href') continue;
    const lowered = lowerStaticHrefCall(call.argumentStaticValues);
    if (lowered !== null) appendNavigationFact(result, { call, lowered }, 'Static href calls');
  }
  return result;
}

function isWithinReplacement(call: { end: number; start: number }, replacement: SourceReplacement) {
  return call.start >= replacement.start && call.end <= replacement.end;
}

function lowerStaticHrefCall(args: readonly (StaticLiteralValue | undefined)[]): string | null {
  const length = compilerArrayLength(args, 'Static href arguments');
  const pathArg =
    length > 0
      ? (compilerOwnDataValue(args, 0, 'Static href arguments') as StaticLiteralValue | undefined)
      : undefined;
  const optionsArg =
    length > 1
      ? (compilerOwnDataValue(args, 1, 'Static href arguments') as StaticLiteralValue | undefined)
      : undefined;
  const path = staticStringValue(pathArg);
  if (!path) return null;
  if (length > 1 && optionsArg === undefined) return null;

  const options =
    optionsArg === undefined ? {} : staticNavigationObjectValue(optionsArg, { nested: true });
  if (options === null) return null;

  const params = objectRecordValue(
    compilerOwnDataValue(options, 'params', 'Static href options') as
      | StaticLiteralValue
      | undefined,
  );
  const search = objectRecordValue(
    compilerOwnDataValue(options, 'search', 'Static href options') as
      | StaticLiteralValue
      | undefined,
  );
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
  const keys = compilerObjectKeys(value);
  const length = compilerArrayLength(keys, 'Static navigation object keys');
  for (let index = 0; index < length; index += 1) {
    const key = compilerOwnDataValue(keys, index, 'Static navigation object keys') as string;
    const entry = compilerOwnDataValue(value, key, 'Static navigation object');
    if (!options.nested && typeof entry === 'object' && entry !== null) return null;
  }
  return value as StaticNavigationObject;
}

function staticStringValue(value: StaticLiteralValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

export function buildStaticHref(
  path: string,
  params: Record<string, string | number | boolean | null>,
  searchValues: Record<string, string | number | boolean | null>,
): string {
  return buildRoutePatternHref(path, { params, search: searchValues });
}

function appendNavigationFact<Value>(target: Value[], value: Value, label: string): void {
  compilerDefineOwnDataProperty(target, compilerArrayLength(target, label), value);
}

function sortNavigationTargetsDescending(
  values: readonly { attribute: JsxAttributeModel; target: string }[],
): { attribute: JsxAttributeModel; target: string }[] {
  const result: { attribute: JsxAttributeModel; target: string }[] = [];
  const length = compilerArrayLength(values, 'Navigation href targets');
  const used = compilerCreateSet<number>();
  for (let outputIndex = 0; outputIndex < length; outputIndex += 1) {
    let bestIndex = -1;
    let bestStart = -1;
    for (let inputIndex = 0; inputIndex < length; inputIndex += 1) {
      if (compilerSetHas(used, inputIndex)) continue;
      const candidate = compilerOwnDataValue(
        values,
        inputIndex,
        'Navigation href targets',
      ) as (typeof values)[number];
      if (bestIndex < 0 || candidate.attribute.start > bestStart) {
        bestIndex = inputIndex;
        bestStart = candidate.attribute.start;
      }
    }
    if (bestIndex < 0) compilerFailClosed('Navigation href targets must be dense.');
    compilerSetAdd(used, bestIndex);
    appendNavigationFact(
      result,
      compilerOwnDataValue(values, bestIndex, 'Navigation href targets') as (typeof values)[number],
      'Navigation href targets',
    );
  }
  return result;
}
