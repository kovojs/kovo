// `derive()` / `data-derive` stamp collection. Extracted verbatim from
// `analyze/query-updates.ts` for the FN10 decomposition. SPEC.md §5.x query-update
// facts. Behavior-neutral: emitted bytes and the hidden non-enumerable
// `outputContext` channel are unchanged.
import { parseBindingPath } from './query-shapes.js';
import { withOutputContext } from './query-internal.js';
import {
  callExpressions,
  jsxElements,
  type ComponentModuleModel,
} from '../scan/parse.js';
import { outputContextForAttribute } from '../output-context-facts.js';
import type { QueryDeriveFact, QueryStampFact } from '../types.js';

export function exportedDerives(
  model: ComponentModuleModel,
): Map<string, Omit<QueryDeriveFact, 'selector'>> {
  const derives = new Map<string, Omit<QueryDeriveFact, 'selector'>>();

  for (const call of callExpressions(model)) {
    if (call.name !== 'derive' || !call.exportedConstName) continue;

    const inputs = deriveInputNames(call.argumentStringLiteralArrayValues[0]);
    const derive = call.argumentArrowFunctionParts[1];
    if (inputs.length === 0 || !derive || derive.params.length !== inputs.length) continue;
    const input = inputs[0];
    if (!input) continue;
    const exportName = call.exportedConstName;

    derives.set(exportName, {
      exportName,
      expression: derive.expression,
      input,
      ...(inputs.length > 1 ? { inputs } : {}),
      name: exportName,
      param: derive.param,
      ...(derive.params.length > 1 ? { params: derive.params } : {}),
    });
  }

  return derives;
}

function deriveInputNames(values: readonly string[] | null | undefined): string[] {
  return values?.filter((input) => input.length > 0) ?? [];
}

export function derivePlanInputs(
  derive: Pick<QueryDeriveFact, 'input' | 'inputs'>,
): readonly string[] {
  return derive.inputs ?? [derive.input];
}

export function dataDeriveStamps(
  model: ComponentModuleModel,
  derives: Map<string, Omit<QueryDeriveFact, 'selector'>>,
): { derives: QueryDeriveFact[]; stamps: QueryStampFact[] } {
  const deriveFacts: QueryDeriveFact[] = [];
  const stampFacts: QueryStampFact[] = [];

  for (const element of jsxElements(model)) {
    for (const attribute of element.attributes.filter(
      (item) => item.name.startsWith('data-bind:') && item.value,
    )) {
      if (!attribute.value) continue;

      const [inputSegment, nameSegment, ...extraSegments] = parseBindingPath(attribute.value);
      if (!inputSegment || !nameSegment || extraSegments.length > 0) continue;

      const derive = derives.get(nameSegment.name);
      if (!derive || !derivePlanInputs(derive).includes(inputSegment.name)) continue;
      if (inputSegment.name === 'state') continue;

      const attr = attribute.name.slice('data-bind:'.length);
      stampFacts.push(
        withOutputContext(
          {
            attr,
            derive: {
              ...derive,
              selector: `[${attribute.name}="${attribute.value}"]`,
            },
            selector: `[${attribute.name}="${attribute.value}"]`,
          },
          {
            context: outputContextForAttribute(attr),
            expression: derive.expression,
            sink: attr,
            source: 'client-query',
            writer: 'query attribute binding',
          },
        ),
      );
    }

    const deriveAttribute = element.attributes.find(
      (attribute) => attribute.name === 'data-derive' && attribute.value,
    );
    if (!deriveAttribute?.value) continue;

    const attr = element.attributes.find(
      (attribute) => attribute.name === 'data-derive-attr' && attribute.value,
    )?.value;

    const [inputSegment, nameSegment, ...extraSegments] = parseBindingPath(deriveAttribute.value);
    if (!inputSegment || !nameSegment || extraSegments.length > 0) continue;
    const input = inputSegment.name;
    const name = nameSegment.name;

    const derive = derives.get(name);
    if (!derive || !derivePlanInputs(derive).includes(input)) continue;

    const deriveFact = {
      ...derive,
      selector: `[data-derive="${input}.${name}"]`,
    };

    if (attr) {
      stampFacts.push(
        withOutputContext(
          {
            attr,
            derive: deriveFact,
            selector: deriveFact.selector,
          },
          {
            context: outputContextForAttribute(attr),
            expression: derive.expression,
            sink: attr,
            source: 'client-query',
            writer: 'query attribute stamp',
          },
        ),
      );
    } else {
      deriveFacts.push(deriveFact);
    }
  }

  return {
    derives: deriveFacts,
    stamps: stampFacts,
  };
}
