import {
  markJsxIrChanged,
  type JsxIrAttribute,
  type JsxIrAttributeValue,
  type JsxIrElement,
} from '../jsx-ir.js';
import { literalStringValue } from '../scan/object.js';

export function lowerPrimitiveSpreads(elements: readonly JsxIrElement[]): void {
  for (const element of elements) {
    for (const spread of element.attributes) {
      const source = spread.source;
      if (!source || !('objectEntries' in source) || !source.objectEntries) continue;
      const attrs = spreadObjectAttributes(source.objectEntries);
      if (attrs === null) continue;
      element.attributes = element.attributes.filter((attribute) => attribute !== spread);
      element.attributes.push(...attrs.map(({ source: _source, ...attribute }) => attribute));
      markJsxIrChanged(element);
    }
  }
}

function spreadObjectAttributes(
  entries: readonly { key: string; value?: string }[],
): JsxIrAttribute[] | null {
  const attributes: JsxIrAttribute[] = [];
  for (const entry of entries) {
    const value = spreadObjectAttributeValue(entry.value);
    if (value === null) return null;
    if (!value) continue;
    attributes.push({
      name: entry.key,
      ownership: 'generated',
      provenance: {
        description: 'static spread attribute',
        ownership: 'generated',
        writer: 'static spread lowering',
      },
      value,
    });
  }
  return attributes;
}

function spreadObjectAttributeValue(
  value: string | undefined,
): JsxIrAttributeValue | null | undefined {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === 'false' || trimmed === 'null' || trimmed === 'undefined') return undefined;
  const stringValue = literalStringValue(trimmed);
  if (stringValue !== null) return { kind: 'string', value: stringValue };
  if (trimmed === 'true') return { kind: 'boolean', value: true };
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return { kind: 'number', value: Number(trimmed) };
  return { kind: 'expression', source: trimmed };
}
