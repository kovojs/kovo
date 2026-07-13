import {
  markJsxIrChanged,
  type JsxIrAttribute,
  type JsxIrAttributeValue,
  type JsxIrElement,
} from '../jsx-ir.js';
import { literalStringValue } from '../scan/object.js';
import {
  compilerArrayLength,
  compilerDefineOwnDataProperty,
  compilerNumberIsFinite,
  compilerNumberValue,
  compilerOwnDataValue,
  compilerRegExpTest,
  compilerStringTrim,
} from '../compiler-security-intrinsics.js';

export function lowerPrimitiveSpreads(elements: readonly JsxIrElement[]): void {
  const elementLength = compilerArrayLength(elements, 'Static spread JSX elements');
  for (let elementIndex = 0; elementIndex < elementLength; elementIndex += 1) {
    const element = compilerOwnDataValue(
      elements,
      elementIndex,
      'Static spread JSX elements',
    ) as JsxIrElement;
    const sourceAttributes = element.attributes;
    const sourceLength = compilerArrayLength(sourceAttributes, 'Static spread source attributes');
    for (let spreadIndex = 0; spreadIndex < sourceLength; spreadIndex += 1) {
      const spread = compilerOwnDataValue(
        sourceAttributes,
        spreadIndex,
        'Static spread source attributes',
      ) as JsxIrAttribute;
      const source = spread.source;
      if (!source || !('objectEntries' in source) || !source.objectEntries) continue;
      const attrs = spreadObjectAttributes(source.objectEntries);
      if (attrs === null) continue;
      const next: JsxIrAttribute[] = [];
      const currentLength = compilerArrayLength(element.attributes, 'Static spread IR attributes');
      for (let currentIndex = 0; currentIndex < currentLength; currentIndex += 1) {
        const attribute = compilerOwnDataValue(
          element.attributes,
          currentIndex,
          'Static spread IR attributes',
        ) as JsxIrAttribute;
        if (attribute !== spread) appendSpreadFact(next, attribute, 'Static spread IR attributes');
      }
      const attrLength = compilerArrayLength(attrs, 'Static spread lowered attributes');
      for (let attrIndex = 0; attrIndex < attrLength; attrIndex += 1) {
        appendSpreadFact(
          next,
          compilerOwnDataValue(
            attrs,
            attrIndex,
            'Static spread lowered attributes',
          ) as JsxIrAttribute,
          'Static spread IR attributes',
        );
      }
      element.attributes = next;
      markJsxIrChanged(element);
    }
  }
}

function spreadObjectAttributes(
  entries: readonly { key: string; value?: string }[],
): JsxIrAttribute[] | null {
  const attributes: JsxIrAttribute[] = [];
  const length = compilerArrayLength(entries, 'Static spread object entries');
  for (let index = 0; index < length; index += 1) {
    const entry = compilerOwnDataValue(
      entries,
      index,
      'Static spread object entries',
    ) as (typeof entries)[number];
    const value = spreadObjectAttributeValue(entry.value);
    if (value === null) return null;
    if (!value) continue;
    appendSpreadFact(
      attributes,
      {
        name: entry.key,
        ownership: 'generated',
        provenance: {
          description: 'static spread attribute',
          ownership: 'generated',
          writer: 'static spread lowering',
        },
        value,
      },
      'Static spread lowered attributes',
    );
  }
  return attributes;
}

function spreadObjectAttributeValue(
  value: string | undefined,
): JsxIrAttributeValue | null | undefined {
  if (value === undefined) return null;
  const trimmed = compilerStringTrim(value);
  if (trimmed === 'false' || trimmed === 'null' || trimmed === 'undefined') return undefined;
  const stringValue = literalStringValue(trimmed);
  if (stringValue !== null) return { kind: 'string', value: stringValue };
  if (trimmed === 'true') return { kind: 'boolean', value: true };
  if (compilerRegExpTest(/^-?\d+(?:\.\d+)?$/, trimmed)) {
    const number = compilerNumberValue(trimmed);
    if (compilerNumberIsFinite(number)) return { kind: 'number', value: number };
  }
  return { kind: 'expression', source: trimmed };
}

function appendSpreadFact<Value>(target: Value[], value: Value, label: string): void {
  compilerDefineOwnDataProperty(target, compilerArrayLength(target, label), value);
}
