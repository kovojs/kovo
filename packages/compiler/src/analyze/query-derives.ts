// `derive()` / `data-derive` stamp collection. Extracted verbatim from
// `analyze/query-updates.ts` for the FN10 decomposition. SPEC.md §5.x query-update
// facts. Behavior-neutral: emitted bytes and the hidden non-enumerable
// `outputContext` channel are unchanged.
import { parseBindingPath } from './query-shapes.js';
import { withGeneratedFromSpan, withOutputContext, withSourceSpan } from './query-internal.js';
import {
  compilerArrayAppend,
  compilerArrayIsArray,
  compilerCreateMap,
  compilerCreateNullRecord,
  compilerMapGet,
  compilerMapSet,
  compilerOwnDataValue,
  compilerSnapshotDenseArray,
  compilerSetOwnDataProperty,
  compilerStringReplaceAll,
  compilerStringSlice,
  compilerStringStartsWith,
  compilerStringToLowerCase,
} from '../compiler-security-intrinsics.js';
import {
  callExpressions,
  jsxAttributeSemanticStringValue,
  jsxElements,
  type ArrowFunctionPartsModel,
  type ComponentModuleModel,
  type DeriveInputsModel,
} from '../scan/parse.js';
import { outputContextForAttribute } from '../output-context-facts.js';
import { escapeCssString } from '../shared.js';
import type { QueryDeriveFact, QueryStampFact } from '../types.js';

export function exportedDerives(
  model: ComponentModuleModel,
): Map<string, Omit<QueryDeriveFact, 'selector'>> {
  const derives = compilerCreateMap<string, Omit<QueryDeriveFact, 'selector'>>();

  const calls = compilerSnapshotDenseArray(callExpressions(model), 'Compiler exported derives');
  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index]!;
    if (call.name !== 'derive' || !call.exportedConstName) continue;

    const deriveInputs = call.deriveInputs;
    const inputs =
      deriveInputs === undefined
        ? deriveInputNames(
            ownStringArray(
              compilerOwnDataValue(
                call.argumentStringLiteralArrayValues,
                0,
                'Compiler derive input argument',
              ),
              'Compiler derive input argument',
            ),
          )
        : deriveInputNamesFromModel(deriveInputs);
    const derive = ownArrowFunctionParts(
      compilerOwnDataValue(call.argumentArrowFunctionParts, 1, 'Compiler derive arrow arguments'),
      'Compiler derive arrow argument',
    );
    if (
      inputs.length === 0 ||
      !derive ||
      (deriveInputs?.form === 'object'
        ? derive.params.length !== 1
        : derive.params.length !== inputs.length)
    ) {
      continue;
    }
    const input = inputs[0];
    if (!input) continue;
    const exportName = call.exportedConstName;
    const inputMap = deriveInputMapFromModel(deriveInputs);

    compilerMapSet(
      derives,
      exportName,
      withSourceSpan(
        {
          exportName,
          expression: derive.expression,
          input,
          ...(inputMap === undefined ? {} : { inputMap }),
          ...(inputs.length > 1 ? { inputs } : {}),
          name: exportName,
          param: derive.param,
          ...(deriveInputs?.form !== 'object' && derive.params.length > 1
            ? { params: derive.params }
            : {}),
        },
        { end: call.end, start: call.start },
      ),
    );
  }

  return derives;
}

function deriveInputNamesFromModel(model: DeriveInputsModel): string[] {
  const entries = compilerSnapshotDenseArray(model.entries, 'Compiler derive input facts');
  const names: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    compilerArrayAppend(names, entries[index]!.input, 'Compiler derive input names');
  }
  return names;
}

function deriveInputMapFromModel(
  model: DeriveInputsModel | undefined,
): Readonly<Record<string, string>> | undefined {
  if (model?.form !== 'object') return undefined;
  const entries = compilerSnapshotDenseArray(model.entries, 'Compiler derive input-map facts');
  const inputMap = compilerCreateNullRecord<string>();
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    compilerSetOwnDataProperty(inputMap, entry.alias ?? entry.input, entry.input);
  }
  return inputMap;
}

function ownStringArray(value: unknown, label: string): string[] | null {
  if (value === null || value === undefined) return null;
  if (!compilerArrayIsArray(value)) throw new TypeError(`${label} must be an array or null.`);

  const source = compilerSnapshotDenseArray(value, label);
  const result: string[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const entry = source[index];
    if (typeof entry !== 'string') throw new TypeError(`${label}[${index}] must be a string.`);
    compilerArrayAppend(result, entry, label);
  }
  return result;
}

function ownArrowFunctionParts(value: unknown, label: string): ArrowFunctionPartsModel | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') throw new TypeError(`${label} must be an object or null.`);

  const expression = compilerOwnDataValue(value, 'expression', label);
  const param = compilerOwnDataValue(value, 'param', label);
  const rawParams = compilerOwnDataValue(value, 'params', label);
  if (typeof expression !== 'string' || typeof param !== 'string') {
    throw new TypeError(`${label} must contain string expression and param facts.`);
  }
  if (!compilerArrayIsArray(rawParams)) throw new TypeError(`${label}.params must be an array.`);

  const params = ownStringArray(rawParams, `${label}.params`);
  if (params === null) throw new TypeError(`${label}.params must be an array.`);
  return { expression, param, params };
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
      const value = jsxAttributeSemanticStringValue(attribute);
      if (!compilerStringStartsWith(attribute.name, 'data-bind:') || !value) continue;

      const segments = parseBindingPath(value);
      const inputSegment = segments[0];
      const nameSegment = segments[1];
      if (!inputSegment || !nameSegment || segments.length > 2) continue;

      const derive = compilerMapGet(derives, nameSegment.name);
      if (!derive || !containsString(derivePlanInputs(derive), inputSegment.name)) continue;
      if (inputSegment.name === 'state') continue;

      const attr = compilerStringSlice(attribute.name, 'data-bind:'.length);
      const selector = queryBindingAttributeSelector(attribute.name, value);
      const trustedUrl = hasTrustedUrlMarker(attributes, attr);
      compilerArrayAppend(
        stampFacts,
        withOutputContext(
          {
            attr,
            derive: queryDeriveAtUse(derive, selector, attribute),
            selector,
            ...(trustedUrl ? { trustedUrl: true as const } : {}),
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
    const deriveValue =
      deriveAttribute === undefined ? undefined : jsxAttributeSemanticStringValue(deriveAttribute);
    if (!deriveAttribute || !deriveValue) continue;

    const deriveAttrAttribute = findAttribute(attributes, 'data-derive-attr');
    const attr =
      deriveAttrAttribute === undefined
        ? undefined
        : jsxAttributeSemanticStringValue(deriveAttrAttribute);

    const segments = parseBindingPath(deriveValue);
    const inputSegment = segments[0];
    const nameSegment = segments[1];
    if (!inputSegment || !nameSegment || segments.length > 2) continue;
    const input = inputSegment.name;
    const name = nameSegment.name;

    const derive = compilerMapGet(derives, name);
    if (!derive || !containsString(derivePlanInputs(derive), input)) continue;

    const deriveFact = queryDeriveAtUse(
      derive,
      `[data-derive="${input}.${name}"]`,
      deriveAttribute,
    );

    if (attr) {
      const trustedUrl = hasTrustedUrlMarker(attributes, attr);
      compilerArrayAppend(
        stampFacts,
        withOutputContext(
          {
            attr,
            derive: deriveFact,
            selector: deriveFact.selector,
            ...(trustedUrl ? { trustedUrl: true as const } : {}),
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

function queryDeriveAtUse(
  derive: Omit<QueryDeriveFact, 'selector'>,
  selector: string,
  generatedFrom: { end: number; start: number },
): QueryDeriveFact {
  const fact = withGeneratedFromSpan(
    {
      ...derive,
      selector,
    },
    { end: generatedFrom.end, start: generatedFrom.start },
  );
  return derive.sourceSpan === undefined
    ? fact
    : withSourceSpan(fact, {
        end: derive.sourceSpan.end,
        start: derive.sourceSpan.start,
      });
}

function hasTrustedUrlMarker(
  attributes: readonly { readonly name: string }[],
  attr: string,
): boolean {
  const expected = `data-kovo-trusted-url:${compilerStringToLowerCase(attr)}`;
  const source = compilerSnapshotDenseArray(attributes, 'Compiler trusted URL marker lookup');
  for (let index = 0; index < source.length; index += 1) {
    if (source[index]!.name === expected) return true;
  }
  return false;
}

/**
 * SPEC §5.2 rule 11: query stamps must use the browser's real CSS selector grammar. The
 * compiler-owned `data-bind:*` attribute name contains a literal colon, which CSS otherwise parses
 * as selector syntax and rejects before the reviewed attribute sink can run.
 */
function queryBindingAttributeSelector(name: string, value: string): string {
  const escapedName = compilerStringReplaceAll(name, ':', '\\:');
  return `[${escapedName}="${escapeCssString(value)}"]`;
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
    if (source[index]!.name === name) return source[index]!;
  }
  return undefined;
}
