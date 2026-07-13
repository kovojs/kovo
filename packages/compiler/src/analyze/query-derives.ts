// `derive()` / `data-derive` stamp collection. Extracted verbatim from
// `analyze/query-updates.ts` for the FN10 decomposition. SPEC.md §5.x query-update
// facts. Behavior-neutral: emitted bytes and the hidden non-enumerable
// `outputContext` channel are unchanged.
import { parseBindingPath } from './query-shapes.js';
import { withOutputContext } from './query-internal.js';
import {
  compilerArrayAppend,
  compilerCreateMap,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerSnapshotDenseArray,
  compilerStringSlice,
  compilerStringStartsWith,
} from '../compiler-security-intrinsics.js';
import { callExpressions, jsxElements, type ComponentModuleModel } from '../scan/parse.js';
import { outputContextForAttribute } from '../output-context-facts.js';
import type { QueryDeriveFact, QueryStampFact } from '../types.js';

export function exportedDerives(
  model: ComponentModuleModel,
): Map<string, Omit<QueryDeriveFact, 'selector'>> {
  const derives = compilerCreateMap<string, Omit<QueryDeriveFact, 'selector'>>();

  const calls = compilerSnapshotDenseArray(callExpressions(model), 'Compiler exported derives');
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index]!;
    if (call.name !== 'derive' || !call.exportedConstName) continue;

    const inputs = deriveInputNames(
      compilerOwnDataValue(
        call.argumentStringLiteralArrayValues,
        0,
        'Compiler derive input argument',
      ) as readonly string[] | null | undefined,
    );
    const derive = compilerOwnDataValue(
      call.argumentArrowFunctionParts,
      1,
      'Compiler derive arrow arguments',
    );
    if (inputs.length === 0 || !derive || derive.params.length !== inputs.length) continue;
    const input = inputs[0];
    if (!input) continue;
    const exportName = call.exportedConstName;

    compilerMapSet(derives, exportName, {
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
  const inputs: string[] = [];
  const source = compilerSnapshotDenseArray(values ?? [], 'Compiler derive input names');
  for (let index = 0; index < source.length; index += 1) {
    if (source[index]!.length > 0) {
      compilerArrayAppend(inputs, source[index]!, 'Compiler derive input names');
    }
  }
  return inputs;
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

  const elements = compilerSnapshotDenseArray(jsxElements(model), 'Compiler derive-stamp elements');
  for (let elementIndex = 0; elementIndex < elements.length; elementIndex += 1) {
    const element = elements[elementIndex]!;
    const attributes = compilerSnapshotDenseArray(
      element.attributes,
      'Compiler derive-stamp attributes',
    );
    for (let attributeIndex = 0; attributeIndex < attributes.length; attributeIndex += 1) {
      const attribute = attributes[attributeIndex]!;
      if (!compilerStringStartsWith(attribute.name, 'data-bind:') || !attribute.value) continue;
      if (!attribute.value) continue;

      const segments = parseBindingPath(attribute.value);
      const inputSegment = segments[0];
      const nameSegment = segments[1];
      if (!inputSegment || !nameSegment || segments.length > 2) continue;

      const derive = compilerMapGet(derives, nameSegment.name);
      if (!derive || !containsString(derivePlanInputs(derive), inputSegment.name)) continue;
      if (inputSegment.name === 'state') continue;

      const attr = compilerStringSlice(attribute.name, 'data-bind:'.length);
      compilerArrayAppend(
        stampFacts,
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
        'Compiler query derive stamps',
      );
    }

    const deriveAttribute = findAttribute(attributes, 'data-derive');
    if (!deriveAttribute?.value) continue;

    const attr = findAttribute(attributes, 'data-derive-attr')?.value;

    const segments = parseBindingPath(deriveAttribute.value);
    const inputSegment = segments[0];
    const nameSegment = segments[1];
    if (!inputSegment || !nameSegment || segments.length > 2) continue;
    const input = inputSegment.name;
    const name = nameSegment.name;

    const derive = compilerMapGet(derives, name);
    if (!derive || !containsString(derivePlanInputs(derive), input)) continue;

    const deriveFact = {
      ...derive,
      selector: `[data-derive="${input}.${name}"]`,
    };

    if (attr) {
      compilerArrayAppend(
        stampFacts,
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
        'Compiler query derive stamps',
      );
    } else {
      compilerArrayAppend(deriveFacts, deriveFact, 'Compiler query derive facts');
    }
  }

  return {
    derives: deriveFacts,
    stamps: stampFacts,
  };
}

function containsString(values: readonly string[], wanted: string): boolean {
  const source = compilerSnapshotDenseArray(values, 'Compiler derive plan inputs');
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === wanted) return true;
  }
  return false;
}

function findAttribute<Attribute extends { readonly name: string; readonly value?: string }>(
  attributes: readonly Attribute[],
  name: string,
): Attribute | undefined {
  const source = compilerSnapshotDenseArray(attributes, 'Compiler derive attribute lookup');
  for (let index = 0; index < source.length; index += 1) {
    if (source[index]!.name === name && source[index]!.value) return source[index]!;
  }
  return undefined;
}
